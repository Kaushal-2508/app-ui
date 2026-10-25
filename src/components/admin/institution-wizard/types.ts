import type { SharedResourceInput } from "@/hooks/useSharedResources";

export interface InstitutionFormData {
  // Step 1: Institution Details
  name: string;
  code: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  adminEmail: string;
  adminName: string;
  adminPassword: string;
  adminRole: "school_admin" | "super_school_admin";
}

export interface ClassConfig {
  name: string;
  sections: string[];
  subjectIds: string[]; // Per-class subject selection
}

export interface WizardData {
  institution: InstitutionFormData;
  academicYear: string;
  classes: ClassConfig[];
  enabledFeatures: string[]; // Feature IDs that are enabled for this institution
  // Step 3: Shared resources (labs, library, computer rooms). Admin must
  // either declare at least one resource OR explicitly confirm there are
  // none — we want a conscious choice, not an oversight.
  sharedResources: SharedResourceInput[];
  sharedResourcesConfirmedEmpty: boolean;
}

export type WizardStep = 1 | 2 | 3 | 4 | 5;
