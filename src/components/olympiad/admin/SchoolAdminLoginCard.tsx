import { useState } from "react";
import { Check, Copy, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useResetSchoolAdminPassword,
  type SchoolAdminCredentials,
} from "@/hooks/olympiad/useResetSchoolAdminPassword";

function CopyRow({ label, value }: { label: string; value: string }) {
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
        <code className="flex-1 min-w-0 truncate rounded-md bg-surface-base px-2.5 py-1.5 text-xs text-ink-900">{value}</code>
        <Button size="icon" variant="ghost" onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? <Check className="h-4 w-4 text-brand-primary" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

type Props = {
  olySchoolId: string;
  loginEmail: string;
  isExisting: boolean;
};

export function SchoolAdminLoginCard({ olySchoolId, loginEmail, isExisting }: Props) {
  const reset = useResetSchoolAdminPassword();
  const [creds, setCreds] = useState<SchoolAdminCredentials | null>(null);

  const onGenerate = async () => {
    try {
      const result = await reset.mutateAsync({ oly_school_id: olySchoolId });
      setCreds(result);
    } catch { /* toastError handled in the hook */ }
  };

  return (
    <section className="surface-card frosted-shadow rounded-card p-4 space-y-3">
      <header>
        <p className="eyebrow">School admin login</p>
        <p className="text-xs text-ink-600 mt-1">
          The school admin signs in at <span className="font-medium text-ink-900">app.salci.ai</span> with the email below and the
          password you generate here.{" "}
          {isExisting
            ? "This school already uses SALCI. Generating a password resets the existing admin's password."
            : "This is the password they'll use to sign in."}
        </p>
      </header>

      {!creds ? (
        <div className="space-y-3">
          <CopyRow label="Login email (ID)" value={loginEmail} />
          <Button size="sm" onClick={onGenerate} disabled={reset.isPending}>
            {reset.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1" />}
            Generate password
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-md border border-brand-primary/30 bg-brand-primary/5 p-3 space-y-3">
            <CopyRow label="Login email (ID)" value={creds.admin_email} />
            <CopyRow label="Password" value={creds.temp_password} />
            <CopyRow label="Login URL" value={creds.login_url} />
            {creds.institute_code && <CopyRow label="Institute code" value={creds.institute_code} />}
          </div>
          <p className="text-[11px] text-ink-500">
            Share the email + password with the school admin. Copy the password now. It&apos;s only shown here.
          </p>
          <Button size="sm" variant="outline" onClick={onGenerate} disabled={reset.isPending}>
            {reset.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1" />}
            Generate a new password
          </Button>
        </div>
      )}
    </section>
  );
}
