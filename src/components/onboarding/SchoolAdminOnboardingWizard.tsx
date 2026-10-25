import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  CheckCircle2, 
  Users, 
  BookOpen, 
  GraduationCap,
  ArrowRight,
  FileText,
  PartyPopper
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { useAuth } from "@/hooks/useAuth";

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: typeof Users;
  route: string;
  checkFn: () => Promise<boolean>;
  ctaText: string;
}

export function SchoolAdminOnboardingWizard() {
  const [open, setOpen] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();
  const { institutionId: effectiveInstitutionId } = useEffectiveInstitution();
  const { user } = useAuth();

  const ONBOARDING_STEPS: OnboardingStep[] = [
    {
      id: "subjects",
      title: "Add Subjects",
      description: "Map subjects to your classes to enable exam creation",
      icon: BookOpen,
      route: "/school/subjects",
      ctaText: "Manage Subjects",
      checkFn: async () => {
        if (!effectiveInstitutionId) return false;
        const { count } = await supabase
          .from("subject_class_mappings")
          .select("*", { count: "exact", head: true })
          .eq("institution_id", effectiveInstitutionId);
        return (count || 0) > 0;
      },
    },
    {
      id: "teachers",
      title: "Add Teachers",
      description: "Invite teachers to create and evaluate exams",
      icon: Users,
      route: "/school/teachers",
      ctaText: "Add Teachers",
      checkFn: async () => {
        if (!effectiveInstitutionId) return false;
        const { count } = await supabase
          .from("user_roles")
          .select("*", { count: "exact", head: true })
          .eq("role", "teacher")
          .eq("institution_id", effectiveInstitutionId);
        return (count || 0) > 0;
      },
    },
    {
      id: "students",
      title: "Add Students",
      description: "Add students to classes for exam assignments",
      icon: GraduationCap,
      route: "/school/students",
      ctaText: "Add Students",
      checkFn: async () => {
        if (!effectiveInstitutionId) return false;
        const { count } = await supabase
          .from("user_roles")
          .select("*", { count: "exact", head: true })
          .eq("role", "student")
          .eq("institution_id", effectiveInstitutionId);
        return (count || 0) > 0;
      },
    },
    {
      id: "exam",
      title: "Create First Exam",
      description: "Create an exam to test the system",
      icon: FileText,
      route: "/exams/create",
      ctaText: "Create Exam",
      checkFn: async () => {
        if (!effectiveInstitutionId) return false;
        const { count } = await supabase
          .from("exams")
          .select("*", { count: "exact", head: true })
          .eq("institution_id", effectiveInstitutionId);
        return (count || 0) > 0;
      },
    },
  ];

  // Check if onboarding should show
  const { data: profile } = useQuery({
    queryKey: ["admin-onboarding-status", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", user.id)
        .single();
      return data;
    },
    enabled: !!user?.id,
  });

  // Check step completion status
  useEffect(() => {
    const checkSteps = async () => {
      const completed = new Set<string>();
      for (const step of ONBOARDING_STEPS) {
        const isComplete = await step.checkFn();
        if (isComplete) completed.add(step.id);
      }
      setCompletedSteps(completed);
      
      // Auto-show if not all steps complete and not dismissed
      if (completed.size < ONBOARDING_STEPS.length && !profile?.onboarding_completed && !dismissed) {
        setOpen(true);
      }
    };

    if (effectiveInstitutionId && user?.id) {
      checkSteps();
    }
  }, [effectiveInstitutionId, user?.id, profile?.onboarding_completed, dismissed]);

  const handleNavigate = (route: string) => {
    setOpen(false);
    navigate(route);
  };

  const handleComplete = async () => {
    if (!user?.id) return;
    await supabase
      .from("profiles")
      .update({ onboarding_completed: true } as any)
      .eq("id", user.id);
    setOpen(false);
  };

  const handleDismiss = () => {
    setDismissed(true);
    setOpen(false);
  };

  const progress = (completedSteps.size / ONBOARDING_STEPS.length) * 100;
  const allComplete = completedSteps.size === ONBOARDING_STEPS.length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {allComplete ? (
              <>
                <PartyPopper className="h-5 w-5 text-green-600" />
                Setup Complete!
              </>
            ) : (
              <>
                🎯 Complete Your School Setup
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {allComplete 
              ? "Your school is ready to use SALCI. You can always access these settings from the sidebar."
              : "Follow these steps to get your school up and running on SALCI."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{completedSteps.size} of {ONBOARDING_STEPS.length} steps complete</span>
              <span className="text-muted-foreground">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {/* Steps */}
          <div className="space-y-3">
            {ONBOARDING_STEPS.map((step, index) => {
              const Icon = step.icon;
              const isComplete = completedSteps.has(step.id);
              const isNext = !isComplete && 
                ONBOARDING_STEPS.slice(0, index).every(s => completedSteps.has(s.id));

              return (
                <Card 
                  key={step.id}
                  className={`transition-all ${isComplete ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800' : isNext ? 'border-primary' : ''}`}
                >
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className={`p-2 rounded-lg ${isComplete ? 'bg-green-100 dark:bg-green-900' : 'bg-muted'}`}>
                      {isComplete ? (
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                      ) : (
                        <Icon className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">{step.title}</h4>
                        {isComplete && (
                          <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">
                            Done
                          </Badge>
                        )}
                        {isNext && (
                          <Badge className="text-xs">Next</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{step.description}</p>
                    </div>
                    {!isComplete && (
                      <Button 
                        size="sm" 
                        variant={isNext ? "default" : "outline"}
                        onClick={() => handleNavigate(step.route)}
                      >
                        {step.ctaText}
                        <ArrowRight className="h-4 w-4 ml-1" />
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        <div className="flex justify-between">
          <Button variant="ghost" onClick={handleDismiss}>
            Dismiss
          </Button>
          {allComplete && (
            <Button onClick={handleComplete}>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Complete Setup
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Compact card version for dashboard
export function OnboardingProgressCard() {
  const navigate = useNavigate();
  const { institutionId: effectiveInstitutionId } = useEffectiveInstitution();
  const [completedCount, setCompletedCount] = useState(0);
  const [nextStep, setNextStep] = useState<OnboardingStep | null>(null);

  useEffect(() => {
    const checkProgress = async () => {
      if (!effectiveInstitutionId) return;

      // Quick checks for each step
      const [subjectCount, teacherCount, studentCount, examCount] = await Promise.all([
        supabase.from("subject_class_mappings").select("*", { count: "exact", head: true }).eq("institution_id", effectiveInstitutionId),
        supabase.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "teacher").eq("institution_id", effectiveInstitutionId),
        supabase.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "student").eq("institution_id", effectiveInstitutionId),
        supabase.from("exams").select("*", { count: "exact", head: true }).eq("institution_id", effectiveInstitutionId),
      ]);

      const steps = [
        { id: "subjects", complete: (subjectCount.count || 0) > 0, title: "Add Subjects", route: "/school/subjects", icon: BookOpen },
        { id: "teachers", complete: (teacherCount.count || 0) > 0, title: "Add Teachers", route: "/school/teachers", icon: Users },
        { id: "students", complete: (studentCount.count || 0) > 0, title: "Add Students", route: "/school/students", icon: GraduationCap },
        { id: "exam", complete: (examCount.count || 0) > 0, title: "Create Exam", route: "/exams/create", icon: FileText },
      ];

      const completed = steps.filter(s => s.complete).length;
      setCompletedCount(completed);

      const next = steps.find(s => !s.complete);
      if (next) {
        setNextStep(next as any);
      }
    };

    checkProgress();
  }, [effectiveInstitutionId]);

  if (completedCount === 4) return null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>Setup Progress</span>
          <Badge variant="secondary">{completedCount}/4</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress value={(completedCount / 4) * 100} className="h-2" />
        {nextStep && (
          <Button 
            size="sm" 
            className="w-full"
            onClick={() => navigate(nextStep.route)}
          >
            {nextStep.title}
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
