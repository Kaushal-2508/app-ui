import { CheckCircle2, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/olympiad/CopyField";
import { buildAppUrl } from "@/lib/appUrl";

type Props = {
  /** Teacher's name, used in the default intro line. */
  name?: string;
  email: string;
  password: string;
  /** Override the green intro line (e.g. for a password reset vs. a new account). */
  intro?: string;
};

/**
 * Copyable login credentials for an Olympiad teacher account. Shared by the
 * "Add teacher" success state and the "Generate new password" flow. The login
 * URL uses the canonical app URL so it stays correct across the dual frontends
 * (app.salci.ai or salci.org / salci.sale) and inside the native shell.
 */
export function OlympiadTeacherCredentials({ name, email, password, intro }: Props) {
  // Canonical app URL, not window.location.origin: inside the native shell the origin is capacitor://localhost.
  const loginUrl = buildAppUrl("/login");

  const copyAll = () => {
    navigator.clipboard
      .writeText(`Login page: ${loginUrl}\nEmail: ${email}\nPassword: ${password}`)
      .then(() => toast.success("Credentials copied"))
      .catch(() => toast.error("Couldn't copy"));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>
          {intro ?? (
            <>
              {name ? <span className="font-semibold">{name}</span> : "The teacher"} can now sign in
              with the details below.
            </>
          )}
        </span>
      </div>

      <CopyField label="Login page" value={loginUrl} />
      <CopyField label="Email" value={email} />
      <CopyField label="Password" value={password} mono />

      <Button type="button" variant="outline" className="w-full" onClick={copyAll}>
        <Copy className="mr-2 h-4 w-4" /> Copy all credentials
      </Button>

      <p className="text-[11px] text-ink-500">
        Share these with the teacher. For security it's only shown here, so copy it now. The
        teacher can change it anytime from Settings after signing in.
      </p>
    </div>
  );
}
