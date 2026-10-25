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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing auth" }, 401);
    // @ts-expect-error Deno.env
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userRes } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const userId = userRes.user?.id;
    if (!userId) return json({ error: "Forbidden" }, 403);

    const { oly_school_id, grade_level_id } = (await req.json()) as { oly_school_id: string; grade_level_id: string };

    // Authorize: teacher OR school_admin OR super_admin
    const { data: isTeacher } = await supabase.rpc("oly_is_teacher_for_class", {
      p_uid: userId, p_oly_school_id: oly_school_id, p_grade_level_id: grade_level_id,
    });
    const { data: isAdmin } = await supabase.rpc("oly_is_school_admin_for", {
      p_uid: userId, p_oly_school_id: oly_school_id,
    });
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isTeacher && !isAdmin && !isSuper) return json({ error: "Forbidden" }, 403);

    const { data: students } = await supabase
      .from("oly_students")
      .select("full_name, roll_number, date_of_birth, class_label, section_label")
      .eq("oly_school_id", oly_school_id)
      .eq("grade_level_id", grade_level_id)
      .eq("status", "active")
      .order("roll_number");

    const { data: school } = await supabase
      .from("oly_schools").select("institutions(name), campaign_id").eq("id", oly_school_id).single();
    const inst = Array.isArray((school as { institutions?: unknown } | null)?.institutions)
      ? ((school as { institutions: { name?: string }[] }).institutions[0])
      : ((school as { institutions: { name?: string } } | null)?.institutions);
    const schoolName = inst?.name ?? "School";

    const { data: campaign } = await supabase
      .from("oly_campaigns").select("campaign_year").eq("id", (school as { campaign_id?: string } | null)?.campaign_id ?? "").single();
    const year = (campaign as { campaign_year?: number } | null)?.campaign_year ?? new Date().getFullYear();

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const PER_PAGE = 10;
    const list = students ?? [];
    for (let i = 0; i < list.length; i += PER_PAGE) {
      const page = pdfDoc.addPage([595, 842]);
      const chunk = list.slice(i, i + PER_PAGE);
      let y = 800;

      page.drawText(`SALCI Olympiad ${year} — Credentials (${schoolName})`, {
        x: 50, y, size: 14, font: fontBold, color: rgb(0.14, 0.61, 0.64),
      });
      y -= 25;
      page.drawText(`Class: ${list[0]?.class_label ?? ""}   Page ${Math.floor(i / PER_PAGE) + 1}`, {
        x: 50, y, size: 10, font, color: rgb(0.4, 0.4, 0.45),
      });
      y -= 30;

      for (const s of chunk) {
        // Each row: name | roll | DOB (ddmmyy)
        const dob = new Date(s.date_of_birth);
        const dd = String(dob.getDate()).padStart(2, "0");
        const mm = String(dob.getMonth() + 1).padStart(2, "0");
        const yy = String(dob.getFullYear()).slice(-2);
        const dobStr = `${dd}${mm}${yy}`;

        page.drawText(s.full_name, { x: 50, y, size: 11, font: fontBold, color: rgb(0.1, 0.1, 0.15) });
        page.drawText(`Roll: ${s.roll_number}`, { x: 250, y, size: 10, font, color: rgb(0.3, 0.3, 0.35) });
        page.drawText(`Password (DOB): ${dobStr}`, { x: 380, y, size: 10, font, color: rgb(0.3, 0.3, 0.35) });

        y -= 8;
        page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.88) });
        y -= 25;
      }

      page.drawText("Cut along the lines and distribute one slip per student. The password is the student's date of birth in ddmmyy format.", {
        x: 50, y: 50, size: 8, font, color: rgb(0.5, 0.5, 0.55),
      });
    }

    const pdfBytes = await pdfDoc.save();
    const path = `credentials/${oly_school_id}/${grade_level_id}/${Date.now()}.pdf`;
    const { error: upErr } = await supabase.storage.from("olympiad-receipts").upload(path, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (upErr) return json({ error: upErr.message }, 500);

    const { data: signed } = await supabase.storage.from("olympiad-receipts").createSignedUrl(path, 300);

    await supabase.from("oly_audit_log").insert({
      campaign_id: (school as { campaign_id?: string } | null)?.campaign_id ?? null,
      oly_school_id,
      actor_id: userId,
      actor_role: isTeacher ? "teacher" : (isAdmin ? "school_admin" : "super_admin"),
      action: "credentials_pdf_generated",
      after_json: { grade_level_id, student_count: list.length },
    });

    return json({ signed_url: signed?.signedUrl ?? null, student_count: list.length }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
