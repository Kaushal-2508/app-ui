import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, ExternalLink, Link2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { MobileSheet } from "@/components/shared/sheets";

/** The school's public enquiry link, as a QR and a copyable address. */
export function EnquiryLinkSheet({
  open,
  onOpenChange,
  url,
  enabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  enabled: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.info("Select the link and copy it by hand.");
    }
  };
  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Enquiry link"
      subtitle="Share it on the website, WhatsApp or a poster"
      icon={<Link2 className="h-5 w-5" />}
      placement="center"
      desktopWidth="md"
      secondaryAction={{ label: "Close", onClick: () => onOpenChange(false) }}
    >
      <div className="space-y-4 p-4">
        {!enabled && (
          <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-500/25 dark:text-amber-200">
            The online form is switched off in Admissions settings; the link shows parents a notice until it is on.
          </p>
        )}
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <div className="rounded-md bg-white p-3">
            <QRCodeSVG value={url} size={160} level="M" includeMargin={false} />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <p className="break-all text-xs text-ink-500" data-enquiry-url="">
              {url}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={copy}>
                {copied ? <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                {copied ? "Copied" : "Copy link"}
              </Button>
              <Button type="button" variant="outline" size="sm" asChild>
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Open
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </MobileSheet>
  );
}
