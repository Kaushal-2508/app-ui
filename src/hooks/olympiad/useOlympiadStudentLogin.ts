import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

export type LoginInput = {
  identifier: string;     // Login ID — roll number or admission number
  password: string;       // date of birth in DDMMYY form
};

export type LoginResult = {
  ok: true;
  is_olympiad_only: boolean;
};

export function useOlympiadStudentLogin() {
  return useMutation({
    mutationFn: async (input: LoginInput): Promise<LoginResult> => {
      // Resolve the Login ID -> synthetic email. Pass an empty DOB: the resolver
      // skips the date-of-birth factor and signInWithPassword is the gate.
      const { data: resolve, error: resolveErr } = await supabase.rpc("oly_student_login_resolve", {
        p_identifier: input.identifier.trim(),
        p_dob_iso: "",
      });
      if (resolveErr) throw resolveErr;
      const result = resolve as {
        found: boolean;
        email?: string;
        is_olympiad_only?: boolean;
        message?: string;
      };
      if (!result.found) {
        throw new Error("Login ID or password is incorrect. Please check the credentials provided by your school.");
      }
      if (!result.is_olympiad_only) {
        throw new Error("Please use the main SALCI login for your account.");
      }

      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: result.email!,
        password: input.password.trim(),
      });
      if (signInErr) {
        if (signInErr.message?.toLowerCase().includes("invalid")) {
          throw new Error("Login ID or password is incorrect.");
        }
        throw new Error("Sign in failed. Please verify your credentials.");
      }

      return { ok: true, is_olympiad_only: true };
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Sign in failed.", context: "useOlympiadStudentLogin" }),
  });
}
