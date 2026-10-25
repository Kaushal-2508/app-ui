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

// Brand palette (mirrors src/index.css tokens)
const BRAND_TEAL = rgb(0.141, 0.612, 0.639);
const BRAND_ORANGE = rgb(0.98, 0.573, 0.055);
const INK_DARK = rgb(0.1, 0.1, 0.15);
const INK_MED = rgb(0.35, 0.35, 0.4);
const INK_LIGHT = rgb(0.55, 0.55, 0.6);
const GREEN = rgb(0.1, 0.55, 0.28);
const AMBER = rgb(0.78, 0.55, 0.05);
const RED = rgb(0.78, 0.18, 0.18);
const GOLD = rgb(0.78, 0.62, 0.05);
const SILVER = rgb(0.5, 0.55, 0.6);
const BRONZE = rgb(0.72, 0.42, 0.15);
const STROKE = rgb(0.88, 0.9, 0.92);
const PANEL = rgb(0.955, 0.975, 0.98);
const ROW_ALT = rgb(0.97, 0.982, 0.988);

// ── Text safety ──────────────────────────────────────────────────────────────
// Helvetica (WinAnsi) cannot encode ✓, √, Greek letters, ₹ etc. — pdf-lib
// THROWS on them, killing the whole report. Everything drawn must pass
// through this: map common symbols to safe equivalents, then scrub the rest.
function sanitizeWinAnsi(text: string): string {
  if (!text) return "";
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/₹/g, "Rs ")
    .replace(/√/g, "sqrt")
    .replace(/α/g, "alpha")
    .replace(/β/g, "beta")
    .replace(/γ/g, "gamma")
    .replace(/δ/g, "delta")
    .replace(/π/g, "pi")
    .replace(/θ/g, "theta")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/≠/g, "!=")
    .replace(/[✓✔✗✘•]/g, "")
    .replace(/\u00A0/g, " ")
    // Keep ASCII plus the WinAnsi-safe symbols we deliberately produce.
    .replace(/[^\x20-\x7E×÷±²³°·À-ÿ]/g, "?");
}

function tierLabel(tier: string): string {
  const map: Record<string, string> = {
    gold: "GOLD",
    silver: "SILVER",
    bronze: "BRONZE",
    participation: "PARTICIPATION",
    absent: "ABSENT",
  };
  return map[tier] ?? tier.toUpperCase();
}

function tierColor(tier: string): ReturnType<typeof rgb> {
  if (tier === "gold") return GOLD;
  if (tier === "silver") return SILVER;
  if (tier === "bronze") return BRONZE;
  return BRAND_TEAL;
}

