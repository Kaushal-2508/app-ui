// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-expect-error Deno runtime
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Brand colors
const BRAND_TEAL = rgb(0.141, 0.612, 0.639);
const BRAND_ORANGE = rgb(0.98, 0.573, 0.055);
const INK_DARK = rgb(0.1, 0.1, 0.15);
const INK_MED = rgb(0.35, 0.35, 0.4);
const INK_LIGHT = rgb(0.6, 0.6, 0.65);

const GOLD_COLOR = rgb(0.72, 0.53, 0.04);
const SILVER_COLOR = rgb(0.45, 0.5, 0.56);
const BRONZE_COLOR = rgb(0.62, 0.36, 0.12);
const PART_COLOR = BRAND_TEAL;

type RGB = ReturnType<typeof rgb>;

function tierDisplayColor(tier: string): RGB {
  if (tier === "gold") return GOLD_COLOR;
  if (tier === "silver") return SILVER_COLOR;
  if (tier === "bronze") return BRONZE_COLOR;
  return PART_COLOR;
}

// Darker shade of a tier color, for seal ribbons.
function shade(c: RGB, f: number): RGB {
  return rgb(c.red * f, c.green * f, c.blue * f);
}

function tierHeadline(tier: string): string {
  if (tier === "gold" || tier === "silver" || tier === "bronze") {
    return "Certificate of Achievement";
  }
  return "Certificate of Participation";
}

function tierBody(tier: string, year: number): string {
  if (tier === "gold") return `has achieved the Gold tier in the SALCI Olympiad ${year}`;
  if (tier === "silver") return `has achieved the Silver tier in the SALCI Olympiad ${year}`;
  if (tier === "bronze") return `has achieved the Bronze tier in the SALCI Olympiad ${year}`;
  return `has participated in the SALCI Olympiad ${year}`;
}

function tierSealLabel(tier: string): string {
  if (tier === "gold") return "GOLD";
  if (tier === "silver") return "SILVER";
  if (tier === "bronze") return "BRONZE";
  return "SALCI";
}

// Helvetica/Times (WinAnsi) cannot encode arbitrary Unicode — scrub anything
// outside ASCII + Latin-1 letters so an unusual name never crashes pdf-lib.
function safeText(text: string): string {
  return (text ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7EÀ-ÿ]/g, "")
    .trim();
}

// Wide letter-spaced caps for eyebrow lines ("S A L C I  O L Y M P I A D").
function letterSpaced(text: string): string {
  return text.toUpperCase().split("").join(" ").replace(/ {3}/g, "    ");
}

