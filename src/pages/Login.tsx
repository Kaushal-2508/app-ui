import { useState, useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, CheckCircle } from "lucide-react";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isNativePlatform } from "@/lib/native";
import { readReturnPath } from "@/lib/returnPath";

// Universal identifier schema - accepts email, mobile (10 digits), or admission number
const loginSchema = z.object({
  identifier: z.string().trim().min(1, { message: "Please enter your email, mobile number, or admission number" }),
  password: z.string().min(6, { message: "Password must be at least 6 characters" }),
});

// Helper to detect identifier type
function detectIdentifierType(value: string): "email" | "mobile" | "admission" {
  const trimmed = value.trim();

  // Email pattern
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return "email";
  }

  // Mobile: 10 digits or 12 with country code
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length === 10 || (digitsOnly.length === 12 && digitsOnly.startsWith("91"))) {
    return "mobile";
  }

  return "admission";
}

// Format display hint based on input
function getIdentifierHint(value: string): string | null {
  if (!value) return null;
  const type = detectIdentifierType(value);
  switch (type) {
    case "email":
      return "Email detected";
    case "mobile":
      return "Mobile number detected";
    case "admission":
      return "Admission number detected";
  }
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  // The page a signed-out visitor was on (set by ProtectedRoute), validated
  // to a same-origin path; the dashboard otherwise.
  const afterLogin = readReturnPath(location.state);
  const { signIn, user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Login form state - single identifier field
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  // Redirect to the requested page (or the dashboard) if already authenticated.
  // Replace, so back from that page never returns here to bounce forward again.
  // Skip when the router has already left this page: in the app a scanned QR
  // (NativeBootstrap) can navigate between this render and its effect, and a
  // late redirect would drop the family on the dashboard instead of the form.
  useEffect(() => {
    if (authLoading || !user) return;
    if (window.location.pathname !== location.pathname) return;
    navigate(afterLogin, { replace: true });
  }, [authLoading, user, navigate, afterLogin, location.pathname]);

  const resolveIdentifierToEmail = async (
    identifier: string,
  ): Promise<{ email: string | null; error: string | null }> => {
    try {
      const response = await supabase.functions.invoke("resolve-login-identifier", {
        body: { identifier },
      });

      if (response.error) {
        return { email: null, error: "Invalid credentials" };
      }

      if (response.data?.rateLimited) {
        return { email: null, error: response.data.error };
      }

      if (response.data?.error) {
        return { email: null, error: response.data.error };
      }

      return { email: response.data?.email || null, error: null };
    } catch (err) {
      return { email: null, error: "Invalid credentials" };
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const result = loginSchema.safeParse({ identifier, password });
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) fieldErrors[err.path[0].toString()] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setIsLoading(true);

    try {
      const identifierType = detectIdentifierType(identifier);
      let emailToUse = identifier.trim();

      // If not email, resolve to email first via edge function
      if (identifierType !== "email") {
        const { email, error } = await resolveIdentifierToEmail(identifier);
        if (error || !email) {
          toast({
            title: "Login failed",
            description: error || "Invalid credentials",
            variant: "destructive",
          });
          setIsLoading(false);
          return;
        }
        emailToUse = email;
      }

      // Standard Supabase Auth login
      const { error } = await signIn(emailToUse, password);

      if (error) {
        toast({
          title: "Login failed",
          description: "Invalid credentials",
          variant: "destructive",
        });
      } else {
        // Reset, not just invalidate, the role cache: it still holds the
        // signed-out answer (`roles: []`), and while a plain refetch was in
        // flight ProtectedRoute judged that answer and bounced the page the
        // visitor asked for (the PTM feedback QR) to the dashboard. Reset
        // drops it now, so the guard waits for this user's roles.
        await queryClient.resetQueries({ queryKey: ["user-role-info"] });
        navigate(afterLogin, { replace: true });
      }
    } catch (err) {
      toast({
        title: "Login failed",
        description: "Invalid credentials",
        variant: "destructive",
      });
    }

    setIsLoading(false);
  };

  const features = [
    "AI-assisted fair evaluation",
    "Complete exam management",
    "Actionable learning insights",
    "Teacher-controlled assessments",
  ];

  const identifierHint = getIdentifierHint(identifier);

  // Shared by both layouts below; identical markup either way.
  const loginForm = (
    <>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground">Welcome back</h2>
        <p className="text-muted-foreground mt-1">Log in to your account to continue</p>
      </div>

      <form onSubmit={handleLogin} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="identifier">Email, Mobile, or Admission Number</Label>
          <Input
            id="identifier"
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="Enter email, mobile number, or admission number"
            required
            className={errors.identifier ? "border-destructive" : ""}
            autoComplete="username"
          />
          {identifierHint && !errors.identifier && (
            <p className="text-xs text-muted-foreground">{identifierHint}</p>
          )}
          {errors.identifier && <p className="text-sm text-destructive">{errors.identifier}</p>}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="text-sm text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className={errors.password ? "border-destructive" : ""}
            autoComplete="current-password"
          />
          {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
        </div>
        <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
          {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Log In
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground mt-8">
        By continuing, you agree to our{" "}
        <a
          href="https://www.salci.ai/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          Terms of Service
        </a>{" "}
        and{" "}
        <a
          href="https://www.salci.ai/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          Privacy Policy
        </a>
      </p>
    </>
  );

  // Inside the app the screen is always a phone, so the branding panel that
  // the web shows only on laptops comes back as a teal hero across the top
  // and the form rides on a white card that curves up over it. The gradient
  // runs under the status bar (the hero takes the top inset as padding). A
  // browser never sees this branch: the web layout below is unchanged.
  if (isNativePlatform()) {
    return (
      <div className="min-h-dvh flex flex-col bg-background">
        <div className="relative overflow-hidden bg-gradient-to-br from-brand-primary via-[hsl(183_60%_32%)] to-[hsl(220_45%_22%)] px-6 pb-16 pt-[calc(env(safe-area-inset-top,0px)+2.5rem)] text-white">
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <div className="absolute -bottom-24 -left-12 h-48 w-48 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <div className="relative flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white p-1.5 shadow-lg">
              <img src="/logo-mark.png" alt="" aria-hidden className="h-full w-full object-contain" />
            </div>
            <span className="text-2xl font-bold tracking-tight">SALCI</span>
          </div>
          <motion.h1
            className="relative mt-8 text-3xl font-bold leading-tight"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            Empowering Learning Beyond Marks
          </motion.h1>
          <p className="relative mt-2 text-sm text-white/80">
            The complete academic intelligence ecosystem for your school.
          </p>
        </div>
        <motion.div
          className="relative -mt-8 flex-1 rounded-t-[28px] bg-card px-6 pb-[calc(env(safe-area-inset-bottom,0px)+2rem)] pt-8 shadow-[0_-12px_32px_-16px_rgba(0,0,0,0.25)]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="mx-auto w-full max-w-md">{loginForm}</div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh pt-safe pb-safe flex">
      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary to-primary/80 p-12 flex-col justify-between relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-72 h-72 bg-white/5 rounded-full blur-3xl" />

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-6">
            {/* White tile on purpose: the panel is brand teal in both themes and
                the mark's teal ring would vanish straight on it. */}
            <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center p-1.5">
              <img src="/logo-mark.png" alt="" aria-hidden className="h-full w-full object-contain" />
            </div>
            <span className="text-2xl font-bold text-primary-foreground">SALCI</span>
          </div>
          <h1 className="text-4xl font-bold text-primary-foreground mb-4">Empowering Learning Beyond Marks</h1>
          <p className="text-primary-foreground/80 text-lg">
            The complete academic intelligence ecosystem for schools.
          </p>
        </div>

        <div className="relative z-10 space-y-4">
          {features.map((feature, index) => (
            <motion.div
              key={feature}
              className="flex items-center gap-3"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + index * 0.1 }}
            >
              <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                <CheckCircle className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="text-primary-foreground/90">{feature}</span>
            </motion.div>
          ))}
        </div>

        <div className="relative z-10">
          <p className="text-primary-foreground/60 text-sm">© {new Date().getFullYear()} SALCI. All rights reserved.</p>
        </div>
      </div>

      {/* Right side - Login Form */}
      {/* Phones: the form starts near the top instead of floating mid-screen,
          which left the top third blank on a tall iPhone (2026-09-17). Laptops
          keep the centred column beside the branding panel. */}
      <div className="flex-1 flex items-start justify-center bg-background px-6 pt-10 pb-8 lg:items-center lg:p-8">
        <motion.div className="w-full max-w-md" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <img src="/logo-mark.png" alt="" aria-hidden className="h-10 w-10 object-contain" />
            <span className="text-xl font-bold text-foreground">SALCI</span>
          </div>

          {loginForm}
        </motion.div>
      </div>
    </div>
  );
}
