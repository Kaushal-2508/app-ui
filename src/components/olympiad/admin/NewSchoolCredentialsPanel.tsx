import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { OnboardSchoolResult } from "@/hooks/olympiad/useOnboardSchool";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <div className="space-y-1">
      <p className="eyebrow">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded-md bg-surface-card px-2.5 py-1.5 text-xs text-ink-800">{value}</code>
        <Button size="icon" variant="ghost" onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? <Check className="h-4 w-4 text-brand-primary" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

export function NewSchoolCredentialsPanel({ result }: { result: OnboardSchoolResult }) {
  // Only new schools mint a login. Existing SALCI schools reuse their own admins.
  if (!result.admin_email) return null;
  return (
    <section className="surface-card frosted-shadow rounded-card p-5 space-y-3">
      <header>
        <p className="eyebrow">School admin login</p>
        <h3 className="text-base font-semibold text-ink-900">Share these with the school</h3>
        <p className="text-sm text-ink-600 mt-1">
          The admin signs in at <span className="font-medium text-ink-900">app.salci.ai</span> with this email + password.
          You can regenerate the password anytime from the school&apos;s page.
        </p>
      </header>
      <div className="rounded-md border border-brand-primary/30 bg-brand-primary/5 p-3 space-y-3">
        <CopyField label="Login email (ID)" value={result.admin_email} />
        {result.temp_password && <CopyField label="Password" value={result.temp_password} />}
      </div>
      <div className="space-y-3">
        <CopyField label="Institute code" value={result.institute_code} />
        <CopyField label="School short code" value={result.school_short_code} />
      </div>
    </section>
  );
}
