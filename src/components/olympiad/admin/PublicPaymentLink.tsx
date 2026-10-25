import { useState } from "react";
import { Copy, Download, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";

export function PublicPaymentLink({ schoolShortCode }: { schoolShortCode: string }) {
  const base = (import.meta.env.VITE_PUBLIC_URL ?? "https://app.salci.ai").replace(/\/$/, "");
  const url = `${base}/olympiad/${schoolShortCode}`;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("URL copied");
    setTimeout(() => setCopied(false), 1500);
  };

  const downloadQr = () => {
    const canvas = document.getElementById(`qr-${schoolShortCode}`) as HTMLCanvasElement | null;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `olympiad-${schoolShortCode}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="surface-card frosted-shadow rounded-card p-4 space-y-3">
      <p className="eyebrow">Public payment URL</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs bg-surface-card border border-surface-stroke rounded px-2 py-1.5 truncate">{url}</code>
        <Button size="icon" variant="ghost" onClick={copy} title="Copy URL">
          {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      <div className="flex items-center gap-4">
        <div className="rounded-md border border-surface-stroke bg-white p-2">
          <QRCodeCanvas id={`qr-${schoolShortCode}`} value={url} size={120} level="M" includeMargin />
        </div>
        <Button size="sm" variant="outline" onClick={downloadQr}>
          <Download className="h-4 w-4 mr-1" />
          Download QR
        </Button>
      </div>
    </div>
  );
}
