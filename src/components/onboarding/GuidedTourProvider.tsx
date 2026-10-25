import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import Joyride, { CallBackProps, STATUS, EVENTS, Step } from "react-joyride";
import { useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { getTourByRole } from "@/config/tourSteps";
import { isAppLinkRoute } from "@/lib/appLinks";
import { toast } from "sonner";

interface TourContextType {
  startTour: () => void;
  restartTour: () => void;
  isTourActive: boolean;
  isTourCompleted: boolean;
}

const TourContext = createContext<TourContextType>({
  startTour: () => {},
  restartTour: () => {},
  isTourActive: false,
  isTourCompleted: false,
});

export const useTour = () => useContext(TourContext);

interface GuidedTourProviderProps {
  children: ReactNode;
}

export function GuidedTourProvider({ children }: GuidedTourProviderProps) {
  const { user } = useAuth();
  const { data: roleInfo } = useUserRole();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const [run, setRun] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [isTourCompleted, setIsTourCompleted] = useState(true);
  const [stepIndex, setStepIndex] = useState(0);
  const [shouldStartTour, setShouldStartTour] = useState(false);

  // Check if user has completed onboarding. This provider is mounted inside
  // AppLayout, which ProtectedRoute remounts on EVERY route change — as a
  // bare useEffect fetch this fired a profiles SELECT per navigation for
  // every user (§23 request amplification). Cached effectively forever:
  // completion only changes via markTourComplete, which writes the cache.
  const { data: onboardingCompleted } = useQuery({
    queryKey: ["onboarding-completed", user?.id],
    queryFn: async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", user!.id)
        .single();
      return profile?.onboarding_completed ?? true;
    },
    enabled: !!user?.id,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (onboardingCompleted === undefined) return;
    if (!onboardingCompleted) {
      setIsTourCompleted(false);
      setShouldStartTour(true);
    } else {
      setIsTourCompleted(true);
      setShouldStartTour(false);
    }
  }, [onboardingCompleted]);

  // Set tour steps based on role
  useEffect(() => {
    if (roleInfo?.primaryRole) {
      const tourConfig = getTourByRole(roleInfo.primaryRole);
      console.log("Setting tour steps for role:", roleInfo.primaryRole, "steps count:", tourConfig.steps.length);
      setSteps(tourConfig.steps);
    }
  }, [roleInfo?.primaryRole]);

  // Start tour when steps are ready and we should start it. Never on a page a
  // family opens from a QR code (src/lib/appLinks.ts): a first sign-in there
  // must show the feedback form with nothing over it. The tour starts on their
  // next page instead, because this provider mounts afresh on every route.
  const onAppLinkPage = isAppLinkRoute(pathname);
  useEffect(() => {
    if (shouldStartTour && steps.length > 0 && !onAppLinkPage) {
      console.log("Auto-starting tour with", steps.length, "steps");
      // Delay to ensure DOM is ready
      setTimeout(() => {
        setStepIndex(0);
        setRun(true);
        setShouldStartTour(false);
      }, 2000);
    }
  }, [shouldStartTour, steps.length, onAppLinkPage]);

  const startTour = () => {
    console.log("startTour called, steps count:", steps.length);
    if (steps.length > 0) {
      setStepIndex(0);
      setRun(true);
      console.log("Tour started!");
    } else {
      console.log("No steps to show, tour not started");
    }
  };

  const restartTour = () => {
    setStepIndex(0);
    setRun(true);
  };

  const markTourComplete = async () => {
    if (!user?.id) return;

    try {
      // Through the RPC, not a direct update: once the self-update policy stops
      // covering students, a direct write is a silent RLS no-op and the tour
      // replays on every login.
      await supabase.rpc("mark_onboarding_complete", {
        _steps: steps.map((s, i) => ({ step: i, target: String(s.target) })) as unknown as Json,
      });

      setIsTourCompleted(true);
      queryClient.setQueryData(["onboarding-completed", user.id], true);
      toast.success("Tour completed! You're all set to explore SALCI! 🎉");
    } catch (error) {
      console.error("Failed to mark tour complete:", error);
    }
  };

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status, type, index } = data;
    const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];

    if (finishedStatuses.includes(status)) {
      setRun(false);
      markTourComplete();
    }

    if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
      setStepIndex(index + 1);
    }
  };

  return (
    <TourContext.Provider
      value={{
        startTour,
        restartTour,
        isTourActive: run,
        isTourCompleted,
      }}
    >
      {children}
      <Joyride
        callback={handleJoyrideCallback}
        continuous
        hideCloseButton
        run={run}
        scrollToFirstStep
        showProgress
        showSkipButton
        steps={steps}
        stepIndex={stepIndex}
        styles={{
          options: {
            arrowColor: "hsl(var(--popover))",
            backgroundColor: "hsl(var(--popover))",
            overlayColor: "rgba(0, 0, 0, 0.5)",
            primaryColor: "hsl(var(--primary))",
            textColor: "hsl(var(--popover-foreground))",
            zIndex: 10000,
          },
          tooltip: {
            borderRadius: "12px",
            padding: "16px",
          },
          tooltipContainer: {
            textAlign: "left" as const,
          },
          tooltipTitle: {
            fontSize: "16px",
            fontWeight: 600,
          },
          tooltipContent: {
            fontSize: "14px",
            padding: "8px 0",
          },
          buttonNext: {
            backgroundColor: "hsl(var(--primary))",
            borderRadius: "8px",
            padding: "8px 16px",
            fontSize: "14px",
          },
          buttonBack: {
            color: "hsl(var(--muted-foreground))",
            marginRight: 8,
          },
          buttonSkip: {
            color: "hsl(var(--muted-foreground))",
          },
          spotlight: {
            borderRadius: "8px",
          },
        }}
        locale={{
          back: "Back",
          close: "Close",
          last: "Got it!",
          next: "Next",
          skip: "Skip Tour",
        }}
      />
    </TourContext.Provider>
  );
}
