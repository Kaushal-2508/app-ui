import * as React from "react";

import { useAuth } from "@/hooks/useAuth";
import { useTour } from "@/components/onboarding/GuidedTourProvider";
import { hasSeenFeatureTip, markFeatureTipSeen } from "@/lib/featureTips";

/**
 * Drives one feature guide (see src/lib/featureTips.ts): which step is showing,
 * or null when none is. Starts once `ready` (its targets are on screen) for a
 * user who has not seen it, never while the onboarding tour is running, and
 * steps aside if that tour starts mid-guide (not marked seen, so it plays later).
 */
export function useFeatureTip(tipId: string, total: number, ready: boolean) {
  const { user } = useAuth();
  const { isTourActive: onboardingTourActive } = useTour();
  const userId = user?.id ?? null;

  const [step, setStep] = React.useState<number | null>(null);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    if (!userId || !ready || done || step !== null || onboardingTourActive) return;
    if (hasSeenFeatureTip(tipId, userId)) return;
    // Let the surface finish opening so the tip lands on its target's final spot.
    const t = window.setTimeout(() => setStep(0), 500);
    return () => window.clearTimeout(t);
  }, [tipId, userId, ready, done, step, onboardingTourActive]);

  // The onboarding tour takes precedence: drop back to "not started".
  React.useEffect(() => {
    if (onboardingTourActive && step !== null) setStep(null);
  }, [onboardingTourActive, step]);

  const end = React.useCallback(() => {
    setStep(null);
    setDone(true);
    if (userId) markFeatureTipSeen(tipId, userId);
  }, [tipId, userId]);

  const next = React.useCallback(() => {
    if (step === null) return;
    if (step >= total - 1) end();
    else setStep(step + 1);
  }, [step, total, end]);

  return { step, next, end };
}
