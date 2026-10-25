import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Medal } from "lucide-react";
import { OlympiadPublicLayout } from "@/components/olympiad/public/OlympiadPublicLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOlympiadStudentLogin } from "@/hooks/olympiad/useOlympiadStudentLogin";

export default function OlympiadStudentLoginPage() {
  const navigate = useNavigate();
  const login = useOlympiadStudentLogin();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  const canSubmit = identifier.trim().length >= 3 && password.trim().length >= 4;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      await login.mutateAsync({ identifier: identifier.trim(), password: password.trim() });
      navigate("/student/olympiad");
    } catch { /* toastError fires */ }
  };

  return (
    <OlympiadPublicLayout>
      <form
        onSubmit={onSubmit}
        className="surface-card frosted-shadow rounded-card p-6 sm:p-8 space-y-5 max-w-md mx-auto"
      >
        <header className="text-center">
          <Medal className="h-10 w-10 text-brand-primary mx-auto mb-2" />
          <p className="eyebrow">SALCI Olympiad</p>
          <h1 className="text-2xl font-bold text-ink-900 mt-1">Sign in</h1>
        </header>

        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Login ID</Label>
          <Input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value.toUpperCase())}
            placeholder="e.g. SO26-DEL042-08-0001"
            autoComplete="username"
            required
          />
          <p className="text-[11px] text-ink-500">Your roll number, provided by your school.</p>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Password</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="6-digit password"
            autoComplete="current-password"
            inputMode="numeric"
            required
          />
          <p className="text-[11px] text-ink-500">
            Your date of birth in DDMMYY format (e.g. 8 Jan 2009 → 080109).
          </p>
        </div>

        <Button type="submit" className="w-full" disabled={!canSubmit || login.isPending}>
          {login.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Sign in
        </Button>
      </form>
    </OlympiadPublicLayout>
  );
}
