import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  BookOpen,
  Loader2,
  Check,
  ChevronsUpDown,
  Globe,
  Building,
  Plus,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { FIELD_FILL } from "@/lib/fieldStyles";
import { useInstitutionClassGroups } from "@/hooks/useClassGroups";

interface AssignSubjectToClassDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string;
}

interface SubjectOption {
  id: string;
  name: string;
  code: string | null;
  category?: string | null;
  isGlobal: boolean;
}

export function AssignSubjectToClassDialog({
  open,
  onOpenChange,
  institutionId,
}: AssignSubjectToClassDialogProps) {
  const queryClient = useQueryClient();
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");
  const [subjectSearch, setSubjectSearch] = useState("");
  const [isSubjectPopoverOpen, setIsSubjectPopoverOpen] = useState(false);
  const [selectedClassGroupIds, setSelectedClassGroupIds] = useState<string[]>([]);
  const [isOptional, setIsOptional] = useState(false);

  // Class-group container list for this institution.
  const { data: classGroups = [], isLoading: groupsLoading } =
    useInstitutionClassGroups(open ? institutionId : null);

  // Universal subjects: global (institution_id IS NULL) + this institution's own.
  const { data: subjects, isLoading: subjectsLoading } = useQuery({
    queryKey: ["assignable-subjects", institutionId],
    queryFn: async (): Promise<SubjectOption[]> => {
      const { data, error } = await supabase
        .from("universal_subjects")
        .select("id, name, code, category, institution_id")
        .or(`institution_id.is.null,institution_id.eq.${institutionId}`)
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return (data ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code,
        category: s.category,
        isGlobal: s.institution_id === null,
      }));
    },
    enabled: open,
  });

  // Existing group-level mappings for the selected subject — which groups
  // already own it (so we can mark them as "already assigned").
  const { data: existingGroupIds } = useQuery({
    queryKey: ["group-mappings-for-subject", institutionId, selectedSubjectId],
    queryFn: async () => {
      if (!selectedSubjectId) return [];
      const { data, error } = await supabase
        .from("subject_class_group_mappings" as never)
        .select("class_group_id")
        .eq("institution_id", institutionId)
        .eq("subject_id", selectedSubjectId);

      if (error) throw error;
      return (
        (data as unknown as Array<{ class_group_id: string }> | null)?.map(
          (m) => m.class_group_id
        ) ?? []
      );
    },
    enabled: open && !!selectedSubjectId,
  });

  // Filter + split subjects for the picker.
  const filteredOptions = useMemo(() => {
    const all = subjects ?? [];
    const searchLower = subjectSearch.toLowerCase().trim();
    const matches = (s: SubjectOption) =>
      !searchLower ||
      s.name.toLowerCase().includes(searchLower) ||
      (s.code?.toLowerCase().includes(searchLower) ?? false);

    const global = all.filter((s) => s.isGlobal && matches(s));
    const institute = all.filter((s) => !s.isGlobal && matches(s));
    return { global, institute };
  }, [subjects, subjectSearch]);

  const canCreateNew = useMemo(() => {
    const searchLower = subjectSearch.toLowerCase().trim();
    if (!searchLower) return false;
    return !(subjects ?? []).some(
      (s) => s.name.toLowerCase() === searchLower
    );
  }, [subjectSearch, subjects]);

  // Create a brand-new institution-scoped subject on the fly.
  const createSubjectMutation = useMutation({
    mutationFn: async (subjectName: string) => {
      const code =
        subjectName
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 6) || "SUBJ";

      const { data, error } = await supabase
        .from("universal_subjects")
        .insert({
          institution_id: institutionId,
          name: subjectName.trim(),
          code,
          is_active: true,
        })
        .select("id, name, code, category, institution_id")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({
        queryKey: ["assignable-subjects", institutionId],
      });
      setSelectedSubjectId(row.id);
      setSubjectSearch("");
      setIsSubjectPopoverOpen(false);
      toast.success(`Created "${row.name}"`);
    },
    onError: (e: Error) =>
      toastError(e, {
        fallback: "Couldn't create the subject.",
        context: "createUniversalSubject",
      }),
  });

  // Assign to selected class groups — trigger fans out to every section.
  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSubjectId || selectedClassGroupIds.length === 0) {
        throw new Error("Pick a subject and at least one class.");
      }

      const alreadyMapped = new Set(existingGroupIds ?? []);
      const newGroupIds = selectedClassGroupIds.filter(
        (id) => !alreadyMapped.has(id)
      );

      if (newGroupIds.length === 0) {
        throw new Error("Every selected class already has this subject.");
      }

      const rows = newGroupIds.map((classGroupId) => ({
        institution_id: institutionId,
        class_group_id: classGroupId,
        subject_id: selectedSubjectId,
        is_optional: isOptional,
      }));

      const { error } = await supabase
        .from("subject_class_group_mappings" as never)
        .insert(rows as never);

      if (error) throw error;
      return newGroupIds.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["class-group-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["class-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["subject-class-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-assigned-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["group-mappings-for-subject"] });
      queryClient.invalidateQueries({ queryKey: ["matrix-group-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["matrix-subjects-in-use"] });
      toast.success(
        `Subject assigned to ${count} class${count > 1 ? "es" : ""}`
      );
      handleClose();
    },
    onError: (e: Error) =>
      toastError(e, {
        fallback: "Couldn't assign the subject.",
        context: "assignSubjectToGroups",
      }),
  });

  const handleClose = () => {
    setSelectedSubjectId("");
    setSubjectSearch("");
    setSelectedClassGroupIds([]);
    setIsOptional(false);
    onOpenChange(false);
  };

  const handleSelectSubject = (subjectId: string) => {
    setSelectedSubjectId(subjectId);
    setSubjectSearch("");
    setIsSubjectPopoverOpen(false);
  };

  const handleCreateNewSubject = () => {
    if (subjectSearch.trim()) {
      createSubjectMutation.mutate(subjectSearch.trim());
    }
  };

  const toggleGroup = (groupId: string) => {
    setSelectedClassGroupIds((prev) =>
      prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId]
    );
  };

  const selectAllGroups = () => {
    const eligible = classGroups
      .map((g) => g.id)
      .filter((id) => !existingGroupIds?.includes(id));
    setSelectedClassGroupIds(eligible);
  };

  const clearSelection = () => setSelectedClassGroupIds([]);

  const selectedSubject = (subjects ?? []).find(
    (s) => s.id === selectedSubjectId
  );
  const isLoading = groupsLoading || subjectsLoading;

  const subjectBadge = (s: SubjectOption) =>
    s.isGlobal ? (
      <Badge
        variant="outline"
        className="text-xs ml-auto text-muted-foreground"
      >
        <Globe className="h-3 w-3 mr-1" />
        Global
      </Badge>
    ) : (
      <Badge variant="secondary" className="text-xs ml-auto">
        <Building className="h-3 w-3 mr-1" />
        School
      </Badge>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign Subject to Classes</DialogTitle>
          <DialogDescription>
            Pick a subject and the classes it should belong to. Every section
            under each class inherits the subject automatically.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {/* Subject picker */}
            <div className="grid gap-2">
              <Label>Subject</Label>
              <Popover
                open={isSubjectPopoverOpen}
                onOpenChange={setIsSubjectPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={isSubjectPopoverOpen}
                    className={cn("w-full justify-between font-normal", FIELD_FILL)}
                  >
                    {selectedSubject ? (
                      <span className="flex items-center gap-2">
                        <BookOpen className="h-4 w-4" />
                        {selectedSubject.name}
                        {subjectBadge(selectedSubject)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        Search or select a subject...
                      </span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Search subjects..."
                      value={subjectSearch}
                      onValueChange={setSubjectSearch}
                    />
                    <CommandList className="max-h-[300px]">
                      {filteredOptions.institute.length > 0 && (
                        <CommandGroup heading="School subjects">
                          {filteredOptions.institute.map((subject) => (
                            <CommandItem
                              key={subject.id}
                              value={subject.id}
                              onSelect={() => handleSelectSubject(subject.id)}
                              className="cursor-pointer"
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedSubjectId === subject.id
                                    ? "opacity-100"
                                    : "opacity-0"
                                )}
                              />
                              <BookOpen className="mr-2 h-4 w-4" />
                              <div className="flex-1">
                                <span>{subject.name}</span>
                                {subject.code && (
                                  <span className="text-xs text-muted-foreground ml-2">
                                    {subject.code}
                                  </span>
                                )}
                              </div>
                              {subjectBadge(subject)}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}

                      {filteredOptions.global.length > 0 && (
                        <CommandGroup heading="Global catalog">
                          {filteredOptions.global.map((subject) => (
                            <CommandItem
                              key={subject.id}
                              value={subject.id}
                              onSelect={() => handleSelectSubject(subject.id)}
                              className="cursor-pointer"
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedSubjectId === subject.id
                                    ? "opacity-100"
                                    : "opacity-0"
                                )}
                              />
                              <BookOpen className="mr-2 h-4 w-4" />
                              <div className="flex-1">
                                <span>{subject.name}</span>
                                {subject.code && (
                                  <span className="text-xs text-muted-foreground ml-2">
                                    {subject.code}
                                  </span>
                                )}
                              </div>
                              {subjectBadge(subject)}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}

                      {canCreateNew && (
                        <CommandGroup heading="Create new">
                          <CommandItem
                            onSelect={handleCreateNewSubject}
                            className="cursor-pointer"
                          >
                            <Plus className="mr-2 h-4 w-4 text-green-600" />
                            <span>Create "</span>
                            <span className="font-medium">{subjectSearch}</span>
                            <span>" (school subject)</span>
                            {createSubjectMutation.isPending && (
                              <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                            )}
                          </CommandItem>
                        </CommandGroup>
                      )}

                      {filteredOptions.global.length === 0 &&
                        filteredOptions.institute.length === 0 &&
                        !canCreateNew && (
                          <CommandEmpty>
                            No subjects found. Type to search or create a new one.
                          </CommandEmpty>
                        )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Class-group multi-select */}
            {selectedSubjectId && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Assign to classes</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={selectAllGroups}
                    >
                      Select all
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearSelection}
                    >
                      Clear
                    </Button>
                  </div>
                </div>

                <div className="border rounded-md p-3 max-h-[240px] overflow-y-auto space-y-2">
                  {classGroups.length === 0 && (
                    <p className="text-sm text-muted-foreground py-2">
                      No classes found. Create one in the Classes tab first.
                    </p>
                  )}
                  {classGroups.map((g) => {
                    const already = existingGroupIds?.includes(g.id);
                    const selected = selectedClassGroupIds.includes(g.id);
                    return (
                      <div
                        key={g.id}
                        className={cn(
                          "flex items-center gap-3 p-2 rounded-md",
                          already
                            ? "bg-muted opacity-60"
                            : "hover:bg-muted/50 cursor-pointer"
                        )}
                        onClick={() => !already && toggleGroup(g.id)}
                      >
                        <Checkbox
                          checked={selected || already}
                          disabled={already}
                          onCheckedChange={() => !already && toggleGroup(g.id)}
                        />
                        <Layers className="h-4 w-4 text-muted-foreground" />
                        <div className="flex-1">
                          <span className="font-medium">{g.name}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {g.academic_year} · {g.section_count} section
                            {g.section_count === 1 ? "" : "s"}
                          </span>
                        </div>
                        {already && (
                          <Badge variant="secondary" className="text-xs">
                            Already assigned
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>

                {selectedClassGroupIds.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {selectedClassGroupIds.length} class
                    {selectedClassGroupIds.length > 1 ? "es" : ""} selected.
                    Every section under them will inherit this subject.
                  </p>
                )}

                {/* Optional subject toggle — students enroll individually. */}
                <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                  <div className="space-y-0.5">
                    <Label htmlFor="assignOptional" className="text-sm font-medium cursor-pointer">
                      Optional subject
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Students enroll individually instead of the whole class taking it.
                    </p>
                  </div>
                  <Switch
                    id="assignOptional"
                    checked={isOptional}
                    onCheckedChange={setIsOptional}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={() => assignMutation.mutate()}
            disabled={
              !selectedSubjectId ||
              selectedClassGroupIds.length === 0 ||
              assignMutation.isPending
            }
          >
            {assignMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Assigning...
              </>
            ) : (
              <>
                <BookOpen className="mr-2 h-4 w-4" />
                Assign subject
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
