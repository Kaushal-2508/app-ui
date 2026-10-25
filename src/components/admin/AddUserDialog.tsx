import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Plus, Copy, Check, X, UserCog, Building2, AlertTriangle } from "lucide-react";
import { useCreateUser } from "@/hooks/useAdminOperations";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEmployeeLevels } from "@/hooks/useEmployeeLevels";
import { useIsStaffManager } from "@/hooks/useIsStaffManager";
import { invalidateSchoolData } from "@/lib/queryKeys";
import { formatClassName } from "@/lib/utils";
import { sortClassRows } from "@/lib/classSort";
import { AddSubjectPopover } from "@/components/school/AddSubjectPopover";
import { PhoneInput } from "@/components/shared/PhoneInput";
import { normalizeIndianMobile, phoneToSave } from "@/lib/phone";

type UserRole = "super_school_admin" | "school_admin" | "principal" | "coordinator" | "teacher" | "student" | "employee";

interface ClassSubjectAssignment {
  id: string;
  classId: string;
  subjectId: string;
}

interface AddUserDialogProps {
  trigger?: React.ReactNode;
  defaultInstitutionId?: string;
  defaultRole?: UserRole;
  allowedRoles?: UserRole[];
  coordinatorClassIds?: string[]; // Restrict class options for coordinators/teachers
  defaultClassId?: string; // Pre-select a class (e.g., when adding from within a class view)
}

