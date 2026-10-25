import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { 
  Mail, 
  Phone, 
  Building2, 
  Calendar, 
  Shield, 
  Copy,
  FileText,
  ClipboardCheck,
  Sparkles,
  Activity,
  BarChart3
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { StudentSubjectsTab } from "@/components/admin/StudentSubjectsTab";
import { StudentDetailsCard } from "@/components/admin/StudentDetailsCard";
import { useUserRole } from "@/hooks/useUserRole";
import { GraduationCap } from "lucide-react";
import { formatClassName } from "@/lib/utils";
import { UserAvatar, UserPhotoSheet } from "@/components/shared";
import { useCanSetUserPhoto } from "@/hooks/useSetUserAvatar";
import type { RollNumberSheetSection } from "@/components/school/UpdateRollNumberSheet";

interface ViewUserSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  /** Pages that own an Update Roll Number sheet pass this to show an "Edit
   *  whole class" button on the student's Roll Number field. Receives the
   *  student's section, or null when they have none (the sheet then opens on
   *  its class picker). The profile closes before this is called. */
  onUpdateRollNumbers?: (section: RollNumberSheetSection | null) => void;
}

type JoinedClassGroup = { name: string | null };
type JoinedStudentClass = {
  name: string | null;
  section: string | null;
  class_group_id: string | null;
  class_groups: JoinedClassGroup | JoinedClassGroup[] | null;
};

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function ViewUserSheet({ open, onOpenChange, userId, onUpdateRollNumbers }: ViewUserSheetProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data: roleInfo } = useUserRole();
  // Teachers may edit details for students in classes they teach; the
  // update_student_details RPC (via can_edit_student_details) is the
  // server-side backstop for any out-of-scope attempt.
  const canManageStudent = !!(
    roleInfo?.isSuperAdmin || roleInfo?.isSchoolAdmin || roleInfo?.isCoordinator || roleInfo?.isTeacher
  );

  const [photoOpen, setPhotoOpen] = useState(false);
  const { data: canSetPhoto } = useCanSetUserPhoto(userId);

  const { data: user, isLoading } = useQuery({
    queryKey: ["user-details", userId],
    queryFn: async () => {
      if (!userId) return null;
      
      const { data: profile, error } = await supabase
        .from("profiles")
        .select(`
          id, full_name, email, phone, is_active, created_at, updated_at,
          roll_number, admission_number, avatar_path,
          institution_id,
          institutions (id, name, code)
        `)
        .eq("id", userId)
        .single();

      if (error) throw error;

      const { data: roles } = await supabase
        .from("user_roles")
        .select("role, employee_level_id")
        .eq("user_id", userId);

      const { data: classAssignments } = await supabase
        .from("class_assignments")
        .select(`
          role, class_id,
          classes (name, section, academic_year, class_group_id, class_groups (name)),
          universal_subjects (name)
        `)
        .eq("user_id", userId)
        // One row per class+subject; even a heavily loaded teacher is far
        // below this. Explicit so PostgREST's silent 1000 cap never applies.
        .range(0, 499);

      // School-managed personal details (DOB, guardian). 1:1 with profile;
      // RLS returns nothing for viewers without access → degrades to null.
      const { data: personalDetails } = await supabase
        .from("student_personal_details")
        .select("date_of_birth, guardian_name, guardian_phone, guardian_email")
        .eq("profile_id", userId)
        .maybeSingle();

      return {
        ...profile,
        roles: roles || [],
        classAssignments: classAssignments || [],
        personalDetails: personalDetails ?? null,
      };
    },
    enabled: !!userId && open,
    // Edits invalidate ["user-details", id] (roll sheet + details card).
    staleTime: 60_000,
  });

  // Fetch user activity logs — aggregated from every table that records a
  // user-driven action keyed by this user's id. `system_audit_logs` alone only
  // captures admin-side operations (institution_created, user_created, …) so
  // non-admin users would always render an empty timeline if we read it solo.
  const { data: activityLogs } = useQuery({
    queryKey: ["user-activity-logs", userId, "v2"],
    queryFn: async () => {
      if (!userId) return [];

      type ActivityRow = {
        id: string;
        action: string;
        entity_type: string;
        entity_name: string | null;
        created_at: string;
      };
      type JoinedTitle = { title: string | null } | { title: string | null }[] | null;
      const pickTitle = (v: JoinedTitle): string | null => {
        if (!v) return null;
        if (Array.isArray(v)) return v[0]?.title ?? null;
        return v.title ?? null;
      };

      const [
        systemRes,
        examsRes,
        examPubRes,
        attemptsRes,
        aiRes,
        taskRes,
        blueprintRes,
        materialRes,
        recheckRes,
      ] = await Promise.allSettled([
        supabase
          .from("system_audit_logs")
          .select("id, action, entity_type, entity_name, created_at")
          .eq("actor_id", userId)
          .order("created_at", { ascending: false })
          .limit(25),
        supabase
          .from("exams")
          .select("id, title, created_at")
          .eq("created_by", userId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("exam_publication_logs")
          .select("id, action, created_at, exams(title)")
          .eq("actor_id", userId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("student_exam_attempts")
          .select("id, is_submitted, started_at, submitted_at, created_at, exams(title)")
          .eq("student_id", userId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("ai_daily_usage")
          .select("id, questions_generated, usage_date")
          .eq("user_id", userId)
          .gt("questions_generated", 0)
          .order("usage_date", { ascending: false })
          .limit(20),
        supabase
          .from("task_audit_logs")
          .select("id, action, created_at, tasks(title)")
          .eq("actor_id", userId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("evaluation_blueprints")
          .select("id, created_at, exams(title)")
          .eq("created_by", userId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("study_materials")
          .select("id, title, created_at")
          .eq("created_by", userId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("recheck_requests")
          .select("id, status, requested_at, resolved_at, resolved_by")
          .or(`requested_by.eq.${userId},resolved_by.eq.${userId}`)
          .order("requested_at", { ascending: false })
          .limit(20),
      ]);

      const events: ActivityRow[] = [];

      if (systemRes.status === "fulfilled" && systemRes.value.data) {
        for (const r of systemRes.value.data) {
          events.push({
            id: `sys-${r.id}`,
            action: r.action,
            entity_type: r.entity_type,
            entity_name: r.entity_name,
            created_at: r.created_at,
          });
        }
      }

      if (examsRes.status === "fulfilled" && examsRes.value.data) {
        for (const r of examsRes.value.data) {
          events.push({
            id: `exam-${r.id}`,
            action: "exam_created",
            entity_type: "Exam",
            entity_name: r.title,
            created_at: r.created_at,
          });
        }
      }

      if (examPubRes.status === "fulfilled" && examPubRes.value.data) {
        for (const r of examPubRes.value.data) {
          events.push({
            id: `pub-${r.id}`,
            action: `exam_${r.action}`,
            entity_type: "Exam",
            entity_name: pickTitle(r.exams as JoinedTitle),
            created_at: r.created_at,
          });
        }
      }

      if (attemptsRes.status === "fulfilled" && attemptsRes.value.data) {
        for (const r of attemptsRes.value.data) {
          const isSubmitted = Boolean(r.submitted_at);
          events.push({
            id: `att-${r.id}`,
            action: isSubmitted ? "exam_submitted" : "exam_started",
            entity_type: "Exam",
            entity_name: pickTitle(r.exams as JoinedTitle),
            created_at: r.submitted_at ?? r.started_at ?? r.created_at,
          });
        }
      }

      if (aiRes.status === "fulfilled" && aiRes.value.data) {
        for (const r of aiRes.value.data) {
          events.push({
            id: `ai-${r.id}`,
            action: "ai_questions_generated",
            entity_type: "AI",
            entity_name: `${r.questions_generated} question${r.questions_generated === 1 ? "" : "s"}`,
            created_at: new Date(`${r.usage_date}T00:00:00Z`).toISOString(),
          });
        }
      }

      if (taskRes.status === "fulfilled" && taskRes.value.data) {
        for (const r of taskRes.value.data) {
          events.push({
            id: `task-${r.id}`,
            action: `task_${r.action}`,
            entity_type: "Task",
            entity_name: pickTitle(r.tasks as JoinedTitle),
            created_at: r.created_at,
          });
        }
      }

      if (blueprintRes.status === "fulfilled" && blueprintRes.value.data) {
        for (const r of blueprintRes.value.data) {
          events.push({
            id: `bp-${r.id}`,
            action: "evaluation_blueprint_set",
            entity_type: "Exam",
            entity_name: pickTitle(r.exams as JoinedTitle),
            created_at: r.created_at,
          });
        }
      }

      if (materialRes.status === "fulfilled" && materialRes.value.data) {
        for (const r of materialRes.value.data) {
          events.push({
            id: `mat-${r.id}`,
            action: "study_material_uploaded",
            entity_type: "Material",
            entity_name: r.title,
            created_at: r.created_at,
          });
        }
      }

      if (recheckRes.status === "fulfilled" && recheckRes.value.data) {
        for (const r of recheckRes.value.data) {
          const isResolver = r.resolved_by === userId && r.resolved_at;
          events.push({
            id: `rc-${r.id}`,
            action: isResolver ? "recheck_resolved" : "recheck_requested",
            entity_type: "Recheck",
            entity_name: r.status,
            created_at: isResolver ? r.resolved_at! : r.requested_at,
          });
        }
      }

      return events
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 50);
    },
    enabled: !!userId && open,
  });

  const roleColors: Record<string, string> = {
    super_admin: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    school_admin: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    coordinator: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    teacher: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    student: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    employee: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  };

  const shortUserId = userId ? userId.substring(0, 8).toUpperCase() : "";
  const isStudent = user?.roles?.some((r: { role: string }) => r.role === "student") ?? false;

  // The student's own section, labelled the way the roll-number picker
  // labels it, so the hand-off lands on the same breadcrumb.
  const studentSection: RollNumberSheetSection | null = (() => {
    if (!isStudent || !user) return null;
    const row = user.classAssignments.find((ca) => ca.role === "student" && ca.class_id);
    const cls = pickOne(row?.classes as JoinedStudentClass | JoinedStudentClass[] | null | undefined);
    if (!row?.class_id || !cls?.class_group_id) return null;
    return {
      classGroupId: cls.class_group_id,
      classGroupName: pickOne(cls.class_groups)?.name ?? cls.name ?? "Class",
      classId: row.class_id,
      classLabel: cls.section ? `Section ${cls.section}` : (cls.name ?? "Section"),
    };
  })();

  const handleCopyId = () => {
    if (userId) {
      navigator.clipboard.writeText(userId);
      toast({ title: "User ID copied" });
    }
  };

  const getActionIcon = (action: string) => {
    if (action.includes("exam")) return <FileText className="h-3 w-3" />;
    if (action.includes("evaluation")) return <ClipboardCheck className="h-3 w-3" />;
    if (action.includes("ai") || action.includes("generate")) return <Sparkles className="h-3 w-3" />;
    return <Activity className="h-3 w-3" />;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>User Profile</SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : user ? (
          <div className="mt-6">
            {/* Profile Header */}
            <div className="flex items-center gap-4 mb-4">
              {canSetPhoto ? (
                <button
                  type="button"
                  onClick={() => setPhotoOpen(true)}
                  className="rounded-full ring-offset-2 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                  aria-label="Change profile photo"
                >
                  <UserAvatar
                    name={user.full_name}
                    email={user.email}
                    avatarPath={user.avatar_path}
                    className="h-16 w-16"
                    fallbackClassName="text-xl"
                  />
                </button>
              ) : (
                <UserAvatar
                  name={user.full_name}
                  email={user.email}
                  avatarPath={user.avatar_path}
                  className="h-16 w-16"
                  fallbackClassName="text-xl"
                />
              )}
              <div className="flex-1">
                <h2 className="text-xl font-semibold">{user.full_name || "Unnamed User"}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant={user.is_active ? "default" : "secondary"}>
                    {user.is_active ? "Active" : "Inactive"}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs font-mono text-muted-foreground"
                    onClick={handleCopyId}
                  >
                    ID: {shortUserId}
                    <Copy className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </div>
            </div>

            <Separator className="my-4" />


            {isStudent && (
              <Button
                className="w-full mb-4"
                onClick={() => {
                  onOpenChange(false);
                  navigate(`/school/student/${userId}`);
                }}
              >
                <BarChart3 className="mr-2 h-4 w-4" />
                Access Dashboard
              </Button>
            )}

            <Tabs defaultValue="overview" className="w-full">
              <TabsList className={`w-full grid ${isStudent ? "grid-cols-3" : "grid-cols-2"}`}>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
                {isStudent && <TabsTrigger value="subjects">Subjects</TabsTrigger>}
              </TabsList>

              <TabsContent value="overview" className="space-y-4 mt-4">
                {/* Student Details — view + (admin/coordinator) edit, with uniqueness validation */}
                {isStudent && (
                  <StudentDetailsCard
                    studentId={userId!}
                    canManage={canManageStudent}
                    fullName={user.full_name ?? null}
                    rollNumber={user.roll_number ?? null}
                    admissionNumber={user.admission_number ?? null}
                    phone={user.phone ?? null}
                    personalDetails={user.personalDetails ?? null}
                    onOpenBulkRollNumbers={
                      onUpdateRollNumbers
                        ? () => {
                            onOpenChange(false);
                            onUpdateRollNumbers(studentSection);
                          }
                        : undefined
                    }
                  />
                )}

                {/* Contact Info */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Contact Information</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-3 text-sm">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span>{user.email}</span>
                    </div>
                    {user.phone && (
                      <div className="flex items-center gap-3 text-sm">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <span>{user.phone}</span>
                      </div>
                    )}
                    {user.institutions && (
                      <div className="flex items-center gap-3 text-sm">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <span>{(user.institutions as { name: string }).name}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Roles */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Shield className="h-4 w-4" />
                      Roles
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {user.roles.map((r, i) => (
                        <Badge key={i} variant="outline" className={roleColors[r.role] || ""}>
                          {r.role.replace("_", " ")}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Class Assignments */}
                {user.classAssignments.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium">Class Assignments</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {Object.values(
                          user.classAssignments.reduce((
                            acc: Record<string, { className: string; subjects: string[] }>,
                            ca: {
                              classes?: { name?: string | null; section?: string | null } | null;
                              universal_subjects?: { name?: string | null } | null;
                            },
                          ) => {
                            const key = formatClassName(ca.classes?.name || "", ca.classes?.section ?? undefined);
                            if (!acc[key]) {
                              acc[key] = { className: key, subjects: [] };
                            }
                            if (ca.universal_subjects?.name) {
                              acc[key].subjects.push(ca.universal_subjects.name);
                            }
                            return acc;
                          }, {})
                        ).map((group, i: number) => (
                          <div key={i} className="flex items-center justify-between text-sm">
                            <span className="font-medium">{group.className}</span>
                            <div className="flex flex-wrap gap-1 justify-end">
                              {group.subjects.length > 0 ? (
                                group.subjects.map((subject: string, j: number) => (
                                  <Badge key={j} variant="secondary" className="text-xs">
                                    {subject}
                                  </Badge>
                                ))
                              ) : (
                                <span className="text-muted-foreground text-xs">No subjects</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Timestamps */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      Account Info
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Created</span>
                      <span>{user.created_at ? format(new Date(user.created_at), "PPp") : "N/A"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Last Updated</span>
                      <span>{user.updated_at ? format(new Date(user.updated_at), "PPp") : "N/A"}</span>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="activity" className="mt-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[400px]">
                      {activityLogs && activityLogs.length > 0 ? (
                        <div className="space-y-1 p-4">
                          {activityLogs.map((log) => (
                            <div
                              key={log.id}
                              className="flex items-start gap-3 py-2 text-sm border-b last:border-0"
                            >
                              <div className="mt-1 text-muted-foreground">
                                {getActionIcon(log.action)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium capitalize">
                                  {log.action.replace(/_/g, " ")}
                                </p>
                                {log.entity_name && (
                                  <p className="text-muted-foreground text-xs truncate">
                                    {log.entity_type}: {log.entity_name}
                                  </p>
                                )}
                                <p className="text-xs text-muted-foreground mt-1">
                                  {format(new Date(log.created_at), "PPp")}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-8 text-center text-muted-foreground">
                          No activity logs found
                        </div>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>

              {isStudent && (
                <TabsContent value="subjects" className="mt-4">
                  <StudentSubjectsTab studentId={userId!} institutionId={user.institution_id ?? null} />
                </TabsContent>
              )}
            </Tabs>
          </div>
        ) : (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            User not found
          </div>
        )}

        {user && userId ? (
          <UserPhotoSheet
            open={photoOpen}
            onOpenChange={setPhotoOpen}
            targetId={userId}
            targetName={user.full_name}
            targetEmail={user.email}
            institutionId={user.institution_id ?? null}
            currentPath={user.avatar_path}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}