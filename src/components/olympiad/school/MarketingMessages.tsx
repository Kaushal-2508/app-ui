import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type Props = {
  schoolName: string;
  publicUrl: string;
  /** Human-readable enrollment close date, e.g. "30 Jun 2026" (optional). */
  closesDateLabel?: string | null;
};

/**
 * Ready-to-send, school-specific outreach messages for the Marketing Material
 * tab: parent email, SMS, WhatsApp, and a social-media caption. Every format
 * carries the school's own enrollment link.
 */
export function MarketingMessages({ schoolName, publicUrl, closesDateLabel }: Props) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const deadline = closesDateLabel ? ` Enrollment closes on ${closesDateLabel}.` : " Enrollment closes soon.";

  const emailSubject = `SALCI Olympiad enrollment for ${schoolName}`;
  const emailBody = `Dear Parent,

We are pleased to invite your child to participate in the SALCI Olympiad, a competitive exam across three student-chosen subjects, held right here at ${schoolName}. Every participant receives a certificate, and top performers win gold, silver and bronze medals.

To enroll and pay online, visit: ${publicUrl}
${closesDateLabel ? `\nPlease complete enrollment by ${closesDateLabel}.\n` : ""}
Best regards,
${schoolName}`;

  const sms = `SALCI Olympiad @ ${schoolName}: enroll your child now at ${publicUrl}.${deadline}`;

  const whatsapp = `🏅 *SALCI Olympiad at ${schoolName}*

Give your child the chance to compete, win medals and earn a certificate. Exam held at the school itself.

✅ Enroll & pay online: ${publicUrl}${deadline}`;

  const social = `🏅 ${schoolName} is hosting the SALCI Olympiad! Students compete in their favourite subjects, win medals and certificates, and discover where they shine. Enroll now: ${publicUrl}${deadline} #SALCIOlympiad #${schoolName.replace(/[^a-zA-Z0-9]/g, "")}`;

  const copyButton = (key: string, text: string, label: string) => (
    <Button size="sm" variant="outline" onClick={() => copy(key, text)}>
      {copiedKey === key ? <Check className="h-4 w-4 mr-1 text-emerald-500" /> : <Copy className="h-4 w-4 mr-1" />}
      {label}
    </Button>
  );

  return (
    <div className="space-y-4">
      <section className="surface-card frosted-shadow rounded-card p-5 space-y-3">
        <p className="eyebrow">Parent email</p>
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Subject</Label>
          <Input value={emailSubject} readOnly />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Body</Label>
          <Textarea value={emailBody} readOnly rows={9} className="text-sm" />
        </div>
        <div className="flex flex-wrap gap-2">
          {copyButton("subject", emailSubject, "Copy subject")}
          {copyButton("body", emailBody, "Copy body")}
        </div>
      </section>

      <section className="surface-card frosted-shadow rounded-card p-5 space-y-2">
        <p className="eyebrow">SMS</p>
        <Textarea value={sms} readOnly rows={3} className="text-sm" />
        {copyButton("sms", sms, "Copy SMS")}
      </section>

      <section className="surface-card frosted-shadow rounded-card p-5 space-y-2">
        <p className="eyebrow">WhatsApp message</p>
        <Textarea value={whatsapp} readOnly rows={6} className="text-sm" />
        {copyButton("whatsapp", whatsapp, "Copy WhatsApp message")}
      </section>

      <section className="surface-card frosted-shadow rounded-card p-5 space-y-2">
        <p className="eyebrow">Social media caption</p>
        <Textarea value={social} readOnly rows={4} className="text-sm" />
        {copyButton("social", social, "Copy caption")}
      </section>
    </div>
  );
}
