import { Medal, Printer, Laptop, BookOpen, Award } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { printHtml } from "@/lib/native";

type Props = {
  schoolName: string;
  publicUrl: string;
  /** Human-readable enrollment close date, e.g. "30 Jun 2026" (optional). */
  closesDateLabel?: string | null;
};

/**
 * School-specific A4 flyer for the Marketing Material tab: on-screen preview
 * plus a print window (Print → Save as PDF gives a shareable file). The print
 * document is self-contained HTML, so brand colors are hardcoded hex there —
 * CSS variables from the app don't reach a detached window.
 */
export function OlympiadFlyer({ schoolName, publicUrl, closesDateLabel }: Props) {
  const printFlyer = () => {
    const canvas = document.getElementById("oly-flyer-qr") as HTMLCanvasElement | null;
    const qrDataUrl = canvas?.toDataURL("image/png") ?? "";
    const html = `<!doctype html>
<html><head><title>SALCI Olympiad: ${schoolName}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color: #1d2433; }
  .page { width: 210mm; min-height: 297mm; padding: 18mm 16mm; display: flex; flex-direction: column; }
  .band { background: #249ca2; color: #fff; border-radius: 16px; padding: 28px 32px; text-align: center; }
  .band .eyebrow { font-size: 13px; letter-spacing: 0.2em; text-transform: uppercase; opacity: 0.85; }
  .band h1 { font-size: 44px; margin-top: 6px; }
  .band p { margin-top: 8px; font-size: 14px; opacity: 0.9; }
  .school { text-align: center; margin: 28px 0 8px; }
  .school .at { font-size: 13px; letter-spacing: 0.15em; text-transform: uppercase; color: #fa920e; font-weight: 600; }
  .school h2 { font-size: 30px; margin-top: 4px; }
  ul { list-style: none; margin: 24px auto; max-width: 520px; }
  li { font-size: 16px; padding: 10px 0 10px 34px; position: relative; border-bottom: 1px solid #eef1f5; }
  li:before { content: "✓"; position: absolute; left: 0; top: 8px; width: 24px; height: 24px; border-radius: 50%;
              background: #e6f5f6; color: #249ca2; font-weight: 700; text-align: center; line-height: 24px; }
  .enroll { margin-top: auto; background: #fff7ec; border: 2px dashed #fa920e; border-radius: 16px;
            padding: 24px 28px; display: flex; align-items: center; gap: 24px; }
  .enroll .how { flex: 1; }
  .enroll .how h3 { font-size: 20px; color: #1d2433; }
  .enroll .how p { margin-top: 8px; font-size: 14px; color: #4a5468; }
  .enroll .how .link { margin-top: 10px; font-size: 15px; font-weight: 700; color: #249ca2; word-break: break-all; }
  .enroll img { width: 130px; height: 130px; }
  .deadline { margin-top: 14px; text-align: center; font-size: 15px; font-weight: 600; color: #fa920e; }
  .footer { margin-top: 18px; text-align: center; font-size: 12px; color: #8a93a3; }
</style></head>
<body>
  <div class="page">
    <div class="band">
      <div class="eyebrow">Self Analysis for Learning &amp; Competency Improvement</div>
      <h1>SALCI OLYMPIAD</h1>
      <p>Compete. Discover your strengths. Win medals.</p>
    </div>
    <div class="school">
      <div class="at">Hosted at</div>
      <h2>${schoolName}</h2>
    </div>
    <ul>
      <li>Exam held at the school, on the school's own computers</li>
      <li>Students compete in their favourite subjects</li>
      <li>Gold, silver &amp; bronze medals for top performers</li>
      <li>A certificate for every participant</li>
      <li>Subject-wise study material included for preparation</li>
    </ul>
    <div class="enroll">
      <div class="how">
        <h3>Enroll &amp; pay online</h3>
        <p>Visit the link below or scan the QR code with your phone.</p>
        <div class="link">${publicUrl}</div>
      </div>
      ${qrDataUrl ? `<img src="${qrDataUrl}" alt="Enrollment QR code" />` : ""}
    </div>
    ${closesDateLabel ? `<div class="deadline">Enrollment closes on ${closesDateLabel}</div>` : ""}
    <div class="footer">SALCI Olympiad · app.salci.ai</div>
  </div>
</body></html>`;
    // The popup used to stay open after printing; keep that.
    void printHtml(html, { width: 820, height: 1100, closeAfter: false });
  };

  return (
    <div className="space-y-4">
      {/* On-screen preview (compact, token-styled) */}
      <div className="surface-card frosted-shadow rounded-card overflow-hidden">
        <div className="bg-brand-primary px-6 py-7 text-center text-white">
          <p className="text-[11px] uppercase tracking-[0.2em] opacity-85">
            Self Analysis for Learning &amp; Competency Improvement
          </p>
          <h3 className="mt-1 text-3xl font-bold">SALCI OLYMPIAD</h3>
          <p className="mt-1 text-sm opacity-90">Compete. Discover your strengths. Win medals.</p>
        </div>
        <div className="p-5 sm:p-6 space-y-4">
          <div className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-brand-secondary">Hosted at</p>
            <h4 className="mt-0.5 text-xl font-semibold text-ink-900">{schoolName}</h4>
          </div>
          <ul className="mx-auto max-w-md space-y-2 text-sm text-ink-700">
            <li className="flex items-center gap-2.5"><Laptop className="h-4 w-4 shrink-0 text-brand-primary" /> Exam held at the school, on the school's own computers</li>
            <li className="flex items-center gap-2.5"><Medal className="h-4 w-4 shrink-0 text-brand-primary" /> Gold, silver &amp; bronze medals for top performers</li>
            <li className="flex items-center gap-2.5"><Award className="h-4 w-4 shrink-0 text-brand-primary" /> A certificate for every participant</li>
            <li className="flex items-center gap-2.5"><BookOpen className="h-4 w-4 shrink-0 text-brand-primary" /> Subject-wise study material included</li>
          </ul>
          <div className="flex flex-col items-center gap-4 rounded-card border border-dashed border-brand-secondary/60 p-4 sm:flex-row sm:justify-between">
            <div className="min-w-0 text-center sm:text-left">
              <p className="text-sm font-semibold text-ink-900">Enroll &amp; pay online</p>
              <p className="mt-1 break-all text-sm font-medium text-brand-primary">{publicUrl}</p>
              {closesDateLabel && (
                <p className="mt-1 text-xs font-medium text-brand-secondary">Enrollment closes on {closesDateLabel}</p>
              )}
            </div>
            <div className="shrink-0 rounded-md border border-surface-stroke bg-white p-2">
              <QRCodeCanvas id="oly-flyer-qr" value={publicUrl} size={104} level="M" includeMargin />
            </div>
          </div>
        </div>
      </div>

      <Button onClick={printFlyer}>
        <Printer className="mr-2 h-4 w-4" />
        Print flyer (or save as PDF)
      </Button>
    </div>
  );
}
