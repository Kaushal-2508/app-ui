import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Building2, 
  Users, 
  GraduationCap, 
  School,
  Eye,
  X,
} from "lucide-react";
import { useOmnivisibility, ViewPerspective } from "@/hooks/useOmnivisibility";
import { formatClassName } from "@/lib/utils";

interface OmnivisibilitySelectorProps {
  omnivisibility: ReturnType<typeof useOmnivisibility>;
}

export function OmnivisibilitySelector({ omnivisibility }: OmnivisibilitySelectorProps) {
  const {
    institutionId,
    perspective,
    selectedUserId,
    selectedClassId,
    institutions,
    teachers,
    students,
    classes,
    isLoading,
    setInstitution,
    setPerspective,
    setSelectedUser,
    setSelectedClass,
    reset,
    currentInstitutionName,
    currentUserName,
  } = omnivisibility;

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <Eye className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Super Admin Dashboard Viewer</span>
          <Badge variant="outline" className="ml-auto text-xs">
            Viewing as Super Admin
          </Badge>
          {institutionId && (
            <Button variant="ghost" size="sm" onClick={reset}>
              <X className="h-3 w-3 mr-1" />
              Reset
            </Button>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          {/* Institution Selector */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Institution</label>
            <SearchableSelect
              value={institutionId || ""}
              onValueChange={setInstitution}
              placeholder="Select institution"
              searchPlaceholder="Search institutions..."
              options={institutions?.map((inst) => ({
                value: inst.id,
                label: inst.name,
                description: inst.code,
                icon: Building2,
              })) || []}
            />
          </div>

          {/* Perspective Selector */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">View As</label>
            <SearchableSelect
              value={perspective}
              onValueChange={(v) => setPerspective(v as ViewPerspective)}
              disabled={!institutionId}
              placeholder="Select perspective"
              searchPlaceholder="Search..."
              options={[
                { value: "school_admin", label: "School Admin View", icon: School },
                { value: "teacher", label: "Teacher View", icon: Users },
                { value: "student", label: "Student View", icon: GraduationCap },
              ]}
            />
          </div>

          {/* Class Selector (for student perspective) */}
          {perspective === "student" && institutionId && (
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Class (Optional)</label>
              <SearchableSelect
                value={selectedClassId || "all"}
                onValueChange={(v) => setSelectedClass(v === "all" ? null : v)}
                placeholder="All classes"
                searchPlaceholder="Search classes..."
                options={[
                  { value: "all", label: "All Classes" },
                  ...(classes?.map((cls) => ({
                    value: cls.id,
                    label: formatClassName(cls.name, cls.section),
                  })) || []),
                ]}
              />
            </div>
          )}

          {/* User Selector (for teacher/student perspective) */}
          {perspective !== "school_admin" && institutionId && (
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">
                {perspective === "teacher" ? "Teacher" : "Student"}
              </label>
              {isLoading ? (
                <Skeleton className="h-10" />
              ) : (
                <SearchableSelect
                  value={selectedUserId || ""}
                  onValueChange={setSelectedUser}
                  placeholder={`Select ${perspective}`}
                  searchPlaceholder={`Search ${perspective}s...`}
                  options={
                    perspective === "teacher"
                      ? teachers?.map((teacher) => ({
                          value: teacher.id,
                          label: teacher.name,
                          description: teacher.email,
                        })) || []
                      : students?.map((student) => ({
                          value: student.id,
                          label: student.name,
                          description: `${student.className} • ${student.email}`,
                        })) || []
                  }
                />
              )}
            </div>
          )}
        </div>

        {/* Current View Indicator */}
        {institutionId && (
          <div className="mt-4 pt-3 border-t flex items-center gap-2 text-sm">
            <Eye className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">Currently viewing:</span>
            <Badge variant="secondary">{currentInstitutionName}</Badge>
            <span className="text-muted-foreground">→</span>
            <Badge variant="outline" className="capitalize">{perspective} Dashboard</Badge>
            {currentUserName && (
              <>
                <span className="text-muted-foreground">→</span>
                <Badge>{currentUserName}</Badge>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
