import { CheckCircle2, Copy, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/olympiad/CopyField";
import { buildAppUrl } from "@/lib/appUrl";

type Props = {
  name?: string;
  rollNumber: string;
  /** ISO date (YYYY-MM-DD). The password is this date in DDMMYY form. */
  dob: string;
  /** False when the synthetic login wasn't provisioned (rare); the enrollment still saved. */
  loginReady?: boolean;
};

/** DDMMYY password derived from the date of birth (matches the auth password
 *  set by oly-cash-enroll). String-split — never `new Date()` on a date-only
 *  ISO string (UTC-midnight shifts the day west of UTC). */
function dobToPassword(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return `${d.padStart(2, "0")}${m.padStart(2, "0")}${y.slice(-2)}`;
}

/**
 * Sign-in credentials for an Olympiad student at an onboarded (non-SALCI)
 * school. The student signs in at {origin}/olympiad/login with their Login ID
 * (roll number) and password (date of birth in DDMMYY form).
 */
export function OlympiadStudentCredentials({ name, rollNumber, dob, loginReady = true }: Props) {
  // Canonical app URL, not window.location.origin: inside the native shell the origin is capacitor://localhost.
  const loginUrl = buildAppUrl("/olympiad/login");
  const password = dobToPassword(dob);

  const copyAll = () => {
    navigator.clipboard
      .writeText(`Login page: ${loginUrl}\nLogin ID: ${rollNumber}\nPassword: ${password}`)
      .then(() => toast.success("Credentials copied"))
      .catch(() => toast.error("Couldn't copy"));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>
          {name ? <span className="font-semibold">{name}</span> : "The student"} is enrolled. Share
          the login details below.
        </span>
      </div>

      <CopyField label="Login page" value={loginUrl} />
      <CopyField label="Login ID" value={rollNumber} mono />
      <CopyField label="Password" value={password} mono />

      <Button type="button" variant="outline" className="w-full" onClick={copyAll}>
        <Copy className="mr-2 h-4 w-4" /> Copy all credentials
      </Button>

      {loginReady ? (
        <p className="text-[11px] text-ink-500">
          The student signs in at the Olympiad login page with this <strong>Login ID</strong> and{" "}
          <strong>password</strong>. The password is their date of birth in DDMMYY format (e.g. 8
          Jan 2009 → 080109).
        </p>
      ) : (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            The enrollment is saved, but the student's login is still being set up. If they can't
            sign in shortly, contact your school administrator.
          </span>
        </div>
      )}
    </div>
  );
}
