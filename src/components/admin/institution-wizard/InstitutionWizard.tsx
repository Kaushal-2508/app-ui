import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { Building2, Users, CheckCircle, Loader2, Settings, Boxes, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCreateInstitution } from "@/hooks/useAdminOperations";
import { supabase } from "@/integrations/supabase/client";
import { InstitutionDetailsStep } from "./InstitutionDetailsStep";
import { ClassStructureStep } from "./ClassStructureStep";
import { SharedResourcesStep } from "./SharedResourcesStep";
import { FeaturesSelectionStep, AVAILABLE_FEATURES } from "./FeaturesSelectionStep";
import { ReviewStep } from "./ReviewStep";
import { WizardData, WizardStep, InstitutionFormData, ClassConfig } from "./types";
import type { SharedResourceInput } from "@/hooks/useSharedResources";

interface InstitutionWizardProps {
  onComplete: (credentials: { email: string; password: string }) => void;
  onCancel: () => void;
}

const STEP_TITLES = [
  { step: 1, title: "Institution Details", icon: Building2 },
  { step: 2, title: "Class Structure", icon: Users },
  { step: 3, title: "Shared Resources", icon: Boxes },
  { step: 4, title: "Features", icon: Settings },
  { step: 5, title: "Review & Create", icon: CheckCircle },
];

const getCurrentAcademicYear = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  if (month >= 3) {
    return `${year}-${(year + 1).toString().slice(-2)}`;
  }
  return `${year - 1}-${year.toString().slice(-2)}`;
};

// Get default enabled features
const getDefaultFeatures = () => {
  return AVAILABLE_FEATURES.filter((f) => f.isDefault).map((f) => f.id);
};

