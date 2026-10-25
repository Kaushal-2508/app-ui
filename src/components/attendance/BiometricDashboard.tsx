import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { Fingerprint, Shield, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { useUserRole } from "@/hooks/useUserRole";
import { format } from "date-fns";

export function BiometricDashboard() {
  const { data: roleInfo } = useUserRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const [enrollmentCount, setEnrollmentCount] = useState(0);
  const [todayCheckins, setTodayCheckins] = useState(0);

  useEffect(() => {
    if (!institutionId) return;

    supabase
      .from("biometric_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("institution_id", institutionId)
      .eq("is_active", true)
      .then(({ count }) => setEnrollmentCount(count || 0));

    const today = format(new Date(), "yyyy-MM-dd");
    supabase
      .from("attendance_records")
      .select("id", { count: "exact", head: true })
      .eq("institution_id", institutionId)
      .eq("method", "biometric")
      .eq("date", today)
      .then(({ count }) => setTodayCheckins(count || 0));
  }, [institutionId]);

  return (
    <div className="space-y-4">
      <DashboardSection
        title="Biometric Attendance"
        description="Fingerprint-based attendance tracking overview"
        icon={Fingerprint}
        iconGradient="from-violet-400 to-purple-500"
      >
        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="rounded-2xl">
            <CardContent className="pt-4 text-center">
              <div className="text-3xl font-bold text-primary">{enrollmentCount}</div>
              <p className="text-sm text-muted-foreground mt-1">Students Enrolled</p>
            </CardContent>
          </Card>
          <Card className="rounded-2xl">
            <CardContent className="pt-4 text-center">
              <div className="text-3xl font-bold text-green-600">{todayCheckins}</div>
              <p className="text-sm text-muted-foreground mt-1">Today's Check-ins</p>
            </CardContent>
          </Card>
          <Card className="rounded-2xl">
            <CardContent className="pt-4 text-center">
              <Badge variant="outline" className="text-amber-700 bg-amber-50 text-sm px-3 py-1">
                <Shield className="h-3.5 w-3.5 mr-1.5" /> Hardware Required
              </Badge>
              <p className="text-sm text-muted-foreground mt-2">External scanner needed</p>
            </CardContent>
          </Card>
        </div>

        {/* Integration Guide */}
        <Card className="border-dashed border-2 rounded-2xl mt-4">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
              <div className="space-y-2">
                <h4 className="font-medium text-sm">Hardware Integration Required</h4>
                <p className="text-sm text-muted-foreground">
                  Biometric attendance requires a physical fingerprint scanner connected to a desktop application.
                  The scanner software calls our API to mark attendance automatically.
                </p>
                <div className="text-sm space-y-1">
                  <p className="font-medium">API Endpoint:</p>
                  <code className="text-xs bg-muted px-2 py-1 rounded block">
                    POST /functions/v1/mark-biometric-attendance
                  </code>
                  <p className="font-medium mt-2">Request Body:</p>
                  <pre className="text-xs bg-muted px-2 py-1 rounded block overflow-x-auto">
{`{
  "student_id": "uuid",
  "class_id": "uuid", 
  "fingerprint_hash": "string",
  "device_id": "string"
}`}
                  </pre>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </DashboardSection>
    </div>
  );
}