function accuracyColor(pct: number): ReturnType<typeof rgb> {
  if (pct < 40) return RED;
  if (pct < 60) return AMBER;
  return GREEN;
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  const last = n % 10;
  if (last === 1) return `${n}st`;
  if (last === 2) return `${n}nd`;
  if (last === 3) return `${n}rd`;
  return `${n}th`;
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

// SALCI logo, fetched once per warm isolate from the olympiad-receipts bucket.
let logoBytesPromise: Promise<Uint8Array | null> | null = null;

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
      // User-facing path — verify caller is super_admin or the school's olympiad admin
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
      // The assigned-class teacher may also download their own students' report —
      // oly_student_can_read includes the oly_is_teacher_for_class branch (and is
      // class-scoped, so a teacher can only reach students in their assigned grade).
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
        "id, oly_student_id, oly_attempt_id, campaign_id, oly_school_id, " +
        "total_marks_obtained, total_max_marks, percentage, subject_scores, " +
        "total_time_seconds, class_rank, class_total, school_rank, school_total, " +
        "certificate_tier, certificate_id, result_pdf_path, published_at"
      )
      .eq("id", oly_result_id)
      .single();
    if (rErr || !result) return json({ error: "Result not found" }, 404);

    // No report for absent students (mirrors the certificate generator)
    if (result.certificate_tier === "absent") {
      return json({ ok: true, skipped: true, reason: "absent" }, 200);
    }

    // Idempotency: skip if already generated
    if (result.result_pdf_path) {
      return json({ ok: true, skipped: true, path: result.result_pdf_path }, 200);
    }

    // ── Load student ───────────────────────────────────────────────────────────
    const { data: student, error: sErr } = await supabase
      .from("oly_students")
      .select("full_name, roll_number, class_label, section_label, subject_ids, grade_level_id")
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

    // ── Load attempt + questions snapshot + answers ────────────────────────────
    type SnapshotRow = {
      id: string;
      subject_id: string;
      topic_id: string | null;
      position_in_subject: number;
      question_text: string;
      option_a: string;
      option_b: string;
      option_c: string;
      option_d: string;
      correct_answer: string;
      marks: number;
    };

    type AnswerRow = {
      oly_question_snapshot_id: string;
      selected_answer: string | null;
      time_spent_seconds: number | null;
    };

    type SubjectRow = {
      id: string;
      name: string;
    };

    let snapshots: SnapshotRow[] = [];
    const answerMap = new Map<string, string | null>();
    const timeMap = new Map<string, number>();

    if (result.oly_attempt_id) {
      const { data: snaps } = await supabase
        .from("oly_questions_snapshot")
        .select("id, subject_id, topic_id, position_in_subject, question_text, option_a, option_b, option_c, option_d, correct_answer, marks")
        .eq("oly_attempt_id", result.oly_attempt_id)
        .order("subject_id")
        .order("position_in_subject");
      snapshots = snaps ?? [];

      if (snapshots.length > 0) {
        const snapshotIds = snapshots.map((s) => s.id);
        const { data: answers } = await supabase
          .from("oly_answers")
          .select("oly_question_snapshot_id, selected_answer, time_spent_seconds")
          .in("oly_question_snapshot_id", snapshotIds);
        for (const a of (answers ?? []) as AnswerRow[]) {
          answerMap.set(a.oly_question_snapshot_id, a.selected_answer);
          timeMap.set(a.oly_question_snapshot_id, a.time_spent_seconds ?? 0);
        }
      }
    }

    // ── Load subject names ─────────────────────────────────────────────────────
    const subjectIds = (student.subject_ids ?? []) as string[];
    const { data: subjectsData } = await supabase
      .from("oly_subjects")
      .select("id, name")
      .in("id", subjectIds.length > 0 ? subjectIds : ["00000000-0000-0000-0000-000000000000"]);
    const subjectNameMap = new Map<string, string>();
    for (const sub of (subjectsData ?? []) as SubjectRow[]) {
      subjectNameMap.set(sub.id, sub.name);
    }

    type SubjectScore = {
      subject_id: string;
      subject_name: string;
      correct: number;
      total: number;
      marks_obtained: number;
      marks_max: number;
      percentage?: number;
    };
    const subjectScores: SubjectScore[] = Array.isArray(result.subject_scores)
      ? (result.subject_scores as SubjectScore[])
      : [];

    // ── Performance analysis (mirrors the oly_student_performance_analysis RPC;
    //    computed inline here because that RPC needs auth.uid(), which is null
    //    under the service role used by this generator) ─────────────────────────
    type TopicStat = {
      topic_name: string;
      subject_name: string;
      questions: number;
      attempted: number;
      correct: number;
      pct_correct: number;
      avg_time_seconds: number;
    };

    // Per-question facts from the snapshot + answer join.
    const qaRows = snapshots.map((s) => {
      const sel = answerMap.get(s.id) ?? null;
      return {
        subject_id: s.subject_id,
        topic_id: s.topic_id,
        attempted: sel !== null,
        is_correct: sel !== null && sel === s.correct_answer,
        secs: timeMap.get(s.id) ?? 0,
      };
    });

    // Topic names for the radar / strengths / focus areas.
    const topicIds = Array.from(
      new Set(snapshots.map((s) => s.topic_id).filter((t): t is string => !!t)),
    );
    const topicNameMap = new Map<string, string>();
    if (topicIds.length > 0) {
      const { data: topicRows } = await supabase
        .from("oly_topics")
        .select("id, name")
        .in("id", topicIds);
      for (const t of (topicRows ?? []) as { id: string; name: string }[]) {
        topicNameMap.set(t.id, t.name);
      }
    }

    // Aggregate per topic.
    const topicAgg = new Map<
      string,
      { subject_id: string; questions: number; attempted: number; correct: number; secs: number }
    >();
    for (const r of qaRows) {
      const key = r.topic_id ?? "none";
      const g = topicAgg.get(key) ?? { subject_id: r.subject_id, questions: 0, attempted: 0, correct: 0, secs: 0 };
      g.questions += 1;
      if (r.attempted) g.attempted += 1;
      if (r.is_correct) g.correct += 1;
      g.secs += r.secs;
      topicAgg.set(key, g);
    }
    const topicStats: TopicStat[] = Array.from(topicAgg.entries()).map(([tid, g]) => ({
      topic_name: topicNameMap.get(tid) ?? "General",
      subject_name: subjectNameMap.get(g.subject_id) ?? "-",
      questions: g.questions,
      attempted: g.attempted,
      correct: g.correct,
      pct_correct: g.questions > 0 ? Math.round((g.correct / g.questions) * 1000) / 10 : 0,
      avg_time_seconds: g.questions > 0 ? Math.round((g.secs / g.questions) * 10) / 10 : 0,
    }));

    // Time intelligence.
    const totalSecs = qaRows.reduce((a, r) => a + r.secs, 0);
    const attemptedCount = qaRows.filter((r) => r.attempted).length;
    const correctRows = qaRows.filter((r) => r.is_correct);
    const incorrectRows = qaRows.filter((r) => r.attempted && !r.is_correct);
    const meanSecs = (rows: { secs: number }[]) =>
      rows.length ? rows.reduce((a, r) => a + r.secs, 0) / rows.length : 0;
    const timeStats = {
      total_seconds: totalSecs,
      questions: qaRows.length,
      correct: correctRows.length,
      incorrect: incorrectRows.length,
      unanswered: qaRows.length - attemptedCount,
      avg_per_q: qaRows.length ? totalSecs / qaRows.length : 0,
      avg_correct: meanSecs(correctRows),
      avg_incorrect: meanSecs(incorrectRows),
    };
    // Fastest / slowest topic by average time (topics actually attempted).
    const timedTopics = topicStats.filter((t) => t.attempted > 0 && t.avg_time_seconds > 0);
    let fastestTopic: TopicStat | null = null;
    let slowestTopic: TopicStat | null = null;
    for (const t of timedTopics) {
      if (!fastestTopic || t.avg_time_seconds < fastestTopic.avg_time_seconds) fastestTopic = t;
      if (!slowestTopic || t.avg_time_seconds > slowestTopic.avg_time_seconds) slowestTopic = t;
    }

    // Benchmark — you vs class (same grade) vs school (non-absent published).
    let classAvg: number | null = null;
    let schoolAvg: number | null = null;
    {
      type BenchRow = {
        percentage: number;
        certificate_tier: string;
        oly_students: { grade_level_id: string | null } | { grade_level_id: string | null }[] | null;
      };
      const benchAll: BenchRow[] = [];
      const PAGE = 1000;
      let from = 0;
      for (;;) {
        const { data: pageRows } = await supabase
          .from("oly_results")
          .select("percentage, certificate_tier, oly_students!inner(grade_level_id)")
          .eq("oly_school_id", result.oly_school_id)
          .range(from, from + PAGE - 1);
        const rows = (pageRows ?? []) as BenchRow[];
        benchAll.push(...rows);
        if (rows.length < PAGE) break;
        from += PAGE;
      }
      const gradeOf = (r: BenchRow) =>
        Array.isArray(r.oly_students)
          ? r.oly_students[0]?.grade_level_id ?? null
          : r.oly_students?.grade_level_id ?? null;
      const nonAbsent = benchAll.filter((r) => r.certificate_tier !== "absent");
      if (nonAbsent.length > 0) {
        schoolAvg =
          Math.round((nonAbsent.reduce((a, r) => a + Number(r.percentage), 0) / nonAbsent.length) * 10) / 10;
        const classRows = nonAbsent.filter((r) => gradeOf(r) === student.grade_level_id);
        if (classRows.length > 0) {
          classAvg =
            Math.round((classRows.reduce((a, r) => a + Number(r.percentage), 0) / classRows.length) * 10) / 10;
        }
      }
    }

    // ── Fetch logo (cached per isolate; report degrades gracefully without) ────
    if (!logoBytesPromise) {
      logoBytesPromise = supabase.storage
        .from("olympiad-receipts")
        .download("branding/salci-logo.png")
        .then(async ({ data, error }: { data: Blob | null; error: unknown }) =>
          error || !data ? null : new Uint8Array(await data.arrayBuffer()))
        .catch(() => null);
    }
    const logoBytes = await logoBytesPromise;

    // ── Build PDF ──────────────────────────────────────────────────────────────
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    const logoImage = logoBytes ? await pdfDoc.embedPng(logoBytes).catch(() => null) : null;

    const PAGE_W = 595;
    const PAGE_H = 842;
    const MARGIN = 48;
    const CONTENT_W = PAGE_W - MARGIN * 2;
    const FOOTER_SPACE = 64; // reserved at the bottom of every page

    // Mutable layout cursor — all drawing goes through these helpers so that
    // page breaks are computed from MEASURED text height (nothing is ever
    // clipped or cut off mid-block).
    const cur = { page: pdfDoc.addPage([PAGE_W, PAGE_H]), y: PAGE_H - MARGIN };

    const text = (
      s: string,
      x: number,
      yPos: number,
      size: number,
      f = font,
      color = INK_DARK,
    ) => {
      cur.page.drawText(sanitizeWinAnsi(s), { x, y: yPos, size, font: f, color });
    };

    const textRight = (
      s: string,
      rightX: number,
      yPos: number,
      size: number,
      f = font,
      color = INK_DARK,
    ) => {
      const safe = sanitizeWinAnsi(s);
      text(safe, rightX - f.widthOfTextAtSize(safe, size), yPos, size, f, color);
    };

    // Width-measured word wrap (with hard breaks for pathological words).
    const wrap = (s: string, size: number, maxW: number, f = font): string[] => {
      const out: string[] = [];
      const safe = sanitizeWinAnsi(s);
      for (const raw of safe.split("\n")) {
        const words = raw.split(/\s+/).filter(Boolean);
        if (words.length === 0) continue;
        let line = "";
        for (let word of words) {
          while (f.widthOfTextAtSize(word, size) > maxW) {
            let i = 1;
            while (i < word.length && f.widthOfTextAtSize(word.slice(0, i + 1), size) <= maxW) i++;
            if (line) { out.push(line); line = ""; }
            out.push(word.slice(0, i));
            word = word.slice(i);
          }
          const candidate = line ? `${line} ${word}` : word;
          if (f.widthOfTextAtSize(candidate, size) <= maxW) line = candidate;
          else { if (line) out.push(line); line = word; }
        }
        if (line) out.push(line);
      }
      return out.length > 0 ? out : [""];
    };

    // Start a new page when `needed` points of height won't fit above the footer.
    const breakIfNeeded = (needed: number, onNewPage?: () => void) => {
      if (cur.y - needed < FOOTER_SPACE) {
        cur.page = pdfDoc.addPage([PAGE_W, PAGE_H]);
        cur.y = PAGE_H - MARGIN;
        if (onNewPage) onNewPage();
      }
    };

    // ── Shared chart helpers (used by the page-1 response donut and the page-2
    //    performance-analysis charts) ──────────────────────────────────────────
    // Fill a closed polygon given in PDF (y-up) coords. pdf-lib's drawSvgPath
    // uses an SVG (y-down) space whose origin we pin at the page top-left, so
    // each point maps straight back to PDF coordinates.
    const toPath = (X: number, Y: number) => `${X.toFixed(2)} ${(PAGE_H - Y).toFixed(2)}`;
    const fillPolygon = (
      pts: Array<[number, number]>,
      opts: { color?: ReturnType<typeof rgb>; opacity?: number; borderColor?: ReturnType<typeof rgb>; borderWidth?: number },
    ) => {
      if (pts.length < 2) return;
      let d = `M ${toPath(pts[0][0], pts[0][1])}`;
      for (let i = 1; i < pts.length; i++) d += ` L ${toPath(pts[i][0], pts[i][1])}`;
      d += " Z";
      cur.page.drawSvgPath(d, {
        x: 0, y: PAGE_H,
        color: opts.color, opacity: opts.opacity,
        borderColor: opts.borderColor, borderWidth: opts.borderWidth,
        borderOpacity: opts.borderColor ? 1 : undefined,
      });
    };
    const LILAC = rgb(0.56, 0.49, 0.75); // class-average accent (matches app)
    const GREY = rgb(0.62, 0.65, 0.69);
    const DOT_PALETTE = [BRAND_TEAL, BRAND_ORANGE, rgb(0.55, 0.36, 0.96), rgb(0.05, 0.65, 0.91), rgb(0.06, 0.72, 0.51), rgb(0.96, 0.25, 0.37)];
    const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "..." : s);
    // Small eyebrow + title header used by every analytics block; returns new y.
    const blockHeader = (x: number, y: number, eyebrow: string, title: string): number => {
      text(eyebrow, x, y, 7, font, INK_LIGHT);
      text(title, x, y - 14, 11.5, fontBold, INK_DARK);
      return y - 30;
    };
    // Correct / Incorrect / Unanswered donut + legend + context, drawn at cur.y.
    const drawResponseDonut = () => {
      breakIfNeeded(130);
      const y0 = blockHeader(MARGIN, cur.y, "RESPONSE BREAKDOWN (VIA PIE)", "How your answers landed");
      const slices = [
        { label: "Correct", value: timeStats.correct, color: GREEN },
        { label: "Incorrect", value: timeStats.incorrect, color: RED },
        { label: "Unanswered", value: timeStats.unanswered, color: GREY },
      ].filter((s) => s.value > 0);
      const total = slices.reduce((a, s) => a + s.value, 0);
      const R = 46;
      const cx = MARGIN + R + 6;
      const cy = y0 - R - 4;
      if (total > 0) {
        let startDeg = 90;
        for (const s of slices) {
          const sweep = (s.value / total) * 360;
          const segs = Math.max(2, Math.round(sweep / 12));
          const pts: Array<[number, number]> = [[cx, cy]];
          for (let k = 0; k <= segs; k++) {
            const a = ((startDeg - (sweep * k) / segs) * Math.PI) / 180;
            pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
          }
          fillPolygon(pts, { color: s.color });
          startDeg -= sweep;
        }
        cur.page.drawCircle({ x: cx, y: cy, size: R * 0.55, color: rgb(1, 1, 1) });
      }
      const legX = cx + R + 26;
      let legY = y0 - 6;
      for (const s of slices) {
        cur.page.drawCircle({ x: legX + 3, y: legY + 3, size: 3.2, color: s.color });
        text(`${s.label}`, legX + 12, legY, 9.5, fontBold, INK_DARK);
        textRight(`${s.value}  ·  ${Math.round((s.value / total) * 100)}%`, PAGE_W - MARGIN, legY, 9, font, INK_MED);
        legY -= 17;
      }
      legY -= 4;
      const ctx = `Of ${timeStats.questions} questions, you answered ${timeStats.correct} correctly, ${timeStats.incorrect} incorrectly, and left ${timeStats.unanswered} unanswered.`;
      for (const line of wrap(ctx, 8.5, PAGE_W - MARGIN - legX, fontItalic)) {
        text(line, legX, legY, 8.5, fontItalic, INK_LIGHT);
        legY -= 12;
      }
      cur.y = Math.min(cy - R - 10, legY) - 8;
    };

    // ── PAGE 1 — header ────────────────────────────────────────────────────────
    {
      const headerTop = PAGE_H - 44;
      if (logoImage) {
        const logoH = 36;
        const logoW = (logoImage.width / logoImage.height) * logoH;
        cur.page.drawImage(logoImage, { x: MARGIN, y: headerTop - logoH + 6, width: logoW, height: logoH });
      } else {
        text("SALCI", MARGIN, headerTop - 18, 26, fontBold, BRAND_TEAL);
      }
      textRight("RESULT REPORT", PAGE_W - MARGIN, headerTop - 10, 15, fontBold, BRAND_TEAL);
      textRight(`SALCI Olympiad ${campaignYear}`, PAGE_W - MARGIN, headerTop - 26, 9.5, font, INK_MED);

      // Brand rule: orange tick + teal run
      const ruleY = headerTop - 44;
      cur.page.drawLine({ start: { x: MARGIN, y: ruleY }, end: { x: MARGIN + 54, y: ruleY }, thickness: 2.5, color: BRAND_ORANGE });
      cur.page.drawLine({ start: { x: MARGIN + 54, y: ruleY }, end: { x: PAGE_W - MARGIN, y: ruleY }, thickness: 2.5, color: BRAND_TEAL });
      cur.y = ruleY - 22;
    }

    // ── PAGE 1 — student identity panel ───────────────────────────────────────
    {
      const padX = 14;
      const innerW = CONTENT_W - padX * 2;
      const nameLines = wrap(student.full_name, 19, innerW, fontBold);
      const subjectList = subjectIds.map((id) => subjectNameMap.get(id) ?? "Unknown").join("  ·  ");
      const subjLines = wrap(`Subjects: ${subjectList}`, 9.5, innerW);
      const panelH = 14 + nameLines.length * 23 + 16 + 15 + subjLines.length * 12 + 12;

      const top = cur.y;
      cur.page.drawRectangle({
        x: MARGIN, y: top - panelH, width: CONTENT_W, height: panelH,
        color: PANEL, borderColor: STROKE, borderWidth: 0.8,
      });

      let ty = top - 14 - 16;
      for (const line of nameLines) {
        text(line, MARGIN + padX, ty, 19, fontBold, INK_DARK);
        ty -= 23;
      }
      ty += 23 - 18;
      const idLine = `Roll No. ${student.roll_number}   ·   ${student.class_label}${student.section_label ? ` — Section ${student.section_label}` : ""}`;
      text(idLine, MARGIN + padX, ty, 10.5, font, INK_MED);
      textRight(
        `Published ${new Date(result.published_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`,
        PAGE_W - MARGIN - padX, ty, 9, font, INK_LIGHT,
      );
      ty -= 15;
      text(schoolName, MARGIN + padX, ty, 10.5, font, INK_MED);
      ty -= 15;
      for (const line of subjLines) {
        text(line, MARGIN + padX, ty, 9.5, font, INK_LIGHT);
        ty -= 12;
      }
      cur.y = top - panelH - 26;
    }

    // ── PAGE 1 — headline score + tier ────────────────────────────────────────
    {
      const pctStr = `${Number(result.percentage).toFixed(2)}%`;
      text(pctStr, MARGIN, cur.y - 30, 38, fontBold, BRAND_TEAL);
      text(
        `${Number(result.total_marks_obtained).toFixed(0)} / ${Number(result.total_max_marks).toFixed(0)} marks`,
        MARGIN, cur.y - 48, 12, font, INK_MED,
      );

      // Tier pill, right-aligned
      const tLabel = tierLabel(result.certificate_tier);
      const tColor = tierColor(result.certificate_tier);
      const pillTextW = fontBold.widthOfTextAtSize(tLabel, 10.5);
      const pillW = pillTextW + 28;
      const pillH = 24;
      const pillX = PAGE_W - MARGIN - pillW;
      const pillY = cur.y - 32;
      cur.page.drawRectangle({ x: pillX, y: pillY, width: pillW, height: pillH, color: tColor });
      text(tLabel, pillX + 14, pillY + 8, 10.5, fontBold, rgb(1, 1, 1));
      textRight("CERTIFICATE TIER", PAGE_W - MARGIN, pillY + pillH + 7, 7.5, font, INK_LIGHT);

      cur.y -= 72;
    }

    // ── PAGE 1 — stat boxes ───────────────────────────────────────────────────
    {
      const totalCorrect = subjectScores.reduce((acc, s) => acc + (s.correct ?? 0), 0);
      const totalQ = subjectScores.reduce((acc, s) => acc + (s.total ?? 0), 0);
      const stats: Array<[string, string]> = [
        ["CLASS RANK", result.class_rank ? `${ordinal(result.class_rank)} of ${result.class_total ?? "—"}` : "—"],
        ["QUESTIONS CORRECT", totalQ > 0 ? `${totalCorrect} of ${totalQ}` : "—"],
        ["TIME TAKEN", result.total_time_seconds ? formatTime(result.total_time_seconds) : "—"],
      ];
      const gap = 12;
      const boxW = (CONTENT_W - gap * 2) / 3;
      const boxH = 52;
      stats.forEach(([label, value], i) => {
        const x = MARGIN + i * (boxW + gap);
        cur.page.drawRectangle({
          x, y: cur.y - boxH, width: boxW, height: boxH,
          color: rgb(1, 1, 1), borderColor: STROKE, borderWidth: 0.8,
        });
        text(label, x + 12, cur.y - 19, 7.5, font, INK_LIGHT);
        text(value, x + 12, cur.y - 38, 14, fontBold, INK_DARK);
      });
      cur.y -= boxH + 30;
    }

    // ── PAGE 1 — subject-wise summary table ───────────────────────────────────
    {
      text("Subject-wise performance", MARGIN, cur.y, 13, fontBold, BRAND_TEAL);
      cur.y -= 10;
      cur.page.drawLine({ start: { x: MARGIN, y: cur.y }, end: { x: PAGE_W - MARGIN, y: cur.y }, thickness: 0.8, color: STROKE });
      cur.y -= 16;

      const colSubject = MARGIN + 10;
      const colMarks = MARGIN + 240;
      const colCorrect = MARGIN + 315;
      const barX = MARGIN + 385;
      const barW = 70;

      text("SUBJECT", colSubject, cur.y, 7.5, font, INK_LIGHT);
      text("MARKS", colMarks, cur.y, 7.5, font, INK_LIGHT);
      text("CORRECT", colCorrect, cur.y, 7.5, font, INK_LIGHT);
      text("ACCURACY", barX, cur.y, 7.5, font, INK_LIGHT);
      cur.y -= 8;

      if (subjectScores.length === 0) {
        cur.y -= 16;
        text("No subject data available.", colSubject, cur.y, 10.5, font, INK_MED);
        cur.y -= 16;
      } else {
        const rowH = 25;
        subjectScores.forEach((ss, i) => {
          const rowTop = cur.y;
          if (i % 2 === 0) {
            cur.page.drawRectangle({ x: MARGIN, y: rowTop - rowH, width: CONTENT_W, height: rowH, color: ROW_ALT });
          }
          const baseline = rowTop - rowH + 8;
          const accPct = ss.total > 0 ? (ss.correct / ss.total) * 100 : 0;
          text(ss.subject_name, colSubject, baseline, 10.5, fontBold, INK_DARK);
          text(`${ss.marks_obtained} / ${ss.marks_max}`, colMarks, baseline, 10.5, font, INK_MED);
          text(`${ss.correct} / ${ss.total}`, colCorrect, baseline, 10.5, font, INK_MED);
          cur.page.drawRectangle({ x: barX, y: baseline + 1, width: barW, height: 7, color: rgb(0.91, 0.93, 0.95) });
          cur.page.drawRectangle({ x: barX, y: baseline + 1, width: Math.max(0, barW * Math.min(1, accPct / 100)), height: 7, color: accuracyColor(accPct) });
          text(`${accPct.toFixed(0)}%`, barX + barW + 8, baseline, 10, fontBold, accuracyColor(accPct));
          cur.y -= rowH;
        });
      }

      // Response breakdown donut fills page 1's lower whitespace.
      cur.y -= 24;
      drawResponseDonut();
      cur.y -= 4;
      text(
        "A full performance analysis - topic radar, strengths, benchmark and timing - follows on the next page.",
        MARGIN, cur.y, 9.5, fontItalic, INK_LIGHT,
      );
    }

    // ── PAGE 2 — PERFORMANCE ANALYSIS (replaces the per-question review) ───────
    {
      // Section title on a fresh page.
      cur.page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      cur.y = PAGE_H - MARGIN;
      text("Performance analysis", MARGIN, cur.y, 15, fontBold, BRAND_TEAL);
      cur.y -= 10;
      cur.page.drawLine({ start: { x: MARGIN, y: cur.y }, end: { x: PAGE_W - MARGIN, y: cur.y }, thickness: 0.8, color: STROKE });
      cur.y -= 6;
      text(
        `How ${trunc(student.full_name, 40)} performed across topics, time and the school benchmark.`,
        MARGIN, cur.y - 8, 9.5, fontItalic, INK_LIGHT,
      );
      cur.y -= 34;

      // ── Topic radar ──────────────────────────────────────────────────────────
      const radarTopics = [...topicStats]
        .filter((t) => t.questions > 0)
        .sort((a, b) => b.questions - a.questions || b.pct_correct - a.pct_correct)
        .slice(0, 6);

      if (radarTopics.length >= 3) {
        let y = blockHeader(MARGIN, cur.y, "SKILL INTELLIGENCE", "Topic radar - your accuracy by topic");
        const R = 92;
        const cx = PAGE_W / 2;
        const cy = y - R - 6;
        const N = radarTopics.length;
        const ang = (i: number) => ((90 - (i * 360) / N) * Math.PI) / 180;
        const vtx = (i: number, r: number): [number, number] => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];

        for (const lvl of [25, 50, 75, 100]) {
          const r = (R * lvl) / 100;
          for (let i = 0; i < N; i++) {
            const a = vtx(i, r), b = vtx((i + 1) % N, r);
            cur.page.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness: 0.4, color: STROKE });
          }
        }
        for (let i = 0; i < N; i++) {
          const v = vtx(i, R);
          cur.page.drawLine({ start: { x: cx, y: cy }, end: { x: v[0], y: v[1] }, thickness: 0.4, color: STROKE });
        }
        const dataPts = radarTopics.map((t, i) => vtx(i, (R * Math.max(0, Math.min(100, t.pct_correct))) / 100));
        fillPolygon(dataPts, { color: BRAND_TEAL, opacity: 0.22, borderColor: BRAND_TEAL, borderWidth: 1.4 });
        for (const p of dataPts) cur.page.drawCircle({ x: p[0], y: p[1], size: 2.2, color: BRAND_TEAL });
        for (let i = 0; i < N; i++) {
          const tip = vtx(i, R + 7);
          const safe = sanitizeWinAnsi(trunc(radarTopics[i].topic_name, 18));
          const w = font.widthOfTextAtSize(safe, 6.5);
          const c = Math.cos(ang(i));
          const lx = c > 0.2 ? tip[0] : c < -0.2 ? tip[0] - w : tip[0] - w / 2;
          cur.page.drawText(safe, { x: lx, y: tip[1] - 2, size: 6.5, font, color: INK_MED });
        }
        // legend — pushed clear of the bottom axis label
        let legendY = cy - R - 36;
        const legend: Array<[ReturnType<typeof rgb>, string]> = [
          [GREEN, "80-100 Strong"], [AMBER, "60-79 Developing"], [RED, "0-59 Needs attention"],
        ];
        let lx = MARGIN + 40;
        for (const [col, lab] of legend) {
          cur.page.drawCircle({ x: lx + 3, y: legendY + 3, size: 3, color: col });
          text(lab, lx + 11, legendY, 8, font, INK_MED);
          lx += 16 + font.widthOfTextAtSize(lab, 8) + 22;
        }
        cur.y = legendY - 34;
      }

      // ── Strengths | Focus areas (two columns) ─────────────────────────────────
      {
        const colGap = 20;
        const colW = (CONTENT_W - colGap) / 2;
        const xL = MARGIN, xR = MARGIN + colW + colGap;
        const withData = topicStats.filter((t) => t.questions > 0);
        const strengths = [...withData].sort((a, b) => b.pct_correct - a.pct_correct).slice(0, 3);
        const focus = [...withData].sort((a, b) => a.pct_correct - b.pct_correct).slice(0, 3);

        const drawTopicList = (x: number, top: number, eyebrow: string, title: string, items: TopicStat[]): number => {
          let y = blockHeader(x, top, eyebrow, title);
          if (items.length === 0) {
            text("Not enough data.", x, y, 9.5, font, INK_MED);
            return top - (y - 14);
          }
          for (const t of items) {
            cur.page.drawCircle({ x: x + 3, y: y + 3, size: 2.5, color: accuracyColor(t.pct_correct) });
            text(trunc(t.topic_name, 26), x + 12, y, 9.5, fontBold, INK_DARK);
            text(trunc(t.subject_name, 30), x + 12, y - 11, 7.5, font, INK_LIGHT);
            textRight(`${t.pct_correct}%`, x + colW, y - 1, 10, fontBold, accuracyColor(t.pct_correct));
            y -= 38;
          }
          return top - y;
        };

        const top = cur.y;
        const hL = drawTopicList(xL, top, "WHERE YOU SHINE", "Strengths", strengths);
        const hR = drawTopicList(xR, top, "WHERE TO IMPROVE", "Focus areas", focus);
        cur.y = top - Math.max(hL, hR) - 18;
      }

      // ── Mastery breakdown — distribution + per-subject composition ────────────
      {
        const all = [...topicStats].filter((t) => t.questions > 0);
        if (all.length > 0) {
          const total = all.length;
          const strong = all.filter((t) => t.pct_correct >= 80).length;
          const developing = all.filter((t) => t.pct_correct >= 60 && t.pct_correct < 80).length;
          const weak = total - strong - developing;

          let y = blockHeader(MARGIN, cur.y, "MASTERY BREAKDOWN", "Where your concepts stand");
          text(
            `Across ${total} concepts tested: ${strong} mastered (80%+), ${developing} developing and ${weak} needing attention.`,
            MARGIN, y, 8.5, fontItalic, INK_LIGHT,
          );
          y -= 20;

          // Overall distribution stacked bar.
          const barH = 9;
          let sx = MARGIN;
          for (const [count, col] of [[strong, GREEN], [developing, AMBER], [weak, RED]] as Array<[number, ReturnType<typeof rgb>]>) {
            if (count <= 0) continue;
            const w = (CONTENT_W * count) / total;
            cur.page.drawRectangle({ x: sx, y: y - barH, width: w, height: barH, color: col });
            sx += w;
          }
          y -= barH + 10;
          let lx = MARGIN;
          for (const [col, lab] of [[GREEN, `${strong} Strong`], [AMBER, `${developing} Developing`], [RED, `${weak} Need attention`]] as Array<[ReturnType<typeof rgb>, string]>) {
            cur.page.drawCircle({ x: lx + 3, y: y + 3, size: 3, color: col });
            text(lab, lx + 11, y, 8.5, font, INK_MED);
            lx += 14 + font.widthOfTextAtSize(lab, 8.5) + 26;
          }
          y -= 26;

          // Per-subject composition — which subject carries the gaps.
          const bySubject = new Map<string, TopicStat[]>();
          for (const t of all) {
            const arr = bySubject.get(t.subject_name) ?? [];
            arr.push(t);
            bySubject.set(t.subject_name, arr);
          }
          const subjects = [...bySubject.entries()]
            .map(([name, ts]) => {
              const avg = Math.round((ts.reduce((a, t) => a + t.pct_correct, 0) / ts.length) * 10) / 10;
              const mastered = ts.filter((t) => t.pct_correct >= 80).length;
              const dev = ts.filter((t) => t.pct_correct >= 60 && t.pct_correct < 80).length;
              return { name, avg, mastered, dev, wk: ts.length - mastered - dev, total: ts.length };
            })
            .sort((a, b) => b.avg - a.avg);

          text("BY SUBJECT", MARGIN, y, 7, font, INK_LIGHT);
          y -= 16;
          const segX = MARGIN + 140;
          const segW = CONTENT_W - 140 - 140;
          for (const s of subjects) {
            text(trunc(s.name, 22), MARGIN, y, 9.5, fontBold, INK_DARK);
            let bx = segX;
            for (const [count, col] of [[s.mastered, GREEN], [s.dev, AMBER], [s.wk, RED]] as Array<[number, ReturnType<typeof rgb>]>) {
              if (count <= 0) continue;
              const w = (segW * count) / s.total;
              cur.page.drawRectangle({ x: bx, y: y, width: w, height: 7, color: col });
              bx += w;
            }
            textRight(`${s.mastered}/${s.total} mastered  ·  ${s.avg}%`, MARGIN + CONTENT_W, y, 8.5, font, INK_MED);
            y -= 28;
          }

          // Actionable: the genuinely weak concepts (or praise when none).
          const weakTopics = [...all].filter((t) => t.pct_correct < 60).sort((a, b) => a.pct_correct - b.pct_correct);
          y -= 2;
          if (weakTopics.length > 0) {
            text("WORK ON NEXT", MARGIN, y, 7, font, INK_LIGHT);
            y -= 14;
            const names = weakTopics.slice(0, 6).map((t) => `${t.topic_name} (${t.pct_correct}%)`).join("   ·   ");
            for (const line of wrap(names, 9, CONTENT_W)) {
              text(line, MARGIN, y, 9, font, INK_DARK);
              y -= 14;
            }
            cur.y = y - 6;
          } else {
            text("Every concept is at a strong level - keep practising to stay sharp.", MARGIN, y, 9, fontItalic, BRAND_TEAL);
            cur.y = y - 12;
          }
        }
      }

      // ── Benchmark | Time intelligence (two columns) — fresh page for spacing ──
      {
        cur.page = pdfDoc.addPage([PAGE_W, PAGE_H]);
        cur.y = PAGE_H - MARGIN;
        const colGap = 20;
        const colW = (CONTENT_W - colGap) / 2;
        const xL = MARGIN, xR = MARGIN + colW + colGap;

        const drawBenchmark = (x: number, top: number): number => {
          let y = blockHeader(x, top, "BENCHMARK", "How you compare");
          const bars: Array<[string, number | null, ReturnType<typeof rgb>]> = [
            ["You", Number(result.percentage), BRAND_TEAL],
            ["Class average", classAvg, LILAC],
            ["School average", schoolAvg, GREY],
          ];
          for (const [label, pct, color] of bars) {
            text(label, x, y, 8.5, font, INK_MED);
            textRight(pct == null ? "-" : `${pct}%`, x + colW, y, 9, fontBold, INK_DARK);
            const trackY = y - 11;
            cur.page.drawRectangle({ x, y: trackY, width: colW, height: 7, color: rgb(0.91, 0.93, 0.95) });
            const frac = Math.max(0, Math.min(1, (pct ?? 0) / 100));
            cur.page.drawRectangle({ x, y: trackY, width: colW * frac, height: 7, color });
            y -= 38;
          }
          return top - y;
        };

        const drawTime = (x: number, top: number): number => {
          let y = blockHeader(x, top, "TIME INTELLIGENCE", "How you spent your time");
          const fmt = (s: number) => (s > 0 ? formatTime(Math.round(s)) : "-");
          const rows: Array<[string, string]> = [
            ["Total exam time", fmt(timeStats.total_seconds)],
            ["Average per question", fmt(timeStats.avg_per_q)],
            ["Fastest topic", fastestTopic ? `${trunc(fastestTopic.topic_name, 18)} - ${fmt(fastestTopic.avg_time_seconds)}` : "-"],
            ["Slowest topic", slowestTopic ? `${trunc(slowestTopic.topic_name, 18)} - ${fmt(slowestTopic.avg_time_seconds)}` : "-"],
            ["Avg time when correct", fmt(timeStats.avg_correct)],
            ["Avg time when incorrect", fmt(timeStats.avg_incorrect)],
            ["Unanswered questions", String(timeStats.unanswered)],
          ];
          for (const [label, value] of rows) {
            text(label, x, y, 8.5, font, INK_MED);
            textRight(value, x + colW, y, 8.5, fontBold, INK_DARK);
            y -= 21;
          }
          return top - y;
        };

        const top = cur.y;
        const hL = drawBenchmark(xL, top);
        const hR = drawTime(xR, top);
        cur.y = top - Math.max(hL, hR) - 34;
      }

      // ── Subject snapshot via dot bars ─────────────────────────────────────────
      {
        breakIfNeeded(70 + subjectScores.length * 32);
        let y = blockHeader(MARGIN, cur.y, "SUBJECT SNAPSHOT (VIA DOT BARS)", "Accuracy by subject");
        text("Each dot marks your accuracy in that subject - the further right, the stronger.", MARGIN, y, 8.5, fontItalic, INK_LIGHT);
        y -= 26;
        const labelW = 120;
        const valueReserve = 40;
        const plotX = MARGIN + labelW;
        const plotW = CONTENT_W - labelW - valueReserve;
        // gridlines
        for (const tk of [0, 25, 50, 75, 100]) {
          const gx = plotX + (plotW * tk) / 100;
          cur.page.drawLine({ start: { x: gx, y: y + 6 }, end: { x: gx, y: y - subjectScores.length * 32 + 6 }, thickness: 0.4, color: STROKE });
        }
        subjectScores.forEach((ss, i) => {
          const pct = ss.total > 0 ? (ss.correct / ss.total) * 100 : 0;
          const color = DOT_PALETTE[i % DOT_PALETTE.length];
          const rowY = y - 4;
          textRight(trunc(ss.subject_name, 22), MARGIN + labelW - 12, rowY - 2, 9, fontBold, INK_DARK);
          const dotX = plotX + (plotW * Math.max(0, Math.min(100, pct))) / 100;
          cur.page.drawLine({ start: { x: plotX, y: rowY }, end: { x: dotX, y: rowY }, thickness: 2.2, color });
          cur.page.drawCircle({ x: dotX, y: rowY, size: 4, color });
          text(`${pct.toFixed(0)}%`, dotX + 9, rowY - 3, 9, fontBold, color);
          y -= 32;
        });
        // axis labels
        for (const tk of [0, 25, 50, 75, 100]) {
          const gx = plotX + (plotW * tk) / 100;
          const lab = String(tk);
          text(lab, gx - font.widthOfTextAtSize(lab, 7) / 2, y + 2, 7, font, INK_LIGHT);
        }
        cur.y = y - 24;
      }

      // ── Key takeaways — narrative summary, fills page 3 ───────────────────────
      {
        const totalCorrect = subjectScores.reduce((a, s) => a + (s.correct ?? 0), 0);
        const totalQ = subjectScores.reduce((a, s) => a + (s.total ?? 0), 0);
        const sortedDesc = [...topicStats].filter((t) => t.questions > 0).sort((a, b) => b.pct_correct - a.pct_correct);
        const strongest = sortedDesc[0];
        const weakest = sortedDesc[sortedDesc.length - 1];
        const takeaways: string[] = [];
        if (totalQ > 0) {
          takeaways.push(
            `You answered ${totalCorrect} of ${totalQ} questions correctly (${Number(result.percentage).toFixed(0)}%)` +
              (result.class_rank ? `, placing ${ordinal(result.class_rank)} of ${result.class_total} in ${student.class_label}.` : "."),
          );
        }
        if (classAvg != null) {
          const diff = Math.round((Number(result.percentage) - classAvg) * 10) / 10;
          takeaways.push(
            diff >= 0
              ? `That is ${diff} points above your class average of ${classAvg}% - a strong showing.`
              : `That is ${Math.abs(diff)} points below your class average of ${classAvg}% - there is room to climb.`,
          );
        }
        if (strongest && weakest && strongest !== weakest) {
          takeaways.push(
            `Strongest concept: ${strongest.topic_name} (${strongest.pct_correct}%). Most room to grow: ${weakest.topic_name} (${weakest.pct_correct}%) - revisiting its study material is the quickest win.`,
          );
        }
        if (timeStats.avg_per_q > 0) {
          takeaways.push(
            `You spent about ${formatTime(Math.round(timeStats.avg_per_q))} per question` +
              (timeStats.avg_correct > 0 && timeStats.avg_incorrect > 0 && timeStats.avg_correct < timeStats.avg_incorrect
                ? ", and moved quicker on the answers you got right." : "."),
          );
        }
        if (takeaways.length > 0) {
          breakIfNeeded(40 + takeaways.length * 26);
          let y = blockHeader(MARGIN, cur.y, "KEY TAKEAWAYS", "What your result says");
          for (const line of takeaways) {
            const lines = wrap(line, 9.5, CONTENT_W - 16);
            cur.page.drawRectangle({ x: MARGIN, y: y + 2.5, width: 4, height: 4, color: BRAND_ORANGE });
            for (let i = 0; i < lines.length; i++) {
              text(lines[i], MARGIN + 14, y, 9.5, font, INK_DARK);
              y -= 14;
            }
            y -= 6;
          }
          cur.y = y - 8;
        }
      }

      // ── About this exam — examination details ─────────────────────────────────
      {
        const totalQ = subjectScores.reduce((a, s) => a + (s.total ?? 0), 0);
        const subjectList = subjectIds.map((id) => subjectNameMap.get(id) ?? "-").join(", ");
        const rows: Array<[string, string]> = [
          ["Examination", `SALCI Olympiad ${campaignYear}`],
          ["Subjects", subjectList],
          ["Questions", `${totalQ} questions  ·  ${Number(result.total_max_marks).toFixed(0)} marks total`],
          ["Format", "Multiple choice, four options  ·  1 mark per question"],
          ["Result published", new Date(result.published_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })],
        ];
        breakIfNeeded(40 + rows.length * 16);
        let y = blockHeader(MARGIN, cur.y, "ABOUT THIS EXAM", "Examination details");
        for (const [label, value] of rows) {
          text(label, MARGIN, y, 8.5, font, INK_MED);
          const vLines = wrap(value, 8.5, CONTENT_W - 140, fontBold);
          for (let i = 0; i < vLines.length; i++) {
            text(vLines[i], MARGIN + 130, y, 8.5, fontBold, INK_DARK);
            if (i < vLines.length - 1) y -= 12;
          }
          y -= 16;
        }
        cur.y = y - 6;
      }

      cur.y -= 14;
      breakIfNeeded(20);
      text("Keep learning and improving - see you at the next SALCI Olympiad!", MARGIN, cur.y, 10.5, fontItalic, BRAND_TEAL);
    }

    // ── Footer on every page (drawn last so page count is final) ──────────────
    {
      const pages = pdfDoc.getPages();
      const total = pages.length;
      pages.forEach((p, i) => {
        p.drawLine({ start: { x: MARGIN, y: 42 }, end: { x: PAGE_W - MARGIN, y: 42 }, thickness: 0.5, color: STROKE });
        p.drawText(sanitizeWinAnsi(`Certificate ID: ${result.certificate_id}`), { x: MARGIN, y: 30, size: 7.5, font, color: INK_LIGHT });
        const centerText = sanitizeWinAnsi(`SALCI Olympiad ${campaignYear} - Result Report`);
        p.drawText(centerText, { x: (PAGE_W - font.widthOfTextAtSize(centerText, 7.5)) / 2, y: 30, size: 7.5, font, color: INK_LIGHT });
        const pageText = `Page ${i + 1} of ${total}`;
        p.drawText(pageText, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(pageText, 7.5), y: 30, size: 7.5, font, color: INK_LIGHT });
      });
    }

    // ── Upload PDF ─────────────────────────────────────────────────────────────
    const pdfBytes = await pdfDoc.save();
    const storagePath = `results/${oly_result_id}.pdf`;
    const { error: upErr } = await supabase.storage
      .from("olympiad-receipts")
      .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upErr) return json({ error: `Storage upload failed: ${upErr.message}` }, 500);

    // ── Update result row ──────────────────────────────────────────────────────
    const { error: updErr } = await supabase
      .from("oly_results")
      .update({
        result_pdf_path: storagePath,
        result_pdf_generated_at: new Date().toISOString(),
      })
      .eq("id", oly_result_id);
    if (updErr) return json({ error: `Result update failed: ${updErr.message}` }, 500);

    // ── Audit log ─────────────────────────────────────────────────────────────
    await supabase.from("oly_audit_log").insert({
      campaign_id: result.campaign_id,
      oly_school_id: result.oly_school_id,
      actor_id: null,
      actor_role: "super_admin",
      action: "result_pdf_generated",
      after_json: { result_id: oly_result_id, path: storagePath },
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
