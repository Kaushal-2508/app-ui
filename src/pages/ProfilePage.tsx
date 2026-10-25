import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect } from "react";
import { Loader2, Mail, User, Building2, BookOpen, GraduationCap, Calendar, Layers, IdCard } from "lucide-react";
import { useProfileData, useUpdateProfile } from "@/hooks/useProfileData";
import { useStudentPersonalDetails } from "@/hooks/useStudentPersonalDetails";
import { formatClassName } from "@/lib/utils";
import { format } from "date-fns";
import { UserAvatar, UserPhotoSheet } from "@/components/shared";
import { PhoneInput } from "@/components/shared/PhoneInput";
import { useCanSetUserPhoto } from "@/hooks/useSetUserAvatar";
import { phoneToSave } from "@/lib/phone";
import { toastError } from "@/lib/toast";

export default function ProfilePage() {
  const { data: profile, isLoading } = useProfileData();
  const updateProfile = useUpdateProfile();
  const { data: personalDetails } = useStudentPersonalDetails();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [photoOpen, setPhotoOpen] = useState(false);
  const { data: canSetPhoto } = useCanSetUserPhoto(profile?.id);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || "");
      setPhone(profile.phone || "");
    }
  }, [profile]);

  const getRoleLabel = (role: string) => {
    const roleLabels: Record<string, string> = {
      super_admin: "Super Admin",
      school_admin: "School Admin",
      coordinator: "Coordinator",
      teacher: "Teacher",
      student: "Student",
      employee: "Employee",
    };
    return roleLabels[role] || role;
  };

  const getPrimaryRole = () => {
    if (!profile?.roles.length) return null;
    const priority = ["super_admin", "super_school_admin", "school_admin", "coordinator", "teacher", "employee", "student"];
    for (const role of priority) {
      if (profile.roles.some(r => r.role === role)) {
        return role;
      }
    }
    return profile.roles[0]?.role;
  };

  const handleSave = async () => {
    // Untouched phone: saved back exactly as stored. Edited: 10 digits or a
    // message (Task 21).
    const check = phoneToSave(phone, profile?.phone);
    // `=== false`, not `!check.ok`: this project compiles without
    // strictNullChecks, and truthiness does not narrow the union there.
    if (check.ok === false) {
      toastError(new Error(check.message), { fallback: check.message, context: "profilePhone" });
      return;
    }
    try {
      await updateProfile.mutateAsync({ full_name: fullName, phone: check.value ?? "" });
    } catch {
      // useUpdateProfile's onError has already shown the reason. Without this
      // catch the rejection also reached App's unhandledrejection handler,
      // whose generic "An unexpected error occurred" toast covered it.
    }
  };

  const isTeacher = profile?.roles.some(r => r.role === "teacher");
  const isStudent = profile?.roles.some(r => r.role === "student");
  const isCoordinator = profile?.roles.some(r => r.role === "coordinator");
  
  // Get teacher assignments (class + subject pairs)
  const teacherAssignments = profile?.classAssignments.filter(ca => ca.role === "teacher") || [];
  
  // Group by class for better display
  const classGroupedAssignments = teacherAssignments.reduce((acc, ca) => {
    const classKey = ca.class_id;
    if (!acc[classKey]) {
      acc[classKey] = {
        class_name: ca.class_name,
        class_section: ca.class_section,
        subjects: [],
      };
    }
    if (ca.subject_name) {
      acc[classKey].subjects.push(ca.subject_name);
    }
    return acc;
  }, {} as Record<string, { class_name: string; class_section: string | null; subjects: string[] }>);

  if (isLoading) {
    return <ProfileSkeleton />;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="text-muted-foreground">Manage your account information</p>
      </div>

      {/* Profile Header Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            {canSetPhoto ? (
              <button
                type="button"
                onClick={() => setPhotoOpen(true)}
                className="rounded-full ring-offset-2 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                aria-label="Change your profile photo"
              >
                <UserAvatar
                  name={profile?.full_name}
                  email={profile?.email}
                  avatarPath={profile?.avatar_path}
                  className="h-20 w-20"
                  fallbackClassName="bg-primary text-primary-foreground text-2xl"
                />
              </button>
            ) : (
              <UserAvatar
                name={profile?.full_name}
                email={profile?.email}
                avatarPath={profile?.avatar_path}
                className="h-20 w-20"
                fallbackClassName="bg-primary text-primary-foreground text-2xl"
              />
            )}
            <div>
              <CardTitle>{fullName || profile?.email}</CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-2 mt-2">
                {profile?.roles.map((r, i) => (
                  <Badge key={i} variant={r.role === getPrimaryRole() ? "default" : "outline"}>
                    {getRoleLabel(r.role)}
                  </Badge>
                ))}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Personal Information Card */}
      <Card>
        <CardHeader>
          <CardTitle>Personal Information</CardTitle>
          {/* A PostgREST update blocked by RLS returns success-shaped output, so
              leaving this editable for students would show a green "Profile
              updated successfully" over a write that never happened. */}
          <CardDescription>
            {isStudent ? "Managed by your school" : "Update your personal details"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  disabled={isStudent}
                  className="pl-9"
                  placeholder="Enter your full name"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <PhoneInput id="phone" value={phone} onChange={setPhone} disabled={isStudent} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="email"
                value={profile?.email || ""}
                disabled
                className="pl-9 bg-muted"
              />
            </div>
            <p className="text-xs text-muted-foreground">Email cannot be changed</p>
          </div>

          {!isStudent && (
            <Button onClick={handleSave} disabled={updateProfile.isPending}>
              {updateProfile.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Institution Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Institution
          </CardTitle>
        </CardHeader>
        <CardContent>
          {profile?.institution ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{profile.institution.name}</span>
                <Badge variant="outline">{profile.institution.code}</Badge>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">No institution assigned</p>
          )}
        </CardContent>
      </Card>

      {/* Teacher Assignments Card */}
      {isTeacher && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5" />
              Teaching Assignments
            </CardTitle>
            <CardDescription>Your class and subject assignments</CardDescription>
          </CardHeader>
          <CardContent>
            {Object.keys(classGroupedAssignments).length > 0 ? (
              <div className="space-y-3">
                {Object.values(classGroupedAssignments).map((classInfo, i) => (
                  <div key={i} className="flex items-start justify-between p-3 rounded-lg border bg-muted/30">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-md bg-primary/10">
                        <Layers className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">
                          {formatClassName(classInfo.class_name, classInfo.class_section)}
                        </p>
                        {classInfo.subjects.length > 0 ? (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {classInfo.subjects.map((subject, j) => (
                              <Badge key={j} variant="secondary" className="text-xs">
                                {subject}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">All subjects</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No classes assigned yet</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Student Class Card */}
      {isStudent && profile?.studentClass && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Your Class
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-primary/10">
                  <Layers className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium">
                    {formatClassName(profile.studentClass.name, profile.studentClass.section)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {profile.studentClass.academic_year}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Personal & Guardian Details (students) */}
      {isStudent && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IdCard className="h-5 w-5" />
              Personal & Guardian Details
            </CardTitle>
            <CardDescription>Managed by your school</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <DetailRow
              label="Date of birth"
              value={
                personalDetails?.date_of_birth
                  ? format(new Date(`${personalDetails.date_of_birth}T00:00:00`), "MMMM d, yyyy")
                  : "N/A"
              }
            />
            <Separator />
            <DetailRow label="Admission no." value={profile?.admission_number || "N/A"} />
            <Separator />
            <DetailRow label="Roll no." value={profile?.roll_number || "N/A"} />
            <Separator />
            <DetailRow label="Guardian name" value={personalDetails?.guardian_name || "N/A"} />
            <Separator />
            <DetailRow label="Guardian phone" value={personalDetails?.guardian_phone || "N/A"} />
            <Separator />
            <DetailRow label="Guardian email" value={personalDetails?.guardian_email || "N/A"} />
          </CardContent>
        </Card>
      )}

      {/* Account Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Account Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Member Since</span>
            <span>{profile?.created_at ? format(new Date(profile.created_at), "MMMM d, yyyy") : "N/A"}</span>
          </div>
          <Separator />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Account Status</span>
            <Badge variant={profile?.is_active ? "default" : "secondary"}>
              {profile?.is_active ? "Active" : "Inactive"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {profile?.id ? (
        <UserPhotoSheet
          open={photoOpen}
          onOpenChange={setPhotoOpen}
          targetId={profile.id}
          targetName={profile.full_name}
          targetEmail={profile.email}
          institutionId={profile.institution_id ?? null}
          currentPath={profile.avatar_path}
        />
      ) : null}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-64 mt-2" />
      </div>
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
