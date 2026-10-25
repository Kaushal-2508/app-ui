import { useRef, useState } from "react";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { Check, Copy, Download, Printer } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { toastError } from "@/lib/toast";
import { ptmFeedbackUrl } from "@/lib/ptm";

interface Props {
  token: string;
  title: string;
  /** Printed under the title on the poster, e.g. the date and venue. */
  subtitle?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The feedback QR for one PTM. The SVG is what the screen shows; a hidden
 * canvas of the same code backs Download and Print, because toDataURL is a
 * canvas API. The URL uses the current origin, never a hard-coded domain
 * (two production frontends share this project, CLAUDE.md section 1).
 */
export function PTMQRCard({ token, title, subtitle }: Props) {
  const url = ptmFeedbackUrl(token);
  const canvasWrap = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const pngDataUrl = (): string | null => {
    const canvas = canvasWrap.current?.querySelector("canvas");
    return canvas ? canvas.toDataURL("image/png") : null;
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      toastError(e, { fallback: "Couldn't copy the link.", context: "copyPTMFeedbackLink" });
    }
  };

  const download = () => {
    const dataUrl = pngDataUrl();
    if (!dataUrl) {
      toastError(new Error("QR not ready"), { fallback: "The QR code isn't ready yet.", context: "downloadPTMQr" });
      return;
    }
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `ptm-feedback-qr-${token.slice(0, 8)}.png`;
    a.click();
  };

  const print = () => {
    const dataUrl = pngDataUrl();
    if (!dataUrl) return;
    const w = window.open("", "_blank", "width=520,height=720");
    if (!w) {
      toast.info("Allow pop-ups for this site to print the QR poster.");
      return;
    }
    w.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 48px 32px; text-align: center; color: #1f2937; }
  h1 { font-size: 28px; margin: 0 0 8px; }
  p { margin: 0 0 8px; font-size: 16px; color: #4b5563; }
  img { width: 320px; height: 320px; margin: 24px auto; display: block; }
  .url { font-size: 12px; word-break: break-all; color: #6b7280; }
  .cta { font-size: 20px; font-weight: 600; color: #1f2937; margin-top: 16px; }
</style></head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
  <img src="${dataUrl}" alt="QR code" />
  <p class="cta">Scan to share your feedback</p>
  <p>Sign in with your child's SALCI account if asked.</p>
  <p class="url">${escapeHtml(url)}</p>
  <script>window.addEventListener("load", function () { window.print(); });</script>
</body></html>`);
    w.document.close();
  };

  return (
    <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
      <h3 className="text-base font-semibold text-ink-900">Feedback QR</h3>
      <p className="mt-1 text-sm text-ink-600">
        Print this for the venue. Families scan it after the meeting to rate it and leave a
        message or a voice note.
      </p>
      <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="rounded-md bg-white p-3">
          <QRCodeSVG value={url} size={176} level="M" includeMargin={false} />
        </div>
        <div ref={canvasWrap} className="hidden" aria-hidden="true">
          <QRCodeCanvas value={url} size={640} level="M" includeMargin />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <p className="break-all text-xs text-ink-500">{url}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={copyLink}>
              {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button variant="outline" size="sm" onClick={download}>
              <Download className="mr-1.5 h-4 w-4" />
              Download
            </Button>
            <Button variant="outline" size="sm" onClick={print}>
              <Printer className="mr-1.5 h-4 w-4" />
              Print
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
