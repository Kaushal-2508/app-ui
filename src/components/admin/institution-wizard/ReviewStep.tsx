import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, User, GraduationCap, BookOpen, CheckCircle2, Settings, Boxes } from "lucide-react";
import { RESOURCE_TYPE_LABELS } from "@/hooks/useSharedResources";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WizardData } from "./types";
import { AVAILABLE_FEATURES } from "./FeaturesSelectionStep";

interface ReviewStepProps {
  wizardData: WizardData;
}

export function ReviewStep({ wizardData }: ReviewStepProps) {
  // Collect all unique subject IDs across all classes
  const allSubjectIds = [...new Set(wizardData.classes.flatMap(c => c.subjectIds))];

  const { data: subjects } = useQuery({
    queryKey: ['wizard-subjects-review', allSubjectIds],
    queryFn: async () => {
      if (allSubjectIds.length === 0) return [];
      const { data, error } = await supabase
        .from('universal_subjects')
        .select('id, name, code')
        .in('id', allSubjectIds);
      if (error) throw error;
      return data || [];
    },
    enabled: allSubjectIds.length > 0
  });

  const subjectMap = new Map(subjects?.map(s => [s.id, s]) || []);

  // Calculate totals
  const totalClassSections = wizardData.classes.reduce((sum, c) => sum + c.sections.length, 0);
  const totalSubjectMappings = wizardData.classes.reduce((sum, c) => sum + (c.sections.length * c.subjectIds.length), 0);

  // Get enabled features info
  const enabledFeatures = AVAILABLE_FEATURES.filter(f => wizardData.enabledFeatures.includes(f.id));
  const coreFeatures = enabledFeatures.filter(f => f.category === "core");
  const optionalFeatures = enabledFeatures.filter(f => f.category !== "core");

  return (
    <div className="space-y-6">
      <div className="text-center pb-4">
        <CheckCircle2 className="h-12 w-12 text-primary mx-auto mb-2" />
        <h3 className="text-lg font-semibold">Review Your Institution Setup</h3>
        <p className="text-sm text-muted-foreground">Please review the details before creating the institution</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Institution Details */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Institution Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Name:</span>
              <span className="font-medium">{wizardData.institution.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Code:</span>
              <Badge variant="outline">{wizardData.institution.code.toUpperCase()}</Badge>
            </div>
            {wizardData.institution.contactEmail && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Contact Email:</span>
                <span>{wizardData.institution.contactEmail}</span>
              </div>
            )}
            {wizardData.institution.contactPhone && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Phone:</span>
                <span>{wizardData.institution.contactPhone}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Admin Account */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4" />
              School Admin Account
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Name:</span>
              <span className="font-medium">{wizardData.institution.adminName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Email:</span>
              <span>{wizardData.institution.adminEmail}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Role:</span>
              <Badge variant={wizardData.institution.adminRole === "super_school_admin" ? "default" : "secondary"}>
                {wizardData.institution.adminRole === "super_school_admin" ? "Owner (Super School Admin)" : "School Admin"}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Password:</span>
              <span className="text-muted-foreground italic">As provided</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Enabled Features */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Enabled Features
            <Badge variant="secondary" className="ml-auto">
              {wizardData.enabledFeatures.length} features
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-2">Core Features (always enabled)</p>
              <div className="flex flex-wrap gap-1">
                {coreFeatures.map(feature => {
                  const Icon = feature.icon;
                  return (
                    <Badge key={feature.id} variant="secondary" className="text-xs">
                      <Icon className="h-3 w-3 mr-1" />
                      {feature.name}
                    </Badge>
                  );
                })}
              </div>
            </div>
            {optionalFeatures.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Additional Features</p>
                <div className="flex flex-wrap gap-1">
                  {optionalFeatures.map(feature => {
                    const Icon = feature.icon;
                    return (
                      <Badge key={feature.id} variant="outline" className="text-xs">
                        <Icon className="h-3 w-3 mr-1" />
                        {feature.name}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Classes Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <GraduationCap className="h-4 w-4" />
            Class Structure
            <Badge variant="secondary" className="ml-auto">
              {wizardData.academicYear}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 max-h-[300px] overflow-y-auto">
            {wizardData.classes.map(classConfig => (
              <div key={classConfig.name} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{classConfig.name}</span>
                  <div className="flex gap-2">
                    <Badge variant="outline">
                      {classConfig.sections.length} sections
                    </Badge>
                    <Badge variant="outline">
                      {classConfig.subjectIds.length} subjects
                    </Badge>
                  </div>
                </div>
                
                {/* Sections */}
                <div className="flex flex-wrap gap-1">
                  {classConfig.sections.map(section => (
                    <Badge key={section} variant="secondary" className="text-xs">
                      {section}
                    </Badge>
                  ))}
                </div>
                
                {/* Subjects */}
                <div className="flex flex-wrap gap-1">
                  {classConfig.subjectIds.map(subjectId => {
                    const subject = subjectMap.get(subjectId);
                    return (
                      <Badge key={subjectId} variant="outline" className="text-xs">
                        <BookOpen className="h-3 w-3 mr-1" />
                        {subject?.name || 'Unknown'}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          
          {/* Totals */}
          <div className="mt-4 pt-4 border-t grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-primary">{wizardData.classes.length}</div>
              <div className="text-xs text-muted-foreground">Classes</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-primary">{totalClassSections}</div>
              <div className="text-xs text-muted-foreground">Total Sections</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-primary">{totalSubjectMappings}</div>
              <div className="text-xs text-muted-foreground">Subject Mappings</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Shared Resources Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Boxes className="h-4 w-4" />
            Shared Resources
            <Badge variant="secondary" className="ml-auto">
              {wizardData.sharedResources.length > 0
                ? `${wizardData.sharedResources.length} resource${wizardData.sharedResources.length === 1 ? "" : "s"}`
                : "None"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {wizardData.sharedResources.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No shared rooms declared. The timetable will treat every room
              as class-owned. You can add resources later from Settings →
              Shared Resources.
            </p>
          ) : (
            <div className="space-y-2">
              {wizardData.sharedResources.map((r, idx) => (
                <div
                  key={`${r.name}-${idx}`}
                  className="flex items-center justify-between border rounded-md p-2 text-sm"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium truncate">{r.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {RESOURCE_TYPE_LABELS[r.resource_type]}
                    </span>
                  </div>
                  <Badge variant="outline">
                    {r.count} room{r.count === 1 ? "" : "s"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-center text-sm text-muted-foreground">
        Click <strong>"Create Institution"</strong> to complete the setup. The admin credentials will be shown after creation.
      </div>
    </div>
  );
}
