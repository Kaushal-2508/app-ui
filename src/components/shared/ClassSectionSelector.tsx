import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { FIELD_FILL } from "@/lib/fieldStyles";
import { getDisplaySection } from "@/lib/sectionDisplay";
import { sortClassRows } from "@/lib/classSort";

interface ClassSectionSelectorProps {
  institutionId: string | null;
  userRole: "super_admin" | "school_admin" | "coordinator" | "teacher";
  userId?: string;
  selectedClassId: string;
  selectedSections: string[];
  onClassChange: (classId: string) => void;
  onSectionsChange: (sections: string[]) => void;
  showGlobalOption?: boolean;
  showInstitutionSelector?: boolean;
  selectedInstitutionId?: string | null;
  onInstitutionChange?: (institutionId: string | null) => void;
}

interface ClassInfo {
  id: string;
  name: string;
  section: string | null;
  institution_id: string;
}

function extractClassNumber(name: string): number {
  const match = name.match(/class\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : 999;
}

function sortClassNames(names: string[]): string[] {
  const order: Record<string, number> = { lkg: -2, ukg: -1 };
  return [...names].sort((a, b) => {
    const aOrder = order[a.toLowerCase()] ?? extractClassNumber(a);
    const bOrder = order[b.toLowerCase()] ?? extractClassNumber(b);
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.localeCompare(b);
  });
}

export function ClassSectionSelector({
  institutionId,
  userRole,
  userId,
  selectedClassId,
  selectedSections,
  onClassChange,
  onSectionsChange,
  showGlobalOption = false,
  showInstitutionSelector = false,
  selectedInstitutionId,
  onInstitutionChange,
}: ClassSectionSelectorProps) {
  const [classOpen, setClassOpen] = useState(false);

  // Fetch institutions for super admin
  const { data: institutions } = useQuery({
    queryKey: ["institutions-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("institutions")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: userRole === "super_admin" && showInstitutionSelector,
  });

  // Fetch classes based on role
  const { data: allClasses = [] } = useQuery({
    queryKey: ["selector-classes", institutionId, userRole, userId, selectedInstitutionId],
    queryFn: async (): Promise<ClassInfo[]> => {
      // For super admin with institution selector
      const targetInstitutionId = selectedInstitutionId || institutionId;

      if (userRole === "teacher" && userId) {
        // Teachers only see their assigned active classes (archived years filtered out).
        const { data: assignments, error } = await supabase
          .from("class_assignments")
          .select(`
            class_id,
            classes!inner(id, name, section, institution_id)
          `)
          .eq("user_id", userId)
          .eq("role", "teacher")
          .eq("classes.is_active", true);

        if (error) throw error;
        const teacherClasses = (assignments?.map((a) => a.classes as ClassInfo) || []).filter(Boolean);
        return sortClassRows(teacherClasses, (c) => c.name, (c) => c.section);
      } else if (targetInstitutionId) {
        // School admins and coordinators see all institution classes
        const { data, error } = await supabase
          .from("classes")
          .select("id, name, section, institution_id")
          .eq("institution_id", targetInstitutionId)
          .eq("is_active", true)
          .order("name");

        if (error) throw error;
        return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
      } else if (userRole === "super_admin") {
        // Super admin global view - fetch all classes
        const { data, error } = await supabase
          .from("classes")
          .select("id, name, section, institution_id")
          .eq("is_active", true)
          .order("name")
          .limit(2000);

        if (error) throw error;
        return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
      }
      return [];
    },
    enabled: userRole === "teacher" ? !!userId : true,
  });

  // Group classes by name (for section selection) with numerical sorting
  const classNames = sortClassNames([...new Set(allClasses.map((c) => c.name))]);

  // Get sections for selected class name
  const selectedClassName = allClasses.find((c) => c.id === selectedClassId)?.name;
  const sectionsForClass = allClasses
    .filter((c) => c.name === selectedClassName)
    .map((c) => ({ id: c.id, section: c.section || "Default" }));

  // Detect global mode: showGlobalOption enabled and no institution selected
  const isGlobalMode = showGlobalOption && !selectedInstitutionId;

  // Handle class change - select first section by default, or all in global mode
  const handleClassNameChange = (className: string) => {
    const classesWithName = allClasses.filter((c) => c.name === className);
    if (classesWithName.length > 0) {
      onClassChange(classesWithName[0].id);
      if (isGlobalMode) {
        // In global mode, auto-select all matching class IDs (sections are hidden)
        onSectionsChange(classesWithName.map((c) => c.id));
      } else {
        onSectionsChange([classesWithName[0].id]);
      }
    }
  };

  // Handle section toggle
  const handleSectionToggle = (classId: string) => {
    if (selectedSections.includes(classId)) {
      onSectionsChange(selectedSections.filter((id) => id !== classId));
    } else {
      onSectionsChange([...selectedSections, classId]);
    }
  };

  // Handle select all sections
  const handleSelectAllSections = () => {
    const allSectionIds = sectionsForClass.map((s) => s.id);
    if (selectedSections.length === allSectionIds.length) {
      onSectionsChange([]);
    } else {
      onSectionsChange(allSectionIds);
    }
  };

  return (
    <div className="space-y-4">
      {/* Institution selector for super admin */}
      {showInstitutionSelector && userRole === "super_admin" && institutions && (
        <div className="space-y-2">
          <Label>Institution</Label>
          <Select
            value={selectedInstitutionId || "global"}
            onValueChange={(value) => onInstitutionChange?.(value === "global" ? null : value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select institution or global" />
            </SelectTrigger>
            <SelectContent>
              {showGlobalOption && (
                <SelectItem value="global">
                  <span className="font-medium">Global (All Institutions)</span>
                </SelectItem>
              )}
              {institutions.map((inst) => (
                <SelectItem key={inst.id} value={inst.id}>
                  {inst.name} ({inst.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Class selector */}
      <div className="space-y-2">
        <Label>Class</Label>
        <Popover open={classOpen} onOpenChange={setClassOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={classOpen}
              className={cn("w-full justify-between", FIELD_FILL)}
            >
              {selectedClassName || "Select class..."}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-full p-0" align="start">
            <Command>
              <CommandInput placeholder="Search class..." />
              <CommandList>
                <CommandEmpty>No class found.</CommandEmpty>
                <CommandGroup>
                  {classNames.map((className) => (
                    <CommandItem
                      key={className}
                      value={className}
                      onSelect={() => {
                        handleClassNameChange(className);
                        setClassOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          selectedClassName === className ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {className}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Section selector (multi-select with checkboxes) - hidden in global mode */}
      {sectionsForClass.length > 0 && !isGlobalMode && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Sections</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleSelectAllSections}
              className="text-xs h-7"
            >
              {selectedSections.length === sectionsForClass.length ? "Deselect All" : "Select All"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 p-3 border rounded-md bg-muted/30">
            {sectionsForClass.map(({ id, section }) => (
              <div
                key={id}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-md border cursor-pointer transition-colors",
                  selectedSections.includes(id)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted"
                )}
                onClick={() => handleSectionToggle(id)}
              >
                <Checkbox
                  checked={selectedSections.includes(id)}
                  className={cn(
                    "pointer-events-none",
                    selectedSections.includes(id) && "border-primary-foreground data-[state=checked]:bg-primary-foreground data-[state=checked]:text-primary"
                  )}
                />
                <span className="text-sm font-medium">{getDisplaySection(selectedClassName ?? null, section) ?? section}</span>
              </div>
            ))}
          </div>
          {selectedSections.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selectedSections.map((id) => {
                const section = sectionsForClass.find((s) => s.id === id);
                return section ? (
                  <Badge key={id} variant="secondary" className="text-xs">
                    {selectedClassName} - {getDisplaySection(selectedClassName ?? null, section.section) ?? section.section}
                  </Badge>
                ) : null;
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}