export function AddUserDialog({
  trigger,
  defaultInstitutionId,
  defaultRole,
  allowedRoles = ["super_school_admin", "school_admin", "principal", "coordinator", "teacher", "student", "employee"],
  coordinatorClassIds,
  defaultClassId
}: AddUserDialogProps) {
  const [open, setOpen] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string; role: string; userId?: string; emailSent?: boolean; emailError?: string; hasRealEmail?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState(defaultClassId || "");
  const [selectedEmployeeLevelId, setSelectedEmployeeLevelId] = useState("");
  const [makeCoordinator, setMakeCoordinator] = useState(false);
  const [classSubjectAssignments, setClassSubjectAssignments] = useState<ClassSubjectAssignment[]>([]);
  const [selectedWingIds, setSelectedWingIds] = useState<string[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: employeeLevels } = useEmployeeLevels();
  // Staff-manager-override holders may create TEACHER accounts but may not
  // grant roles — writing user_roles/wing_assignments is blocked by RLS for
  // them, so the "Make Coordinator" toggle is hidden rather than left to
  // fail mid-submit. Role holders (admin/coordinator) are unaffected.
  const { isStaffManager } = useIsStaffManager();
  const canPromoteToCoordinator = !isStaffManager;

  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    password: "",
    role: (defaultRole || "") as UserRole | "",
    institutionId: defaultInstitutionId || "",
    // Student-specific fields for admission number login
    phone: "",
    admissionNumber: "",
    rollNumber: "",
  });

  const { data: institutions } = useQuery({
    queryKey: ["institutions-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("institutions")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
  });

  // Fetch classes for assignment - filter by coordinatorClassIds if provided
  const { data: classes } = useQuery({
    queryKey: ["classes-for-institution", formData.institutionId, coordinatorClassIds],
    queryFn: async () => {
      if (!formData.institutionId) return [];
      
      // Presence of the prop is the scoping signal, not its length. `length > 0`
      // failed OPEN: a coordinator whose wing resolves to no classes fell
      // through to the whole institution's list (2026-09-18). Admins pass
      // undefined/null and are still unscoped.
      if (coordinatorClassIds) {
        if (coordinatorClassIds.length === 0) return [];
        const { data } = await supabase
          .from("classes")
          .select("id, name, section, academic_year")
          .in("id", coordinatorClassIds)
          .eq("is_active", true)
          .order("name");
        return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
      }

      // Admin - all classes
      const { data } = await supabase
        .from("classes")
        .select("id, name, section, academic_year")
        .eq("institution_id", formData.institutionId)
        .eq("is_active", true)
        .order("name");
      return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
    },
    enabled: (formData.role === "student" || formData.role === "teacher") && !!formData.institutionId,
  });

  // Fetch class-subject mappings for teacher assignment - organized by class
  const { data: classSubjectMappings } = useQuery({
    queryKey: ["class-subject-mappings", formData.institutionId],
    queryFn: async () => {
      if (!formData.institutionId) return new Map<string, Array<{id: string, name: string, code: string}>>();
      
      const { data: mappings } = await supabase
        .from("subject_class_mappings")
        .select(`
          class_id,
          subject_id,
          universal_subjects!inner(id, name, code, institution_id)
        `)
        .eq("institution_id", formData.institutionId);
      
      if (!mappings) return new Map<string, Array<{id: string, name: string, code: string, isGlobal: boolean}>>();
      
      // Organize by class_id for easy lookup
      const byClass = new Map<string, Array<{id: string, name: string, code: string, isGlobal: boolean}>>();
      
      type MappingRow = {
        class_id: string;
        subject_id: string;
        universal_subjects: {
          id: string;
          name: string;
          code: string;
          institution_id: string | null;
        } | null;
      };
      mappings.forEach((m: MappingRow) => {
        if (!m.universal_subjects) return;

        const classId = m.class_id;
        if (!byClass.has(classId)) {
          byClass.set(classId, []);
        }
        
        const subjects = byClass.get(classId)!;
        // Deduplicate by subject name (same subject can have different UUIDs per grade)
        const exists = subjects.some(s => s.name === m.universal_subjects.name);
        if (!exists) {
          subjects.push({
            id: m.subject_id,
            name: m.universal_subjects.name,
            code: m.universal_subjects.code,
            isGlobal: m.universal_subjects.institution_id === null
          });
        }
      });
      
      // Sort subjects in each class by name
      byClass.forEach((subjects) => {
        subjects.sort((a, b) => a.name.localeCompare(b.name));
      });
      
      return byClass;
    },
    enabled: formData.role === "teacher" && !!formData.institutionId,
  });

  // Helper function to get subjects for a specific class
  const getSubjectsForClass = (classId: string) => {
    if (!classSubjectMappings || !classId) return [];
    return classSubjectMappings.get(classId) || [];
  };

  // Fetch wings for coordinator assignment (for coordinator role OR teacher + makeCoordinator)
  const { data: wings } = useQuery({
    queryKey: ["wings-for-institution", formData.institutionId],
    queryFn: async () => {
      if (!formData.institutionId) return [];
      const { data } = await supabase
        .from("wings")
        .select("id, name")
        .eq("institution_id", formData.institutionId)
        .order("name");
      return data || [];
    },
    enabled: (formData.role === "coordinator" || (formData.role === "teacher" && makeCoordinator)) && !!formData.institutionId,
  });

  useEffect(() => {
    if (defaultInstitutionId) {
      setFormData((f) => ({ ...f, institutionId: defaultInstitutionId }));
    }
    if (defaultRole) {
      setFormData((f) => ({ ...f, role: defaultRole }));
    }
    if (defaultClassId) {
      setSelectedClassId(defaultClassId);
    }
  }, [defaultInstitutionId, defaultRole, defaultClassId]);

  // Reset selections when role changes
  useEffect(() => {
    if (formData.role !== "student") {
      setSelectedClassId(defaultClassId || "");
      // Reset student-specific fields
      setFormData(prev => ({
        ...prev,
        phone: "",
        admissionNumber: "",
        rollNumber: "",
      }));
    }
    if (formData.role !== "employee") {
      setSelectedEmployeeLevelId("");
    }
    if (formData.role !== "teacher") {
      setClassSubjectAssignments([]);
      setMakeCoordinator(false);
      // Also reset wing IDs when role changes from teacher
    }
    if (formData.role !== "coordinator" && formData.role !== "teacher") {
      setSelectedWingIds([]);
    }
  }, [formData.role]);

  const createUser = useCreateUser();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // CRITICAL: Role must be explicitly selected - no defaults
    if (!formData.role) {
      toast({
        title: "Role required",
        description: "You must explicitly select a role for this user",
        variant: "destructive",
      });
      return;
    }
    
    if (!formData.institutionId) {
      toast({
        title: "Institution required",
        description: "You must select an institution",
        variant: "destructive",
      });
      return;
    }
    
    // Email is required for every role except student (students can log in via
    // admission number or phone — see resolve-login-identifier).
    const isStudent = formData.role === "student";
    if (!formData.fullName || !formData.password || (!isStudent && !formData.email)) {
      toast({
        title: "Missing fields",
        description: isStudent
          ? "Full name and password are required"
          : "Please fill in name, email and password",
        variant: "destructive",
      });
      return;
    }

    if (formData.password.length < 6) {
      toast({
        title: "Password too short",
        description: "Password must be at least 6 characters",
        variant: "destructive",
      });
      return;
    }

    // Admission number is mandatory for every student (regardless of who is creating them).
    if (isStudent && !formData.admissionNumber.trim()) {
      toast({
        title: "Admission number required",
        description: "Please enter the student's admission number",
        variant: "destructive",
      });
      return;
    }

    // A phone is optional, but when given it must be a whole mobile number:
    // the login resolver matches exactly 10 digits, so a 7-digit one would be
    // stored and never match (Task 21).
    if (isStudent && formData.phone.trim()) {
      const phoneCheck = phoneToSave(formData.phone, null);
      if (phoneCheck.ok === false) {
        toast({ title: "Check the phone number", description: phoneCheck.message, variant: "destructive" });
        return;
      }
    }

    // Teachers/coordinators adding a student must also pick a class.
    if (isStudent && coordinatorClassIds && !selectedClassId) {
      toast({
        title: "Class required",
        description: "Please select a class for this student",
        variant: "destructive",
      });
      return;
    }

    try {
      // Use the role as-is for the API, which handles principal as school_admin variant
      const effectiveRole = formData.role === "principal" ? "school_admin" : formData.role;

      // Students can be created without an email. Supabase Auth still requires
      // some email to create the auth record, so synthesise a placeholder from
      // the admission number (matches the existing BulkUploadStudentsDialog
      // convention). The `skipWelcomeEmail` flag tells the edge function to
      // suppress the Resend welcome mail when no real inbox exists.
      const trimmedEmail = formData.email.trim();
      const hasRealEmail = trimmedEmail.length > 0;
      const emailToSubmit =
        hasRealEmail
          ? trimmedEmail
          : `${formData.admissionNumber.trim().replace(/\s+/g, "").toLowerCase()}@temp.local`;

      const result = await createUser.mutateAsync({
        fullName: formData.fullName,
        email: emailToSubmit,
        password: formData.password,
        role: effectiveRole as "super_school_admin" | "school_admin" | "coordinator" | "teacher" | "student" | "employee",
        institutionId: formData.institutionId,
        // Pass student-specific fields for admission number login
        // The field hands back bare digits; send the 10 of them or nothing.
        phone: isStudent && formData.phone.trim() ? normalizeIndianMobile(formData.phone).digits : undefined,
        admissionNumber: isStudent ? formData.admissionNumber || undefined : undefined,
        rollNumber: isStudent ? formData.rollNumber || undefined : undefined,
        // Pass classId so the edge function handles class assignment server-side
        classId: isStudent && selectedClassId ? selectedClassId : undefined,
        // Skip welcome email when the user didn't provide a real address.
        skipWelcomeEmail: !hasRealEmail,
      });

      // If teacher with class-subject assignments
      if (formData.role === "teacher" && result.userId) {
        // Add class-subject assignments
        if (classSubjectAssignments.length > 0) {
          const assignments = classSubjectAssignments.map(a => ({
            user_id: result.userId,
            class_id: a.classId,
            subject_id: a.subjectId,
            role: "teacher" as const,
          }));
          
          const { error: assignError } = await supabase.from("class_assignments").insert(assignments);
          
          if (assignError) {
            console.error("Failed to save class assignments:", assignError);
            toast({
              title: "Warning",
              description: "User created but class assignments failed to save. Please assign manually.",
              variant: "destructive",
            });
          }
        }

        // If makeCoordinator is checked, also add coordinator role and wing assignments
        if (makeCoordinator) {
          await supabase.from("user_roles").insert({
            user_id: result.userId,
            role: "coordinator",
            institution_id: formData.institutionId,
          });

          // Also add wing assignments for teacher-coordinator
          if (selectedWingIds.length > 0) {
            const wingAssignments = selectedWingIds.map(wingId => ({
              user_id: result.userId,
              wing_id: wingId,
            }));
            await supabase.from("wing_assignments").insert(wingAssignments);
          }
        }
      }

      // If coordinator with wing assignments
      if (formData.role === "coordinator" && result.userId && selectedWingIds.length > 0) {
        const wingAssignments = selectedWingIds.map(wingId => ({
          user_id: result.userId,
          wing_id: wingId,
        }));
        await supabase.from("wing_assignments").insert(wingAssignments);
      }

      // Use centralized invalidation for consistent refresh across all user types
      invalidateSchoolData(queryClient, formData.institutionId);
      queryClient.invalidateQueries({ queryKey: ["users"] });

      // Invalidate teacher-specific queries so student lists refresh
      if (coordinatorClassIds) {
        queryClient.invalidateQueries({ queryKey: ["teacher-class-students"] });
        queryClient.invalidateQueries({ queryKey: ["teacher-assigned-classes"] });
      }

      setCreatedCredentials({
        email: result.email,
        password: result.password,
        role: result.role + (makeCoordinator ? " + Coordinator" : ""),
        userId: result.userId,
        emailSent: result.emailSent,
        emailError: result.emailError,
        hasRealEmail,
      });
    } catch (error) {
      // Error handled in hook
    }
  };

  const addClassSubjectAssignment = () => {
    setClassSubjectAssignments(prev => [
      ...prev, 
      { id: crypto.randomUUID(), classId: "", subjectId: "" }
    ]);
  };

  const updateAssignment = (id: string, field: "classId" | "subjectId", value: string) => {
    setClassSubjectAssignments(prev => 
      prev.map(a => {
        if (a.id !== id) return a;
        // If class changes, clear the subject selection
        if (field === "classId") {
          return { ...a, classId: value, subjectId: "" };
        }
        return { ...a, [field]: value };
      })
    );
  };

  const removeAssignment = (id: string) => {
    setClassSubjectAssignments(prev => prev.filter(a => a.id !== id));
  };

  const handleCopy = () => {
    if (createdCredentials) {
      const lines = [
        createdCredentials.hasRealEmail
          ? `Email: ${createdCredentials.email}`
          : null,
        `Password: ${createdCredentials.password}`,
        `Role: ${createdCredentials.role}`,
      ].filter(Boolean);
      navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: "Copied",
        description: "Credentials copied to clipboard",
      });
    }
  };

  const handleClose = () => {
    setOpen(false);
    setCreatedCredentials(null);
    setSelectedClassId(defaultClassId || "");
    setSelectedEmployeeLevelId("");
    setMakeCoordinator(false);
    setClassSubjectAssignments([]);
    setSelectedWingIds([]);
    setFormData({
      fullName: "",
      email: "",
      password: "",
      role: defaultRole || "",
      institutionId: defaultInstitutionId || "",
      phone: "",
      admissionNumber: "",
      rollNumber: "",
    });
  };

  const roleLabels: Record<UserRole, string> = {
    super_school_admin: "Super School Admin (Owner)",
    school_admin: "School Admin",
    principal: "Principal",
    coordinator: "Coordinator",
    teacher: "Teacher",
    student: "Student",
    employee: "Employee",
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[550px]">
        {!createdCredentials ? (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Add New User</DialogTitle>
              <DialogDescription>
                Create a new user account with a specific role
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="fullName">Full Name *</Label>
                <Input
                  id="fullName"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  placeholder="John Smith"
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="email">
                  Email{formData.role === "student" ? "" : " *"}
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder={formData.role === "student" ? "Optional: leave blank if not available" : "john@school.edu"}
                  required={formData.role !== "student"}
                />
                {formData.role === "student" && (
                  <p className="text-xs text-muted-foreground">
                    Optional for students. Welcome email is only sent when an address is provided.
                  </p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="password">Password *</Label>
                <PasswordInput
                  id="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Enter password (min 6 characters)"
                  required
                  minLength={6}
                />
              </div>

              {/* Only show role selector if more than one role allowed or no default */}
              {(allowedRoles.length > 1 || !defaultRole) && (
                <div className="grid gap-2">
                  <Label htmlFor="role">Role *</Label>
                  <SearchableSelect
                    value={formData.role}
                    onValueChange={(value) => 
                      setFormData({ ...formData, role: value as UserRole })
                    }
                    disabled={allowedRoles.length === 1}
                    placeholder="Select role"
                    searchPlaceholder="Search roles..."
                    options={allowedRoles.map((role) => ({
                      value: role,
                      label: roleLabels[role],
                    }))}
                  />
                </div>
              )}

              {/* Only show institution selector if not pre-set */}
              {!defaultInstitutionId && (
                <div className="grid gap-2">
                  <Label htmlFor="institution">Institution *</Label>
                  <SearchableSelect
                    value={formData.institutionId}
                    onValueChange={(value) => setFormData({ ...formData, institutionId: value })}
                    placeholder="Select institution"
                    searchPlaceholder="Search institutions..."
                    options={institutions?.map((inst) => ({
                      value: inst.id,
                      label: `${inst.name} (${inst.code})`,
                    })) || []}
                  />
                </div>
              )}

              {/* Show class-subject assignments for teachers */}
              {formData.role === "teacher" && formData.institutionId && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Class & Subject Assignments</Label>
                    <Button type="button" variant="outline" size="sm" onClick={addClassSubjectAssignment}>
                      <Plus className="h-3 w-3 mr-1" />
                      Add
                    </Button>
                  </div>
                  
                  {classSubjectAssignments.length === 0 ? (
                    <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <AlertDescription className="text-amber-800 dark:text-amber-200">
                        <strong>Recommended:</strong> Assign this teacher to at least one class and subject 
                        so they can create exams and manage students. You can also do this later.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {classSubjectAssignments.map((assignment) => (
                        <div key={assignment.id} className="flex gap-2 items-center">
                          <SearchableSelect
                            value={assignment.classId}
                            onValueChange={(v) => updateAssignment(assignment.id, "classId", v)}
                            placeholder="Class"
                            searchPlaceholder="Search..."
                            className="flex-1"
                            options={classes?.map(c => ({
                              value: c.id,
                              label: formatClassName(c.name, c.section),
                            })) || []}
                          />
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="flex-1">
                                <SearchableSelect
                                  value={assignment.subjectId}
                                  onValueChange={(v) => updateAssignment(assignment.id, "subjectId", v)}
                                  placeholder={assignment.classId ? "Subject" : "Select class first"}
                                  searchPlaceholder="Search..."
                                  disabled={!assignment.classId}
                                  options={getSubjectsForClass(assignment.classId).map(s => ({
                                    value: s.id,
                                    label: s.name,
                                  }))}
                                />
                              </div>
                              {assignment.classId && formData.institutionId && (
                                <AddSubjectPopover
                                  classId={assignment.classId}
                                  institutionId={formData.institutionId}
                                  onCreated={(subjectId) =>
                                    updateAssignment(assignment.id, "subjectId", subjectId)
                                  }
                                  triggerClassName="h-8 w-8 p-0 shrink-0 hover:bg-primary/10"
                                  align="end"
                                  side="bottom"
                                />
                              )}
                            </div>
                            {assignment.classId && getSubjectsForClass(assignment.classId).length === 0 && (
                              <p className="text-xs text-amber-600">
                                No subjects mapped yet. Use the <strong>+</strong> to add one.
                              </p>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() => removeAssignment(assignment.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Make Coordinator Toggle — hidden for staff-manager
                      override holders, who cannot grant roles (see
                      canPromoteToCoordinator). */}
                  {canPromoteToCoordinator && (
                  <div className="flex items-center justify-between py-2 px-3 border rounded-lg bg-muted/30">
                    <div className="flex items-center gap-2">
                      <UserCog className="h-4 w-4 text-purple-500" />
                      <div>
                        <Label htmlFor="make-coordinator" className="text-sm font-medium">
                          Make Coordinator
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Grant coordinator permissions
                        </p>
                      </div>
                    </div>
                    <Switch
                      id="make-coordinator"
                      checked={makeCoordinator}
                      onCheckedChange={setMakeCoordinator}
                    />
                  </div>
                  )}
                  {makeCoordinator && (
                    <div className="space-y-2">
                      <Badge variant="secondary" className="w-full justify-center">
                        <UserCog className="h-3 w-3 mr-1" />
                        Will also receive Coordinator role
                      </Badge>
                      
                      {/* Wing selection for teacher-coordinator */}
                      <div className="border rounded-lg p-3 bg-purple-50/50 dark:bg-purple-950/20 space-y-2">
                        <div className="flex items-center gap-2 text-sm font-medium text-purple-700 dark:text-purple-300">
                          <Building2 className="h-4 w-4" />
                          <span>Assign to Wing(s)</span>
                        </div>
                        {wings && wings.length > 0 ? (
                          <div className="space-y-2 max-h-28 overflow-y-auto">
                            {wings.map((wing) => (
                              <div key={wing.id} className="flex items-center gap-2">
                                <Checkbox
                                  id={`teacher-wing-${wing.id}`}
                                  checked={selectedWingIds.includes(wing.id)}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      setSelectedWingIds(prev => [...prev, wing.id]);
                                    } else {
                                      setSelectedWingIds(prev => prev.filter(id => id !== wing.id));
                                    }
                                  }}
                                />
                                <Label htmlFor={`teacher-wing-${wing.id}`} className="text-sm font-normal cursor-pointer">
                                  {wing.name}
                                </Label>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground italic">
                            No wings created yet. Wings can be created later.
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Coordinators can only see classes within their assigned wings
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Show wing selector for coordinators */}
              {formData.role === "coordinator" && formData.institutionId && (
                <div className="grid gap-2">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <Label>Assign to Wing(s)</Label>
                  </div>
                  {wings && wings.length > 0 ? (
                    <div className="space-y-2 border rounded-lg p-3 max-h-32 overflow-y-auto">
                      {wings.map((wing) => (
                        <div key={wing.id} className="flex items-center gap-2">
                          <Checkbox
                            id={`wing-${wing.id}`}
                            checked={selectedWingIds.includes(wing.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedWingIds(prev => [...prev, wing.id]);
                              } else {
                                setSelectedWingIds(prev => prev.filter(id => id !== wing.id));
                              }
                            }}
                          />
                          <Label htmlFor={`wing-${wing.id}`} className="text-sm font-normal cursor-pointer">
                            {wing.name}
                          </Label>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      No wings created for this institution yet
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Coordinators can only see classes within their assigned wings
                  </p>
                </div>
              )}

              {/* Show student-specific fields */}
              {formData.role === "student" && formData.institutionId && (
                <div className="space-y-4">
                  {/* Class Selector - shown first so it's immediately visible */}
                  <div className="grid gap-2">
                    <Label htmlFor="class">Assign to Class {coordinatorClassIds ? "*" : ""}</Label>
                    <SearchableSelect
                      value={selectedClassId}
                      onValueChange={setSelectedClassId}
                      placeholder={coordinatorClassIds ? "Select class" : "Select class (optional)"}
                      searchPlaceholder="Search classes..."
                      options={classes?.map((cls) => ({
                        value: cls.id,
                        label: `${formatClassName(cls.name, cls.section)} (${cls.academic_year})`,
                      })) || []}
                    />
                    <p className="text-xs text-muted-foreground">
                      Students need class assignment to access exams
                    </p>
                  </div>

                  {/* Admission Number - for login (mandatory for every student) */}
                  <div className="grid gap-2">
                    <Label htmlFor="admissionNumber">Admission Number *</Label>
                    <Input
                      id="admissionNumber"
                      value={formData.admissionNumber}
                      onChange={(e) => setFormData({ ...formData, admissionNumber: e.target.value })}
                      placeholder="e.g., ADM0022"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Students log in using this admission number
                    </p>
                  </div>

                  {/* Phone Number - for login */}
                  <div className="grid gap-2">
                    <Label htmlFor="phone">Phone Number</Label>
                    <PhoneInput
                      id="phone"
                      value={formData.phone}
                      onChange={(phone) => setFormData({ ...formData, phone })}
                    />
                    <p className="text-xs text-muted-foreground">
                      10-digit mobile number for alternative login
                    </p>
                  </div>

                  {/* Roll Number */}
                  <div className="grid gap-2">
                    <Label htmlFor="rollNumber">Roll Number</Label>
                    <Input
                      id="rollNumber"
                      value={formData.rollNumber}
                      onChange={(e) => setFormData({ ...formData, rollNumber: e.target.value })}
                      placeholder="e.g., 22"
                    />
                  </div>
                </div>
              )}

              {/* Show employee level selector for employees */}
              {formData.role === "employee" && (
                <div className="grid gap-2">
                  <Label htmlFor="employeeLevel">Employee Level</Label>
                  <SearchableSelect
                    value={selectedEmployeeLevelId}
                    onValueChange={setSelectedEmployeeLevelId}
                    placeholder="Select level (optional)"
                    searchPlaceholder="Search levels..."
                    options={employeeLevels?.map((level) => ({
                      value: level.id,
                      label: `${level.level_name} (Level ${level.level_number})`,
                    })) || []}
                  />
                  <p className="text-xs text-muted-foreground">
                    Assign permission level to this employee
                  </p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={createUser.isPending}>
                {createUser.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create User
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-green-600">User Created!</DialogTitle>
              <DialogDescription>
                {createdCredentials.emailSent
                  ? "A welcome email with login credentials has been sent to the user."
                  : !createdCredentials.hasRealEmail
                    ? "No email was provided. Share these credentials manually. The student can log in using their admission number."
                    : "Save these credentials - the password cannot be recovered later"}
              </DialogDescription>
            </DialogHeader>

            <div className="py-4">
              {/* Email Status Banner */}
              {createdCredentials.emailSent ? (
                <Alert className="mb-4 border-green-200 bg-green-50">
                  <Check className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-800">
                    Welcome email sent successfully to {createdCredentials.email}
                  </AlertDescription>
                </Alert>
              ) : !createdCredentials.hasRealEmail ? (
                <Alert className="mb-4 border-blue-200 bg-blue-50">
                  <AlertTriangle className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-blue-800">
                    No email provided. Welcome email was not sent. Share these credentials manually.
                  </AlertDescription>
                </Alert>
              ) : createdCredentials.emailError ? (
                <Alert className="mb-4 border-amber-200 bg-amber-50">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-amber-800">
                    Welcome email could not be sent. Please share credentials manually.
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="bg-muted rounded-lg p-4 space-y-2">
                {createdCredentials.hasRealEmail && (
                  <div>
                    <span className="text-sm text-muted-foreground">Email:</span>
                    <p className="font-mono">{createdCredentials.email}</p>
                  </div>
                )}
                <div>
                  <span className="text-sm text-muted-foreground">Password:</span>
                  <p className="font-mono">{createdCredentials.password}</p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">Role:</span>
                  <p className="font-medium capitalize">{createdCredentials.role.replace("_", " ")}</p>
                </div>
              </div>
              <Button variant="outline" className="mt-4 w-full" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                {copied ? "Copied!" : "Copy Credentials"}
              </Button>
            </div>

            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
