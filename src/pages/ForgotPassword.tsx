import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, Mail, CheckCircle } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { buildAppUrl } from "@/lib/appUrl";

// Accept email, mobile, or admission number
const identifierSchema = z.object({
  identifier: z.string().trim().min(1, { message: "Please enter your email, mobile number, or admission number" }),
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
    case "email": return "Email detected";
    case "mobile": return "Mobile number detected";
    case "admission": return "Admission number detected";
  }
}

export default function ForgotPassword() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [error, setError] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [resolvedEmail, setResolvedEmail] = useState("");

  const resolveIdentifierToEmail = async (identifier: string): Promise<{ email: string | null; error: string | null }> => {
    try {
      const response = await supabase.functions.invoke("resolve-login-identifier", {
        body: { identifier },
      });

      if (response.error) {
        return { email: null, error: "No account found with this identifier" };
      }

      if (response.data?.rateLimited) {
        return { email: null, error: response.data.error };
      }

      if (response.data?.error) {
        return { email: null, error: response.data.error };
      }

      return { email: response.data?.email || null, error: null };
    } catch (err) {
      return { email: null, error: "No account found with this identifier" };
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const result = identifierSchema.safeParse({ identifier });
    if (!result.success) {
      setError(result.error.errors[0]?.message || "Invalid input");
      return;
    }

    setIsLoading(true);

    try {
      const identifierType = detectIdentifierType(identifier);
      let emailToUse = identifier;

      // If not email, resolve to email first
      if (identifierType !== "email") {
        const { email, error: resolveError } = await resolveIdentifierToEmail(identifier);
        if (resolveError || !email) {
          toast({
            title: "Error",
            description: resolveError || "No account found with this identifier",
            variant: "destructive",
          });
          setIsLoading(false);
          return;
        }
        emailToUse = email;
      }

      const { error } = await supabase.auth.resetPasswordForEmail(emailToUse, {
        redirectTo: buildAppUrl("/reset-password"),
      });

      if (error) {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
      } else {
        setResolvedEmail(emailToUse);
        setIsSubmitted(true);
      }
    } catch (err) {
      toast({
        title: "Error",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const identifierHint = getIdentifierHint(identifier);

  // Mask email for display
  const maskedEmail = resolvedEmail ? 
    resolvedEmail.replace(/(.{2})(.*)(@.*)/, "$1***$3") : 
    identifier;

  if (isSubmitted) {
    return (
      <div className="min-h-dvh pt-safe pb-safe flex items-start justify-center bg-background px-6 pt-10 pb-8 lg:items-center lg:p-8">
        <motion.div
          className="w-full max-w-md text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
            <CheckCircle className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Check your email</h1>
          <p className="text-muted-foreground mb-6">
            We've sent a password reset link to <strong>{maskedEmail}</strong>. 
            Please check your inbox and follow the instructions.
          </p>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Didn't receive the email? Check your spam folder or{" "}
              <button
                onClick={() => setIsSubmitted(false)}
                className="text-primary hover:underline"
              >
                try again
              </button>
            </p>
            <Link to="/login">
              <Button variant="outline" className="w-full">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Login
              </Button>
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh pt-safe pb-safe flex items-start justify-center bg-background px-6 pt-10 pb-8 lg:items-center lg:p-8">
      <motion.div
        className="w-full max-w-md"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Link
          to="/login"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Login
        </Link>

        <div className="w-16 h-16 mb-6 rounded-full bg-primary/10 flex items-center justify-center">
          <Mail className="h-8 w-8 text-primary" />
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-2">Forgot your password?</h1>
        <p className="text-muted-foreground mb-8">
          No worries! Enter your email, mobile number, or admission number and we'll send you a link to reset your password.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="identifier">Email, Mobile, or Admission Number</Label>
            <Input
              id="identifier"
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="Enter email, mobile number, or admission number"
              required
              className={error ? "border-destructive" : ""}
            />
            {identifierHint && !error && (
              <p className="text-xs text-muted-foreground">{identifierHint}</p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Send Reset Link
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-8">
          Remember your password?{" "}
          <Link to="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
