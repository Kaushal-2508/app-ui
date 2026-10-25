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
    // @ts-expect-error Deno.env
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error Deno.env
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // @ts-expect-error Deno.env
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const supabase = createClient(supabaseUrl, serviceKey);

    const { oly_student_id } = (await req.json()) as { oly_student_id: string };

    // Fetch student + school + campaign + receipt context
    const { data: student, error: sErr } = await supabase
      .from("oly_students")
      .select(`
        id, full_name, roll_number, class_label, section_label, subject_ids, parent_email, enrolled_at, enrollment_channel,
        oly_school_id, campaign_id,
        oly_schools ( institution_id, school_short_code, institutions ( name ) ),
        oly_campaigns:campaign_id ( campaign_year, gstin )
      `)
      .eq("id", oly_student_id)
      .single();
    if (sErr || !student) return json({ error: "Student not found" }, 404);

    const school = Array.isArray(student.oly_schools) ? student.oly_schools[0] : student.oly_schools;
    const campaign = Array.isArray(student.oly_campaigns) ? student.oly_campaigns[0] : student.oly_campaigns;
    const inst = Array.isArray((school as { institutions?: unknown[] })?.institutions)
      ? ((school as { institutions: { name: string }[] }).institutions[0])
      : ((school as { institutions: { name: string } }).institutions);
    const schoolName = inst?.name ?? "Unknown school";
    const campaignYear = (campaign as { campaign_year?: number })?.campaign_year ?? new Date().getFullYear();
    const gstin = (campaign as { gstin?: string | null })?.gstin ?? "";

    // Fetch pending row for amount + gateway info
    const { data: pending } = await supabase
      .from("oly_enrollment_pending")
      .select("amount_rupees, gst_rupees, total_rupees, gateway_payment_id")
      .eq("promoted_student_id", oly_student_id)
      .maybeSingle();

    const amountRupees = pending?.amount_rupees ?? 0;
    const gstRupees = pending?.gst_rupees ?? 0;
    const totalRupees = pending?.total_rupees ?? 0;
    const gatewayPaymentId = pending?.gateway_payment_id ?? "";
    const isOnline = student.enrollment_channel === "parent_online";

    // Fetch subject names
    const { data: subjects } = await supabase
      .from("oly_subjects")
      .select("name")
      .in("id", student.subject_ids ?? []);
    const subjectNames = (subjects ?? []).map((s: { name: string }) => s.name).join(", ");

    // Generate receipt number
    const { data: receiptNumberData } = await supabase.rpc("oly_next_receipt_number", { p_year: campaignYear });
    const receiptNumber = (receiptNumberData as string) ?? `RCPT-${campaignYear}-UNKNOWN`;

    // Build PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]); // A4
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = 800;
    const line = (text: string, size: number, x: number = 50, bold = false, color: [number, number, number] = [0.1, 0.1, 0.15]) => {
      page.drawText(text, { x, y, size, font: bold ? fontBold : font, color: rgb(color[0], color[1], color[2]) });
      y -= size + 4;
    };

    line("SALCI OLYMPIAD", 22, 50, true, [0.14, 0.61, 0.64]);
    line(`${campaignYear} — Enrollment Receipt`, 12, 50, false);
    y -= 10;
    if (gstin) { line(`GSTIN: ${gstin}`, 10, 50, false, [0.4, 0.4, 0.45]); y -= 4; }

    line(`Receipt No: ${receiptNumber}`, 11, 50, true);
    line(`Issued: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`, 10, 50, false);
    y -= 16;

    line("School", 11, 50, true);
    line(schoolName, 11, 50, false);
    y -= 12;

    line("Student", 11, 50, true);
    line(`${student.full_name}`, 11, 50, false);
    line(`Roll: ${student.roll_number}   Class: ${student.class_label}${student.section_label ? " - " + student.section_label : ""}`, 10, 50, false);
    y -= 12;

    line("Subjects chosen", 11, 50, true);
    line(subjectNames, 10, 50, false);
    y -= 16;

    line("Fee breakdown", 11, 50, true);
    const rs = (r: number) => `Rs.${r.toFixed(2)}`;
    line(`Base fee:           ${rs(amountRupees)}`, 11, 50, false);
    line(`GST:                ${rs(gstRupees)}`, 11, 50, false);
    page.drawLine({ start: { x: 50, y: y + 4 }, end: { x: 320, y: y + 4 }, thickness: 1, color: rgb(0.7, 0.7, 0.75) });
    y -= 4;
    line(`Total:              ${rs(totalRupees)}`, 12, 50, true);
    y -= 12;

    line("Payment method", 11, 50, true);
    line(isOnline ? `Online (ref: ${gatewayPaymentId || "n/a"})` : "Cash (collected by teacher)", 11, 50, false);

    y = 60;
    line("This is a system-generated receipt. For queries, contact your school administration.", 9, 50, false, [0.5, 0.5, 0.55]);

    const pdfBytes = await pdfDoc.save();
    const storagePath = `${oly_student_id}.pdf`;

    const { error: upErr } = await supabase.storage.from("olympiad-receipts").upload(storagePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (upErr) return json({ error: `Storage upload failed: ${upErr.message}` }, 500);

    // Insert receipts row
    const { data: receiptRow, error: rErr } = await supabase
      .from("oly_receipts")
      .insert({
        oly_student_id,
        receipt_number: receiptNumber,
        storage_path: `olympiad-receipts/${storagePath}`,
        amount_rupees: amountRupees,
        gst_rupees: gstRupees,
        total_rupees: totalRupees,
        payment_method: isOnline ? "online" : "cash",
        gateway_payment_id: isOnline ? gatewayPaymentId : null,
        gateway_reference: isOnline ? gatewayPaymentId : null,
      })
      .select("id")
      .single();
    if (rErr) return json({ error: `Receipt row insert failed: ${rErr.message}` }, 500);

    // Email if parent_email present + Resend configured
    if (student.parent_email && resendKey) {
      const { data: signedUrlData } = await supabase.storage
        .from("olympiad-receipts")
        .createSignedUrl(storagePath, 60 * 60 * 24 * 7); // 7 days for the email link

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "SALCI Olympiad <noreply@salci.org>",
          to: student.parent_email,
          subject: `SALCI Olympiad ${campaignYear} — Enrollment confirmed (${student.roll_number})`,
          html: `<p>Hello,</p>
<p>Thank you for enrolling <strong>${student.full_name}</strong> for the SALCI Olympiad ${campaignYear}.</p>
<p><strong>Roll number:</strong> ${student.roll_number}<br/>
<strong>Receipt:</strong> ${receiptNumber}<br/>
<strong>Amount:</strong> ${rs(totalRupees)}</p>
<p><a href="${signedUrlData?.signedUrl ?? "#"}">Download your receipt</a> (valid for 7 days)</p>
<p>Login on exam day with your roll number and date of birth (ddmmyy format).</p>
<p>Best regards,<br/>Team SALCI</p>`,
        }),
      });
      if (emailRes.ok) {
        await supabase.from("oly_receipts").update({
          emailed_at: new Date().toISOString(),
          emailed_to: student.parent_email,
        }).eq("id", receiptRow.id);
      }
    }

    return json({ ok: true, receipt_id: receiptRow.id, receipt_number: receiptNumber }, 200);
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
