import { useState } from "react";

import { DashboardSection } from "@/components/ui/dashboard-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MobileTabs } from "@/components/shared/nav";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUserRole } from "@/hooks/useUserRole";
import { useWings, useCreateWing, useUpdateWing, useDeleteWing, useWingAssignments, useAssignUserToWing, useRemoveUserFromWing, WingWithAssignments } from "@/hooks/useWings";
import { useWingClasses, useBulkAssignClassesToWing, useRemoveClassFromWing } from "@/hooks/useWingClasses";
import { useClasses } from "@/hooks/useClasses";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Building, Plus, Pencil, Trash2, Users, UserPlus, X, GraduationCap, BookOpen, ChevronRight, Layers, AlertTriangle } from "lucide-react";
import { cn, formatClassName } from "@/lib/utils";
import { ClayPebble, ClayStatTile, EmptyState } from "@/components/shared/surfaces";
import type { Tone } from "@/components/shared/design-system";
import { formatNumber } from "@/lib/formatNumber";
import { getDisplayName, getProfileEmail } from "@/lib/displayName";

// PostgREST to-one joins come back typed `T | T[] | null` on some relationships.
// Narrow to the single row (CLAUDE.md section 5a) instead of casting to any.
const pickOne = <T,>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

type WingSheetTab = "classes" | "students" | "teachers" | "coordinators";

/** Each wing card takes the next tone, so a row of wings is not a row of one colour. */
const WING_TONES: Tone[] = ["violet", "teal", "mint", "peach", "sky", "rose"];