// SALCI logo + (optional) authorised signature, fetched once per warm isolate
// from the olympiad-receipts bucket.
let logoBytesPromise: Promise<Uint8Array | null> | null = null;
let signatureBytesPromise: Promise<Uint8Array | null> | null = null;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // @ts-expect-error Deno.env
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error Deno.env
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // @ts-expect-error Deno.env
    const internalSecret = Deno.env.get("OLY_INTERNAL_SECRET");
    const isSystem =
      !!internalSecret && req.headers.get("x-internal-secret") === internalSecret;

    const { oly_result_id } = (await req.json()) as { oly_result_id: string };
    if (!oly_result_id) return json({ error: "Missing oly_result_id" }, 400);

    if (!isSystem) {
      const authHeader = req.headers.get("Authorization") ?? "";
      const token = authHeader.replace("Bearer ", "");
      if (!token) return json({ error: "Missing auth" }, 401);

      const { data: userRes } = await supabase.auth.getUser(token);
      const userId = userRes.user?.id;
      if (!userId) return json({ error: "Forbidden" }, 403);

      const { data: roleCheckRow } = await supabase
        .from("oly_results")
        .select("oly_school_id, oly_student_id")
        .eq("id", oly_result_id)
        .maybeSingle();
      if (!roleCheckRow) return json({ error: "Result not found" }, 404);

      const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
      const { data: isSchoolAdmin } = await supabase.rpc("oly_is_school_admin_for", {
        p_uid: userId, p_oly_school_id: roleCheckRow.oly_school_id,
      });
      // The assigned-class teacher may also download their own students' certificate —
      // oly_student_can_read includes the oly_is_teacher_for_class branch (class-scoped).
      let canTeacher = false;
      if (!isSuper && !isSchoolAdmin) {
        const { data: canRead } = await supabase.rpc("oly_student_can_read", {
          p_uid: userId, p_oly_student_id: roleCheckRow.oly_student_id,
        });
        canTeacher = canRead === true;
      }
      if (!isSuper && !isSchoolAdmin && !canTeacher) return json({ error: "Forbidden" }, 403);
    }

    // ── Load result row ────────────────────────────────────────────────────────
    const { data: result, error: rErr } = await supabase
      .from("oly_results")
      .select(
        "id, oly_student_id, campaign_id, oly_school_id, " +
        "total_marks_obtained, total_max_marks, percentage, " +
        "class_rank, class_total, certificate_tier, certificate_id, " +
        "certificate_pdf_path, published_at"
      )
      .eq("id", oly_result_id)
      .single();
    if (rErr || !result) return json({ error: "Result not found" }, 404);

    // Idempotency: skip absent students (no certificate for absent)
    if (result.certificate_tier === "absent") {
      return json({ ok: true, skipped: true, reason: "absent" }, 200);
    }

    // Idempotency: skip if already generated
    if (result.certificate_pdf_path) {
      return json({ ok: true, skipped: true, path: result.certificate_pdf_path }, 200);
    }

    // ── Load student ───────────────────────────────────────────────────────────
    const { data: student, error: sErr } = await supabase
      .from("oly_students")
      .select("full_name, roll_number, class_label, section_label")
      .eq("id", result.oly_student_id)
      .single();
    if (sErr || !student) return json({ error: "Student not found" }, 404);

    // ── Load school + institution + campaign ───────────────────────────────────
    const { data: school } = await supabase
      .from("oly_schools")
      .select("institution_id, institutions(name)")
      .eq("id", result.oly_school_id)
      .single();
    const schoolInst = Array.isArray((school as { institutions?: unknown } | null)?.institutions)
      ? ((school as { institutions: { name: string }[] }).institutions[0])
      : ((school as { institutions: { name: string } } | null)?.institutions);
    const schoolName = schoolInst?.name ?? "Unknown School";

    const { data: campaign } = await supabase
      .from("oly_campaigns")
      .select("campaign_year")
      .eq("id", result.campaign_id)
      .single();
    const campaignYear = (campaign as { campaign_year?: number } | null)?.campaign_year ?? new Date().getFullYear();

    // ── Fetch logo + signature (degrade gracefully if missing) ─────────────────
    if (!logoBytesPromise) {
      logoBytesPromise = supabase.storage
        .from("olympiad-receipts")
        .download("branding/salci-logo.png")
        .then(async ({ data, error }: { data: Blob | null; error: unknown }) =>
          error || !data ? null : new Uint8Array(await data.arrayBuffer()))
        .catch(() => null);
    }
    const logoBytes = await logoBytesPromise;

    // Real authorised signature: upload branding/authorised-signature.png to the
    // olympiad-receipts bucket and it is used automatically; until then the
    // certificate falls back to a script-style placeholder name.
    if (!signatureBytesPromise) {
      signatureBytesPromise = supabase.storage
        .from("olympiad-receipts")
        .download("branding/authorised-signature.png")
        .then(async ({ data, error }: { data: Blob | null; error: unknown }) =>
          error || !data ? null : new Uint8Array(await data.arrayBuffer()))
        .catch(() => null);
    }
    const signatureBytes = await signatureBytesPromise;

    // ── Build landscape A4 certificate (842 × 595) ────────────────────────────
    const PAGE_W = 842;
    const PAGE_H = 595;
    const CX = PAGE_W / 2;

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const serif = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    const serifBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
    const serifItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
    const logoImage = logoBytes ? await pdfDoc.embedPng(logoBytes).catch(() => null) : null;
    const signatureImage = signatureBytes ? await pdfDoc.embedPng(signatureBytes).catch(() => null) : null;

    const tierColor = tierDisplayColor(result.certificate_tier);

    const centered = (s: string, y: number, size: number, f = font, color: RGB = INK_DARK) => {
      const safe = safeText(s);
      page.drawText(safe, { x: CX - f.widthOfTextAtSize(safe, size) / 2, y, size, font: f, color });
    };
    // Shrink-to-fit for long names/school lines so nothing ever overflows the frame.
    const fitSize = (s: string, f: typeof serifBold, startSize: number, maxW: number) => {
      let size = startSize;
      while (size > 12 && f.widthOfTextAtSize(safeText(s), size) > maxW) size -= 1;
      return size;
    };

    // ── Background + clean illustrated frame ──────────────────────────────────
    // Simple and clear: white sheet, a single teal band with a scalloped lace
    // inner edge + white beading, a thin teal echo line, orange diamond nodes
    // on the band corners + side midpoints, and a few subtle four-point
    // sparkles in the corners. No background panel/tint behind the content.
    // All vector-drawn — no asset licences, crisp at print. Geometry validated
    // against scripts/oly-demo-seed/cert-preview.html.
    {
      const sparkle =
        "M 0 -9 Q 1.8 -1.8 9 0 Q 1.8 1.8 0 9 Q -1.8 1.8 -9 0 Q -1.8 -1.8 0 -9 Z";
      const diamond = "M 0 0 L 6 6 L 0 12 L -6 6 Z";

      // White sheet → teal band 18..30 → white interior
      page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(1, 1, 1) });
      page.drawRectangle({ x: 18, y: 18, width: PAGE_W - 36, height: PAGE_H - 36, color: BRAND_TEAL });
      page.drawRectangle({ x: 30, y: 30, width: PAGE_W - 60, height: PAGE_H - 60, color: rgb(1, 1, 1) });

      // Lace edge — white discs centred on the band's inner rim bite half-moons
      const R = 6.5;
      const STEP = 16;
      for (let x = 30 + STEP / 2; x <= PAGE_W - 30 - STEP / 2; x += STEP) {
        page.drawCircle({ x, y: PAGE_H - 30, size: R, color: rgb(1, 1, 1) });
        page.drawCircle({ x, y: 30, size: R, color: rgb(1, 1, 1) });
      }
      for (let y = 30 + STEP / 2; y <= PAGE_H - 30 - STEP / 2; y += STEP) {
        page.drawCircle({ x: 30, y, size: R, color: rgb(1, 1, 1) });
        page.drawCircle({ x: PAGE_W - 30, y, size: R, color: rgb(1, 1, 1) });
      }
      // White beads centred in the band, sitting between the scallops
      for (let x = 46; x <= PAGE_W - 46; x += STEP) {
        page.drawCircle({ x, y: 24, size: 1.1, color: rgb(1, 1, 1), opacity: 0.85 });
        page.drawCircle({ x, y: PAGE_H - 24, size: 1.1, color: rgb(1, 1, 1), opacity: 0.85 });
      }
      for (let y = 46; y <= PAGE_H - 46; y += STEP) {
        page.drawCircle({ x: 24, y, size: 1.1, color: rgb(1, 1, 1), opacity: 0.85 });
        page.drawCircle({ x: PAGE_W - 24, y, size: 1.1, color: rgb(1, 1, 1), opacity: 0.85 });
      }

      // Thin teal echo line just inside the lace edge
      page.drawRectangle({
        x: 46, y: 46, width: PAGE_W - 92, height: PAGE_H - 92,
        borderColor: BRAND_TEAL, borderWidth: 0.6,
      });

      // Orange diamond nodes on the band: four corners + side midpoints
      for (const [dx2, dy2] of [
        [24, 29], [PAGE_W - 24, 29], [24, PAGE_H - 19], [PAGE_W - 24, PAGE_H - 19],
        [24, PAGE_H / 2 + 5], [PAGE_W - 24, PAGE_H / 2 + 5],
      ] as Array<[number, number]>) {
        page.drawSvgPath(diamond, { x: dx2, y: dy2, scale: 0.85, color: BRAND_ORANGE });
      }

      // A few subtle four-point sparkles in the corners (clear of the content)
      const sparkles: Array<[number, number, number, RGB]> = [
        [76, PAGE_H - 80, 0.9, BRAND_ORANGE],
        [100, PAGE_H - 106, 0.5, BRAND_TEAL],
        [PAGE_W - 76, PAGE_H - 80, 0.9, BRAND_ORANGE],
        [PAGE_W - 100, PAGE_H - 106, 0.5, BRAND_TEAL],
        [76, 80, 0.6, BRAND_TEAL],
        [100, 103, 0.4, BRAND_ORANGE],
        [PAGE_W - 76, 80, 0.6, BRAND_TEAL],
        [PAGE_W - 100, 103, 0.4, BRAND_ORANGE],
      ];
      for (const [sx, sy, sc, col] of sparkles) {
        page.drawSvgPath(sparkle, { x: sx, y: sy, scale: sc, color: col });
      }
    }

    // ── Header: logo + campaign eyebrow ───────────────────────────────────────
    if (logoImage) {
      const logoH = 42;
      const logoW = (logoImage.width / logoImage.height) * logoH;
      page.drawImage(logoImage, { x: CX - logoW / 2, y: PAGE_H - 60 - logoH, width: logoW, height: logoH });
    } else {
      centered("SALCI", PAGE_H - 88, 30, fontBold, BRAND_TEAL);
    }
    centered(letterSpaced(`Olympiad ${campaignYear}`), PAGE_H - 122, 10, fontBold, BRAND_TEAL);

    // ── Headline ──────────────────────────────────────────────────────────────
    centered(tierHeadline(result.certificate_tier), PAGE_H - 162, 33, serifBold, tierColor);

    // Ornamental divider: line · diamond · line
    const divY = PAGE_H - 180;
    page.drawLine({ start: { x: CX - 150, y: divY }, end: { x: CX - 14, y: divY }, thickness: 0.8, color: tierColor });
    page.drawLine({ start: { x: CX + 14, y: divY }, end: { x: CX + 150, y: divY }, thickness: 0.8, color: tierColor });
    page.drawSvgPath("M 0 0 L 6 6 L 0 12 L -6 6 Z", { x: CX, y: divY + 6, color: tierColor });

    // ── Recipient ─────────────────────────────────────────────────────────────
    centered("This is to certify that", PAGE_H - 212, 13, serifItalic, INK_MED);

    const nameSize = fitSize(student.full_name, serifBold, 32, 600);
    centered(student.full_name, PAGE_H - 248, nameSize, serifBold, INK_DARK);
    // Gentle swash under the name
    const nameW = serifBold.widthOfTextAtSize(safeText(student.full_name), nameSize);
    const swashW = Math.min(Math.max(nameW + 60, 240), 640);
    page.drawSvgPath(`M 0 0 Q ${swashW / 2} 9 ${swashW} 0`, {
      x: CX - swashW / 2, y: PAGE_H - 256, borderColor: tierColor, borderWidth: 1,
    });

    const classLine = `${student.class_label}${student.section_label ? ` — Section ${student.section_label}` : ""}`;
    const schoolLine = `of ${schoolName}  ·  ${classLine}`;
    centered(schoolLine, PAGE_H - 282, fitSize(schoolLine, font, 12.5, 620), font, INK_MED);

    // ── Achievement body ──────────────────────────────────────────────────────
    centered(tierBody(result.certificate_tier, campaignYear), PAGE_H - 312, 15, serifItalic, INK_DARK);

    // Score + class rank (no school rank on the certificate)
    const pct = Number(result.percentage).toFixed(2);
    const scoreStr = `Score  ${Number(result.total_marks_obtained).toFixed(0)} / ${Number(result.total_max_marks).toFixed(0)}   ·   ${pct}%`;
    centered(scoreStr, PAGE_H - 342, 13.5, fontBold, INK_DARK);
    if (result.certificate_tier !== "participation" && result.class_rank) {
      centered(`Rank in Class: ${result.class_rank} of ${result.class_total ?? "—"}`, PAGE_H - 362, 11.5, font, INK_MED);
    }

    // ── Medal seal (center-bottom) with ribbons ───────────────────────────────
    {
      const sealCX = CX;
      const sealCY = 146;
      const R = 40;
      const dark = shade(tierColor, 0.75);

      // Ribbon tails (drawn first, behind the disc)
      page.drawSvgPath("M 0 0 L 22 6 L 14 52 L -6 42 Z", { x: sealCX - 20, y: sealCY - R + 14, color: dark });
      page.drawSvgPath("M 0 6 L 22 0 L 28 42 L 8 52 Z", { x: sealCX - 2, y: sealCY - R + 14, color: dark });

      // Scalloped rosette edge
      const SCALLOPS = 20;
      for (let i = 0; i < SCALLOPS; i++) {
        const a = (i / SCALLOPS) * Math.PI * 2;
        page.drawCircle({ x: sealCX + Math.cos(a) * R, y: sealCY + Math.sin(a) * R, size: 5.5, color: tierColor });
      }
      // Main disc + inner ring
      page.drawCircle({ x: sealCX, y: sealCY, size: R + 2, color: tierColor });
      page.drawCircle({ x: sealCX, y: sealCY, size: R - 7, borderColor: rgb(1, 1, 1), borderWidth: 1.2 });

      const sealTop = "SALCI OLYMPIAD";
      page.drawText(sealTop, {
        x: sealCX - fontBold.widthOfTextAtSize(sealTop, 6.5) / 2, y: sealCY + 14,
        size: 6.5, font: fontBold, color: rgb(1, 1, 1),
      });
      const sealMain = tierSealLabel(result.certificate_tier);
      page.drawText(sealMain, {
        x: sealCX - fontBold.widthOfTextAtSize(sealMain, 13) / 2, y: sealCY - 4,
        size: 13, font: fontBold, color: rgb(1, 1, 1),
      });
      const sealYear = String(campaignYear);
      page.drawText(sealYear, {
        x: sealCX - fontBold.widthOfTextAtSize(sealYear, 8) / 2, y: sealCY - 18,
        size: 8, font: fontBold, color: rgb(1, 1, 1),
      });
    }

    // ── Signature blocks (left: date, right: authorised) ──────────────────────
    {
      const lineY = 108;
      const blockW = 170;
      // Left — date (inset 130 keeps both blocks inside the arch panel)
      const lx = 130;
      const dateStr = new Date(result.published_at).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
      page.drawText(safeText(dateStr), {
        x: lx + (blockW - font.widthOfTextAtSize(safeText(dateStr), 11)) / 2, y: lineY + 6,
        size: 11, font, color: INK_DARK,
      });
      page.drawLine({ start: { x: lx, y: lineY }, end: { x: lx + blockW, y: lineY }, thickness: 0.7, color: INK_LIGHT });
      page.drawText("DATE", {
        x: lx + (blockW - fontBold.widthOfTextAtSize("DATE", 7.5)) / 2, y: lineY - 14,
        size: 7.5, font: fontBold, color: INK_LIGHT,
      });

      // Right — authorised signatory. Uses the real signature image when
      // branding/authorised-signature.png exists; placeholder script name
      // ("Gaurav Garg") until the real signature is uploaded.
      const rx = PAGE_W - 130 - blockW;
      if (signatureImage) {
        const sigH = 34;
        const sigW = Math.min((signatureImage.width / signatureImage.height) * sigH, blockW);
        page.drawImage(signatureImage, { x: rx + (blockW - sigW) / 2, y: lineY + 3, width: sigW, height: sigH });
      } else {
        const sig = "Gaurav Garg";
        page.drawText(sig, {
          x: rx + (blockW - serifItalic.widthOfTextAtSize(sig, 17)) / 2, y: lineY + 5,
          size: 17, font: serifItalic, color: INK_DARK,
        });
      }
      page.drawLine({ start: { x: rx, y: lineY }, end: { x: rx + blockW, y: lineY }, thickness: 0.7, color: INK_LIGHT });
      page.drawText("AUTHORISED SIGNATORY", {
        x: rx + (blockW - fontBold.widthOfTextAtSize("AUTHORISED SIGNATORY", 7.5)) / 2, y: lineY - 14,
        size: 7.5, font: fontBold, color: INK_LIGHT,
      });
    }

    // ── Certificate ID (centred at the foot, below the seal ribbons) ──────────
    centered(`Certificate ID: ${result.certificate_id}   ·   Verify with SALCI`, 54, 8, font, INK_LIGHT);

    // ── Upload ────────────────────────────────────────────────────────────────
    const pdfBytes = await pdfDoc.save();
    const storagePath = `certificates/${oly_result_id}.pdf`;
    const { error: upErr } = await supabase.storage
      .from("olympiad-receipts")
      .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upErr) return json({ error: `Storage upload failed: ${upErr.message}` }, 500);

    // ── Update result row ──────────────────────────────────────────────────────
    const { error: updErr } = await supabase
      .from("oly_results")
      .update({
        certificate_pdf_path: storagePath,
        certificate_pdf_generated_at: new Date().toISOString(),
      })
      .eq("id", oly_result_id);
    if (updErr) return json({ error: `Result update failed: ${updErr.message}` }, 500);

    // ── Audit log ─────────────────────────────────────────────────────────────
    await supabase.from("oly_audit_log").insert({
      campaign_id: result.campaign_id,
      oly_school_id: result.oly_school_id,
      actor_id: null,
      actor_role: "super_admin",
      action: "certificate_pdf_generated",
      after_json: { result_id: oly_result_id, tier: result.certificate_tier, path: storagePath },
    });

    return json({ ok: true, path: storagePath }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