export function InstitutionWizard({ onComplete, onCancel }: InstitutionWizardProps) {
  const { toast } = useToast();
  const createInstitution = useCreateInstitution();
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [wizardData, setWizardData] = useState<WizardData>({
    institution: {
      name: "",
      code: "",
      contactEmail: "",
      contactPhone: "",
      address: "",
      adminEmail: "",
      adminName: "",
      adminPassword: "",
      adminRole: "school_admin",
    },
    academicYear: getCurrentAcademicYear(),
    classes: [],
    enabledFeatures: getDefaultFeatures(),
    sharedResources: [],
    sharedResourcesConfirmedEmpty: false,
  });

  const updateInstitution = (data: InstitutionFormData) => {
    setWizardData(prev => ({ ...prev, institution: data }));
  };

  const updateAcademicYear = (year: string) => {
    setWizardData(prev => ({ ...prev, academicYear: year }));
  };

  const updateClasses = (classes: ClassConfig[]) => {
    setWizardData(prev => ({ ...prev, classes }));
  };

  const updateEnabledFeatures = (features: string[]) => {
    setWizardData(prev => ({ ...prev, enabledFeatures: features }));
  };

  const updateSharedResources = (sharedResources: SharedResourceInput[]) => {
    setWizardData(prev => ({ ...prev, sharedResources }));
  };

  const updateSharedResourcesConfirmedEmpty = (value: boolean) => {
    setWizardData(prev => ({ ...prev, sharedResourcesConfirmedEmpty: value }));
  };

  const canProceed = (): boolean => {
    switch (currentStep) {
      case 1: {
        const inst = wizardData.institution;
        return !!(
          inst.name.trim() &&
          inst.code.trim() &&
          inst.adminEmail.trim() &&
          inst.adminName.trim() &&
          inst.adminPassword.trim() &&
          inst.adminPassword.length >= 6
        );
      }
      case 2:
        // At least one class with at least one section and one subject
        return wizardData.classes.length > 0 &&
          wizardData.classes.every(c => c.sections.length > 0 && c.subjectIds.length > 0);
      case 3:
        // Shared resources: either at least one declared, or explicitly
        // confirmed none — force a conscious choice.
        return (
          wizardData.sharedResources.length > 0 ||
          wizardData.sharedResourcesConfirmedEmpty
        );
      case 4:
        // At least core features must be selected
        return wizardData.enabledFeatures.length > 0;
      case 5:
        return true;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (currentStep < 5) {
      setCurrentStep((currentStep + 1) as WizardStep);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep((currentStep - 1) as WizardStep);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const createResult = await createInstitution.mutateAsync({
        name: wizardData.institution.name,
        code: wizardData.institution.code,
        contactEmail: wizardData.institution.contactEmail || undefined,
        contactPhone: wizardData.institution.contactPhone || undefined,
        address: wizardData.institution.address || undefined,
        adminEmail: wizardData.institution.adminEmail,
        adminName: wizardData.institution.adminName,
        adminPassword: wizardData.institution.adminPassword,
        adminRole: wizardData.institution.adminRole,
        academicYear: wizardData.academicYear,
        classes: wizardData.classes.map(c => ({
          name: c.name,
          sections: c.sections,
          subjectIds: c.subjectIds,
        })),
        enabledFeatures: wizardData.enabledFeatures,
      });

      // Post-create: seed shared resources for the new institution.
      // Non-blocking — surface a warning if it fails but don't abort
      // the onboarding flow since the admin can add them later from
      // Settings → Shared Resources.
      const newInstitutionId = createResult?.institution?.id as string | undefined;
      if (newInstitutionId && wizardData.sharedResources.length > 0) {
        const { error: resourcesError } = await supabase
          .from("tt_resources" as never)
          .insert(
            wizardData.sharedResources.map((r) => ({
              institution_id: newInstitutionId,
              name: r.name.trim(),
              kind: r.resource_type,
              capacity: r.count,
              description: r.description?.trim() || null,
            })) as never,
          );
        if (resourcesError) {
          console.error("Failed to seed shared resources:", resourcesError);
          toast({
            title: "Heads up",
            description:
              "Institution created, but shared resources couldn't be saved. Add them from Settings → Shared Resources.",
            variant: "destructive",
          });
        }
      }

      // Send welcome email with credentials (non-blocking)
      try {
        const { error: inviteError } = await supabase.functions.invoke('invite-admin', {
          body: {
            email: wizardData.institution.adminEmail,
            name: wizardData.institution.adminName,
            password: wizardData.institution.adminPassword,
            institutionName: wizardData.institution.name,
            institutionCode: wizardData.institution.code,
          },
        });

        if (inviteError) {
          console.error("Failed to send welcome email:", inviteError);
          toast({
            title: "Note",
            description: "Institution created, but welcome email could not be sent",
          });
        } else {
          toast({
            title: "Email Sent",
            description: "Welcome email with credentials sent to admin",
          });
        }
      } catch (emailError) {
        console.error("Email service error:", emailError);
        // Non-blocking - institution was still created successfully
      }

      // Use the password entered by super admin
      onComplete({
        email: wizardData.institution.adminEmail,
        password: wizardData.institution.adminPassword,
      });
    } catch (error: unknown) {
      console.error("Failed to create institution:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to create institution";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <InstitutionDetailsStep
            data={wizardData.institution}
            onChange={updateInstitution}
          />
        );
      case 2:
        return (
          <ClassStructureStep
            academicYear={wizardData.academicYear}
            classes={wizardData.classes}
            onAcademicYearChange={updateAcademicYear}
            onClassesChange={updateClasses}
          />
        );
      case 3:
        return (
          <SharedResourcesStep
            resources={wizardData.sharedResources}
            confirmedEmpty={wizardData.sharedResourcesConfirmedEmpty}
            onResourcesChange={updateSharedResources}
            onConfirmedEmptyChange={updateSharedResourcesConfirmedEmpty}
          />
        );
      case 4:
        return (
          <FeaturesSelectionStep
            selectedFeatures={wizardData.enabledFeatures}
            onFeaturesChange={updateEnabledFeatures}
          />
        );
      case 5:
        return <ReviewStep wizardData={wizardData} />;
      default:
        return null;
    }
  };

  const activeTitle = STEP_TITLES[currentStep - 1].title;

  return (
    <div className="space-y-5">
      {/* Progress Steps — compact circles, all 5 fit; current label shown below */}
      <div>
        <div className="flex items-center justify-center">
          {STEP_TITLES.map(({ step, icon: Icon }, index) => {
            const isActive = step === currentStep;
            const isDone = step < currentStep;
            return (
              <Fragment key={step}>
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all ${
                    isActive
                      ? "bg-brand-primary text-white shadow-card"
                      : isDone
                      ? "bg-brand-primary/15 text-brand-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                  aria-current={isActive ? "step" : undefined}
                  aria-label={`Step ${step}: ${STEP_TITLES[step - 1].title}`}
                >
                  {isDone ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </div>
                {index < STEP_TITLES.length - 1 && (
                  <div
                    className={`mx-1.5 h-0.5 flex-1 max-w-[48px] sm:max-w-[64px] transition-colors ${
                      isDone ? "bg-brand-primary" : "bg-muted"
                    }`}
                  />
                )}
              </Fragment>
            );
          })}
        </div>
        <div className="mt-3 text-center">
          <p className="eyebrow">
            Step {currentStep} of {STEP_TITLES.length}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-ink-900">{activeTitle}</p>
        </div>
      </div>

      {/* Step Content — sits directly on the dialog surface (no nested Card) */}
      <div>{renderStep()}</div>

      {/* Navigation */}
      <div className="flex items-center justify-between gap-2 border-t border-surface-stroke pt-4">
        <Button variant="ghost" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <div className="flex gap-2">
          {currentStep > 1 && (
            <Button variant="outline" onClick={handleBack} disabled={isSubmitting}>
              Back
            </Button>
          )}
          {currentStep < 5 ? (
            <Button onClick={handleNext} disabled={!canProceed()}>
              Next
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={isSubmitting || !canProceed()}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Institution
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
