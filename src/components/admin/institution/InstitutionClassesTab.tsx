import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, ChevronDown, ChevronRight, Users, Layers, Trash2, Loader2 } from "lucide-react";
import {
  useInstitutionClassGroups,
  useCreateClassGroup,
  useUpdateClassGroup,
  useAddSectionToClassGroup,
  useDeleteClassGroup,
  type ClassGroupWithSections,
} from "@/hooks/useClassGroups";
import { useUpdateClass } from "@/hooks/useClasses";
import { getDisplaySection } from "@/lib/sectionDisplay";
import { compareClassNames } from "@/lib/classSort";

interface InstitutionClassesTabProps {
  institutionId: string;
}

function getCurrentAcademicYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  if (month >= 3) return `${year}-${(year + 1).toString().slice(2)}`;
  return `${year - 1}-${year.toString().slice(2)}`;
}

const DEFAULT_SECTIONS = ["A", "B", "C", "D", "E", "F"];

export function InstitutionClassesTab({ institutionId }: InstitutionClassesTabProps) {
  const [isAddGroupOpen, setIsAddGroupOpen] = useState(false);
  const [addSectionGroup, setAddSectionGroup] = useState<ClassGroupWithSections | null>(null);
  const [editingGroup, setEditingGroup] = useState<ClassGroupWithSections | null>(null);
  const [editingSection, setEditingSection] = useState<{
    id: string;
    class_name: string;
    section: string | null;
    academic_year: string;
  } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [deletingGroup, setDeletingGroup] = useState<ClassGroupWithSections | null>(null);

  const [groupForm, setGroupForm] = useState({
    name: "",
    academic_year: getCurrentAcademicYear(),
    initial_sections: ["A"] as string[],
  });
  const [sectionForm, setSectionForm] = useState({ section: "A" });

  const { data: groups, isLoading } = useInstitutionClassGroups(institutionId);

  const createGroup = useCreateClassGroup();
  const updateGroup = useUpdateClassGroup();
  const addSection = useAddSectionToClassGroup();
  const deleteGroup = useDeleteClassGroup();
  const updateClass = useUpdateClass();

  const sortedGroups = useMemo<ClassGroupWithSections[]>(() => {
    if (!groups) return [];
    const byYear: Record<string, ClassGroupWithSections[]> = {};
    for (const g of groups) {
      (byYear[g.academic_year] ||= []).push(g);
    }
    return Object.keys(byYear)
      .sort((a, b) => b.localeCompare(a))
      .flatMap((year) =>
        byYear[year].slice().sort((a, b) => compareClassNames(a.name, b.name))
      );
  }, [groups]);

  const totalSections = useMemo(
    () => (groups ?? []).reduce((sum, g) => sum + (g.section_count ?? 0), 0),
    [groups]
  );

  const toggleExpanded = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const handleAddGroup = async () => {
    try {
      await createGroup.mutateAsync({
        institution_id: institutionId,
        name: groupForm.name,
        academic_year: groupForm.academic_year,
        initial_sections: groupForm.initial_sections,
      });
      setIsAddGroupOpen(false);
      setGroupForm({
        name: "",
        academic_year: getCurrentAcademicYear(),
        initial_sections: ["A"],
      });
    } catch {
      /* handled in hook */
    }
  };

  const handleUpdateGroup = async () => {
    if (!editingGroup) return;
    try {
      await updateGroup.mutateAsync({
        id: editingGroup.id,
        name: groupForm.name,
        academic_year: groupForm.academic_year,
      });
      setEditingGroup(null);
    } catch {
      /* handled in hook */
    }
  };

  const handleAddSection = async () => {
    if (!addSectionGroup) return;
    try {
      await addSection.mutateAsync({
        class_group_id: addSectionGroup.id,
        institution_id: addSectionGroup.institution_id,
        class_name: addSectionGroup.name,
        academic_year: addSectionGroup.academic_year,
        section: sectionForm.section,
      });
      setAddSectionGroup(null);
      setSectionForm({ section: "A" });
    } catch {
      /* handled in hook */
    }
  };

  const handleUpdateSection = async () => {
    if (!editingSection) return;
    try {
      await updateClass.mutateAsync({
        id: editingSection.id,
        name: editingSection.class_name,
        section: editingSection.section,
        academic_year: editingSection.academic_year,
        is_active: true,
      });
      setEditingSection(null);
    } catch {
      /* handled in hook */
    }
  };

  const handleDeleteGroup = async () => {
    if (!deletingGroup) return;
    try {
      await deleteGroup.mutateAsync({
        id: deletingGroup.id,
        institution_id: deletingGroup.institution_id,
      });
      setDeletingGroup(null);
    } catch {
      /* handled in hook */
    }
  };

  const suggestedSectionForGroup = (g: ClassGroupWithSections): string => {
    const existing = new Set(
      (g.section_labels ?? [])
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.toUpperCase())
    );
    const next = DEFAULT_SECTIONS.find((s) => !existing.has(s));
    return next ?? "A";
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {sortedGroups.length} classes • {totalSections} sections
        </p>
        <Button size="sm" onClick={() => setIsAddGroupOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add Class
        </Button>
      </div>

      {sortedGroups.length > 0 ? (
        <div className="border rounded-lg divide-y">
          {sortedGroups.map((group) => {
            const expanded = expandedGroups.has(group.id);
            return (
              <div key={group.id}>
                <div className="flex items-center gap-2 p-3 hover:bg-muted/40">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => toggleExpanded(group.id)}
                    aria-label={expanded ? "Collapse sections" : "Expand sections"}
                  >
                    {expanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </Button>
                  <Layers className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{group.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {group.academic_year}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {group.section_count} section{group.section_count === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setAddSectionGroup(group);
                      setSectionForm({ section: suggestedSectionForGroup(group) });
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add section
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => {
                      setEditingGroup(group);
                      setGroupForm({
                        name: group.name,
                        academic_year: group.academic_year,
                        initial_sections: [],
                      });
                    }}
                    aria-label="Edit class"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => setDeletingGroup(group)}
                    aria-label="Delete class"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {expanded && (
                  <div className="pl-12 pr-3 pb-3 space-y-1">
                    {group.section_ids.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic py-2">
                        No sections yet. Add one from the button above.
                      </p>
                    ) : (
                      group.section_ids.map((sectionId, idx) => {
                        const rawLabel = group.section_labels[idx] ?? null;
                        const display = getDisplaySection(group.name, rawLabel) ?? rawLabel ?? "-";
                        return (
                          <div
                            key={sectionId}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40"
                          >
                            <Users className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-sm">{display}</span>
                            <Badge variant="outline" className="text-xs ml-2">
                              {group.name} · {display}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 ml-auto"
                              onClick={() =>
                                setEditingSection({
                                  id: sectionId,
                                  class_name: group.name,
                                  section: rawLabel,
                                  academic_year: group.academic_year,
                                })
                              }
                              aria-label="Edit section"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          No classes created yet. Start by adding Class 1, Class 10, or any grade you offer.
        </div>
      )}

      {/* Add Class (Group) Dialog */}
      <Dialog open={isAddGroupOpen} onOpenChange={setIsAddGroupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Class</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Class Name</Label>
              <Input
                value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                placeholder="Class 10"
              />
              <p className="text-xs text-muted-foreground">
                Use the same name across sections (e.g. "Class 10"). Sections A, B, C live inside this class.
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Academic Year</Label>
              <Input
                value={groupForm.academic_year}
                onChange={(e) =>
                  setGroupForm({ ...groupForm, academic_year: e.target.value })
                }
                placeholder="2024-25"
              />
            </div>
            <div className="grid gap-2">
              <Label>Initial sections</Label>
              <div className="flex flex-wrap gap-2">
                {DEFAULT_SECTIONS.map((s) => {
                  const selected = groupForm.initial_sections.includes(s);
                  return (
                    <Button
                      key={s}
                      type="button"
                      variant={selected ? "default" : "outline"}
                      size="sm"
                      onClick={() =>
                        setGroupForm((prev) => ({
                          ...prev,
                          initial_sections: selected
                            ? prev.initial_sections.filter((x) => x !== s)
                            : [...prev.initial_sections, s],
                        }))
                      }
                    >
                      {s}
                    </Button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Pick at least one section. You can add more later.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddGroupOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddGroup}
              disabled={
                !groupForm.name.trim() ||
                !groupForm.academic_year.trim() ||
                groupForm.initial_sections.length === 0 ||
                createGroup.isPending
              }
            >
              Create class
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Class (Group) Dialog */}
      <Dialog open={!!editingGroup} onOpenChange={(o) => !o && setEditingGroup(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Class</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Class Name</Label>
              <Input
                value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Renaming applies to every section in this class.
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Academic Year</Label>
              <Input
                value={groupForm.academic_year}
                onChange={(e) =>
                  setGroupForm({ ...groupForm, academic_year: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingGroup(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleUpdateGroup}
              disabled={!groupForm.name.trim() || updateGroup.isPending}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Section Dialog */}
      <Dialog
        open={!!addSectionGroup}
        onOpenChange={(o) => !o && setAddSectionGroup(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add section to {addSectionGroup?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Section label</Label>
              <div className="flex flex-wrap gap-2">
                {DEFAULT_SECTIONS.map((s) => {
                  const taken = (addSectionGroup?.section_labels ?? [])
                    .map((l) => l?.toUpperCase())
                    .includes(s);
                  const selected = sectionForm.section === s;
                  return (
                    <Button
                      key={s}
                      type="button"
                      variant={selected ? "default" : "outline"}
                      size="sm"
                      disabled={taken}
                      onClick={() => setSectionForm({ section: s })}
                    >
                      {s}
                      {taken ? " (taken)" : ""}
                    </Button>
                  );
                })}
              </div>
              <Input
                value={sectionForm.section}
                onChange={(e) => setSectionForm({ section: e.target.value })}
                placeholder="Or type a custom label"
              />
              <p className="text-xs text-muted-foreground">
                This section will inherit all subjects already mapped to{" "}
                {addSectionGroup?.name}.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddSectionGroup(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddSection}
              disabled={!sectionForm.section.trim() || addSection.isPending}
            >
              Add section
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Section Dialog */}
      <Dialog
        open={!!editingSection}
        onOpenChange={(o) => !o && setEditingSection(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit section</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Section label</Label>
              <Input
                value={editingSection?.section ?? ""}
                onChange={(e) =>
                  setEditingSection(
                    editingSection
                      ? { ...editingSection, section: e.target.value }
                      : null
                  )
                }
                placeholder="A"
              />
              <p className="text-xs text-muted-foreground">
                Only the section label changes here. To rename the whole class, edit the class instead.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingSection(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateSection} disabled={updateClass.isPending}>
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Class (Group) Confirmation */}
      <AlertDialog
        open={!!deletingGroup}
        onOpenChange={(o) => !o && !deleteGroup.isPending && setDeletingGroup(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deletingGroup?.name}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {deletingGroup && deletingGroup.section_count > 0 ? (
                  <>
                    <p>
                      This will permanently delete{" "}
                      <span className="font-medium text-foreground">
                        {deletingGroup.section_count} section
                        {deletingGroup.section_count === 1 ? "" : "s"}
                      </span>{" "}
                      ({(deletingGroup.section_labels ?? [])
                        .filter((s): s is string => typeof s === "string" && s.length > 0)
                        .join(", ") || "N/A"}) along with every record tied to them:
                    </p>
                    <ul className="list-disc pl-5 text-sm">
                      <li>Teacher and student class assignments</li>
                      <li>Attendance, timetable slots, and lesson plans</li>
                      <li>Exam classes, study materials, and chapter mappings</li>
                    </ul>
                    <p className="font-medium text-destructive">
                      This action cannot be undone.
                    </p>
                  </>
                ) : (
                  <p>
                    This class has no sections, so deleting it won't affect any
                    students or teachers. This action cannot be undone.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteGroup.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDeleteGroup();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteGroup.isPending}
            >
              {deleteGroup.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Delete class"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