export default function WingsPage() {
  const { data: roleInfo } = useUserRole();
  const institutionId = roleInfo?.institutionId || null;
  
  const { data: wings = [], isLoading, error: wingsError } = useWings(institutionId);
  const { data: allClasses = [] } = useClasses(institutionId);
  const createWing = useCreateWing();
  const updateWing = useUpdateWing();
  const deleteWing = useDeleteWing();
  const assignUser = useAssignUserToWing();
  const removeUser = useRemoveUserFromWing();
  const assignClasses = useBulkAssignClassesToWing();
  const removeClass = useRemoveClassFromWing();


  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingWing, setEditingWing] = useState<WingWithAssignments | null>(null);
  const [selectedWing, setSelectedWing] = useState<WingWithAssignments | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [memberTab, setMemberTab] = useState<WingSheetTab>("classes");
  
  const [formData, setFormData] = useState({
    name: "",
    description: "",
  });

  const { data: wingAssignments = [] } = useWingAssignments(selectedWing?.id || null);
  const { data: wingClasses = [] } = useWingClasses(selectedWing?.id || null);

  // Get available users (teachers/coordinators) for assignment
  const { data: availableUsers = [] } = useQuery({
    queryKey: ["institution-staff", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("institution_id", institutionId)
        .order("full_name");
      if (error) throw error;
      return data;
    },
    enabled: !!institutionId,
  });

  const resetForm = () => {
    setFormData({ name: "", description: "" });
    setEditingWing(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const openEditDialog = (wing: WingWithAssignments) => {
    setEditingWing(wing);
    setFormData({
      name: wing.name,
      description: wing.description || "",
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!institutionId) return;
    
    if (editingWing) {
      await updateWing.mutateAsync({
        id: editingWing.id,
        name: formData.name,
        description: formData.description || null,
      });
    } else {
      await createWing.mutateAsync({
        institution_id: institutionId,
        name: formData.name,
        description: formData.description,
        display_order: wings.length,
      });
    }
    setIsDialogOpen(false);
    resetForm();
  };


  const handleDelete = async (id: string) => {
    await deleteWing.mutateAsync(id);
  };

  const handleAssignUser = async () => {
    if (!selectedWing || !selectedUserId) return;
    await assignUser.mutateAsync({ wingId: selectedWing.id, userId: selectedUserId });
    setSelectedUserId("");
  };

  const handleRemoveUser = async (userId: string) => {
    if (!selectedWing) return;
    await removeUser.mutateAsync({ wingId: selectedWing.id, userId });
  };

  // Filter out already assigned users and classes
  const assignedUserIds = new Set(wingAssignments.map(a => a.user_id));
  const unassignedUsers = availableUsers.filter(u => !assignedUserIds.has(u.id));
  
  const assignedClassIds = new Set(wingClasses.map(wc => wc.class_id));
  const unassignedClasses = allClasses.filter(c => !assignedClassIds.has(c.id));

  const handleAssignClasses = async () => {
    if (!selectedWing || selectedClassIds.length === 0) return;
    await assignClasses.mutateAsync({ wingId: selectedWing.id, classIds: selectedClassIds });
    setSelectedClassIds([]);
  };

  const handleRemoveClass = async (classId: string) => {
    if (!selectedWing) return;
    await removeClass.mutateAsync({ wingId: selectedWing.id, classId });
  };

  const toggleClassSelection = (classId: string) => {
    setSelectedClassIds(prev => 
      prev.includes(classId) 
        ? prev.filter(id => id !== classId)
        : [...prev, classId]
    );
  };

  const coveredClassIds = new Set(wings.flatMap((w) => w.class_ids));
  const unassignedClassCount = allClasses.filter((c) => !coveredClassIds.has(c.id)).length;

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-violet-400 to-purple-500 text-white shadow-sm">
                <Building className="h-4 w-4" />
              </div>
              Wings / Departments
            </h1>
            <p className="text-muted-foreground">
              Organize staff into wings like Primary, Secondary, etc.
            </p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog}>
                <Plus className="h-4 w-4 mr-2" />
                Add Wing
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingWing ? "Edit Wing" : "Create Wing"}</DialogTitle>
                <DialogDescription>
                  {editingWing ? "Update wing details" : "Create a new wing/department"}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Wing Name</Label>
                  <Input
                    placeholder="e.g., Primary Wing, Science Department"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    placeholder="Describe this wing..."
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button 
                  onClick={handleSubmit}
                  disabled={!formData.name || createWing.isPending || updateWing.isPending}
                >
                  {editingWing ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* The school at a glance: how many wings, their coordinators, and the
            classes no wing covers (a coordinator is wing-scoped, so an
            uncovered class is invisible to every coordinator). */}
        {!isLoading && !wingsError && wings.length > 0 && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 sm:gap-4">
            <ClayStatTile label="Wings" value={formatNumber(wings.length)} icon={<Building />} tone="violet" />
            <ClayStatTile label="Coordinators" value={formatNumber(wings.reduce((n, w) => n + w.assigned_users, 0))} icon={<Users />} tone="teal" />
            <ClayStatTile label="Classes in wings" value={formatNumber(coveredClassIds.size)} icon={<Layers />} tone="mint" />
            <ClayStatTile label="Classes without a wing" value={formatNumber(unassignedClassCount)} icon={<BookOpen />} tone={unassignedClassCount > 0 ? "rose" : "peach"} />
          </div>
        )}

        <DashboardSection
          title="School Wings"
          description="Click on a wing to manage its classes and coordinators"
          icon={Building}
          iconGradient="from-violet-400 to-purple-500"
        >
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
              </div>
            ) : wingsError ? (
              // Error BEFORE empty (§6): a failed read must not look like a
              // school without wings.
              <EmptyState
                icon={<AlertTriangle className="h-7 w-7" />}
                tone="rose"
                reason="error"
                title="Couldn't load the wings"
                description="Check your connection and try again."
              />
            ) : wings.length === 0 ? (
              <EmptyState
                icon={<Building className="h-7 w-7" />}
                reason="noData"
                title="No wings yet"
                description='Create wings like "Primary", "Secondary" or "Admin" and put classes and staff in them.'
                action={{ label: "Add Wing", icon: <Plus className="h-4 w-4" />, onClick: openCreateDialog }}
              />
            ) : (
              /* One compact row per wing (Naman, 2026-10-07: "make this thing
                 simple, not big tabs"): a small tone pebble with the wing's
                 letter, the name with its status chip, one line of description
                 and counts, Edit / Delete on the right. The name opens the
                 members sheet; drag a row onto another to reorder (desktop; no grip
                 icon, Naman: "no need of this"). */
              <ul className="space-y-2">
                {wings.map((wing, index) => {
                  const tone = WING_TONES[index % WING_TONES.length];
                  return (
                    <li
                      key={wing.id}
                      data-wing-card={wing.id}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border border-[hsl(var(--surface-stroke))] bg-[hsl(var(--surface-card))] px-3 py-2.5 shadow-card",
                        !wing.is_active && "opacity-70",
                      )}
                    >
                      <ClayPebble tone={tone} size="sm">
                        <span className="text-base font-bold">{(wing.name.trim()[0] || "?").toUpperCase()}</span>
                      </ClayPebble>
                      <button
                        type="button"
                        onClick={() => setSelectedWing(wing)}
                        className="min-w-0 flex-1 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
                      >
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[15px] font-medium leading-[22px] text-ink-900">{wing.name}</span>
                          <Badge
                            className={cn(
                              "shrink-0 border-0 px-1.5 text-[10px]",
                              wing.is_active
                                ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
                                : "bg-rose-500/10 text-rose-600 hover:bg-rose-500/10",
                            )}
                          >
                            {wing.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </span>
                        {/* Description and counts: two lines on a phone (the
                            counts were cut off at 375px), one line from sm up. */}
                        <span className="block text-[13px] leading-[18px] text-ink-500">
                          <span className="block truncate sm:inline">{wing.description || "No description"}</span>
                          <span className="hidden sm:inline"> · </span>
                          <span className="block sm:inline">
                            {formatNumber(wing.assigned_users)} {wing.assigned_users === 1 ? "coordinator" : "coordinators"} ·{" "}
                            {formatNumber(wing.assigned_classes)} {wing.assigned_classes === 1 ? "class" : "classes"}
                          </span>
                        </span>
                      </button>
                      <span className="flex shrink-0 items-center">
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit ${wing.name}`} onClick={() => openEditDialog(wing)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Delete ${wing.name}`}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Wing?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will remove "{wing.name}" with its class and coordinator assignments.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(wing.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        <ChevronRight className="ml-1 hidden h-4 w-4 text-ink-400 sm:block" aria-hidden="true" />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
        </DashboardSection>

        {/* Wing Members Sheet */}
        <Sheet open={!!selectedWing} onOpenChange={(open) => !open && setSelectedWing(null)}>
          <SheetContent className="sm:max-w-lg overflow-y-auto">
            <SheetHeader>
              <SheetTitle>{selectedWing?.name}</SheetTitle>
              <SheetDescription>
                Manage the classes and staff in this wing
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-4">
              {/* MobileTabs, not TabsList: four labelled tabs do not fit the
                  sm:max-w-lg sheet, and a flex-1 TabsList clipped the last one
                  ("Coordinators") off the right edge with no way to reach it. */}
              <MobileTabs
                value={memberTab}
                onValueChange={(v) => setMemberTab(v as WingSheetTab)}
                options={[
                  {
                    value: "classes",
                    label: "Classes",
                    count: wingClasses.length,
                    icon: <GraduationCap className="h-4 w-4" />,
                  },
                  { value: "students", label: "Students", icon: <Users className="h-4 w-4" /> },
                  { value: "teachers", label: "Teachers", icon: <BookOpen className="h-4 w-4" /> },
                  {
                    value: "coordinators",
                    label: "Coordinators",
                    count: wingAssignments.length,
                    icon: <UserPlus className="h-4 w-4" />,
                  },
                ]}
              />

              {memberTab === "classes" && (
                <div className="space-y-4">
                  {/* Add Classes */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Assign Classes to this Wing</Label>
                      {unassignedClasses.length > 0 && (
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedClassIds(unassignedClasses.map(c => c.id))}
                          >
                            Select All
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedClassIds([])}
                          >
                            Clear
                          </Button>
                        </div>
                      )}
                    </div>
                    {unassignedClasses.length > 0 ? (
                      <>
                        <ScrollArea className="h-[280px] border rounded-md p-3">
                          <div className="space-y-2 pr-2">
                            {unassignedClasses.map(cls => (
                              <div key={cls.id} className="flex items-center space-x-2">
                                <Checkbox
                                  id={cls.id}
                                  checked={selectedClassIds.includes(cls.id)}
                                  onCheckedChange={() => toggleClassSelection(cls.id)}
                                />
                                <label htmlFor={cls.id} className="text-sm cursor-pointer">
                                  {formatClassName(cls.name, cls.section)}
                                </label>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                        <Button 
                          onClick={handleAssignClasses} 
                          disabled={selectedClassIds.length === 0 || assignClasses.isPending}
                          size="sm"
                        >
                          Assign {selectedClassIds.length > 0 && `(${selectedClassIds.length})`} Classes
                        </Button>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">All classes are already assigned</p>
                    )}
                  </div>

                  {/* Current Classes */}
                  <div className="space-y-2">
                    <Label>Classes in this Wing</Label>
                    {wingClasses.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">
                        No classes assigned yet
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {wingClasses.map((wc) => (
                          <div 
                            key={wc.id} 
                            className="flex items-center justify-between p-3 border rounded-lg"
                          >
                            <div className="flex items-center gap-2">
                              <GraduationCap className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">
                                {formatClassName(wc.class_name || "", wc.class_section)}
                              </span>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveClass(wc.class_id)}
                              disabled={removeClass.isPending}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {memberTab === "students" && (
                <WingStudentsList wingClassIds={wingClasses.map((wc) => wc.class_id)} />
              )}

              {memberTab === "teachers" && (
                <WingTeachersList wingClassIds={wingClasses.map((wc) => wc.class_id)} />
              )}

              {memberTab === "coordinators" && (
                <div className="space-y-4">
                  {/* Add Member */}
                  <div className="flex gap-2">
                    <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select a coordinator..." />
                      </SelectTrigger>
                      <SelectContent>
                        {unassignedUsers.map(user => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.full_name || user.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={handleAssignUser} disabled={!selectedUserId || assignUser.isPending}>
                      <UserPlus className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Current Members */}
                  <div className="space-y-2">
                    <Label>Coordinators ({wingAssignments.length})</Label>
                    {wingAssignments.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">
                        No coordinators assigned yet
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {wingAssignments.map((assignment) => (
                          <div 
                            key={assignment.id} 
                            className="flex items-center justify-between p-3 border rounded-lg"
                          >
                            <div>
                              <p className="font-medium">
                                {getDisplayName(assignment.profiles)}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {getProfileEmail(assignment.profiles)}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveUser(assignment.user_id)}
                              disabled={removeUser.isPending}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

// Component to show teachers auto-derived from wing's classes
function WingTeachersList({ wingClassIds }: { wingClassIds: string[] }) {
  const { data: teachers, isLoading } = useQuery({
    queryKey: ["wing-teachers", wingClassIds],
    queryFn: async () => {
      if (wingClassIds.length === 0) return [];
      
      const { data, error } = await supabase
        .from("class_assignments")
        .select(`
          user_id, class_id,
          profiles:user_id (id, full_name, email),
          classes:class_id (name, section)
        `)
        .in("class_id", wingClassIds)
        .eq("role", "teacher");
      
      if (error) throw error;
      return data || [];
    },
    enabled: wingClassIds.length > 0,
  });

  if (wingClassIds.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No classes assigned to this wing. Assign classes first to view teachers.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    );
  }

  if (!teachers || teachers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No teachers found in the classes assigned to this wing.
      </p>
    );
  }

  // Group teachers by class
  const teachersByClass = teachers.reduce((acc, teacher) => {
    const cls = pickOne(teacher.classes);
    const className = formatClassName(cls?.name || "Unknown", cls?.section);
    if (!acc[className]) {
      acc[className] = [];
    }
    // Avoid duplicates (same teacher in same class)
    if (!acc[className].some((t) => t.user_id === teacher.user_id)) {
      acc[className].push(teacher);
    }
    return acc;
  }, {} as Record<string, typeof teachers>);

  const uniqueTeacherCount = new Set(teachers.map(t => t.user_id)).size;

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          {uniqueTeacherCount} teacher{uniqueTeacherCount !== 1 ? 's' : ''} auto-derived from class assignments
        </p>
        {Object.entries(teachersByClass).map(([className, classTeachers]) => (
          <div key={className} className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">{className}</Label>
              <Badge variant="secondary">{classTeachers.length} teacher{classTeachers.length !== 1 ? 's' : ''}</Badge>
            </div>
            <div className="space-y-1 pl-2 border-l-2 border-muted">
              {classTeachers.map((teacher) => (
                <div 
                  key={`${teacher.user_id}-${teacher.class_id}`} 
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {getDisplayName(teacher.profiles)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {getProfileEmail(teacher.profiles)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Component to show students in a wing's classes
function WingStudentsList({ wingClassIds }: { wingClassIds: string[] }) {
  const { data: students, isLoading } = useQuery({
    queryKey: ["wing-students", wingClassIds],
    queryFn: async () => {
      if (wingClassIds.length === 0) return [];
      
      const { data, error } = await supabase
        .from("class_assignments")
        .select(`
          user_id, class_id,
          profiles:user_id (id, full_name, email),
          classes:class_id (name, section)
        `)
        .in("class_id", wingClassIds)
        .eq("role", "student");
      
      if (error) throw error;
      return data || [];
    },
    enabled: wingClassIds.length > 0,
  });

  if (wingClassIds.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No classes assigned to this wing. Assign classes first to view students.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    );
  }

  if (!students || students.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No students found in the classes assigned to this wing.
      </p>
    );
  }

  // Group students by class
  const studentsByClass = students.reduce((acc, student) => {
    const cls = pickOne(student.classes);
    const className = formatClassName(cls?.name || "Unknown", cls?.section);
    if (!acc[className]) {
      acc[className] = [];
    }
    acc[className].push(student);
    return acc;
  }, {} as Record<string, typeof students>);

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        {Object.entries(studentsByClass).map(([className, classStudents]) => (
          <div key={className} className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">{className}</Label>
              <Badge variant="secondary">{classStudents.length} students</Badge>
            </div>
            <div className="space-y-1 pl-2 border-l-2 border-muted">
              {classStudents.map((student) => (
                <div 
                  key={student.user_id} 
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {getDisplayName(student.profiles)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {getProfileEmail(student.profiles)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
