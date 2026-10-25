import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import {
  useUpsertOlympiadSubject,
  type OlympiadSubject,
} from "@/hooks/olympiad/useOlympiadSubjects";

type GradeLevel = {
  id: string;
  grade_name: string;
  grade_number: number | null;
  display_order: number | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject?: OlympiadSubject | null;
};

function useGradeLevels() {
  return useQuery({
    queryKey: ["grade-levels", "olympiad-applicable"],
    queryFn: async (): Promise<GradeLevel[]> => {
      const { data, error } = await supabase
        .from("grade_levels")
        .select("id, grade_name, grade_number, display_order")
        .eq("is_active", true)
        .order("display_order");
      if (error) throw error;
      return (data ?? []).filter((g) => {
        // Class 1-10 + all Class 11 & 12 stream variants (grade_number 11-18).
        const n = Number(g.grade_number);
        return Number.isFinite(n) && n >= 1 && n <= 18;
      });
    },
    staleTime: 5 * 60_000,
  });
}

export function SubjectEditorSheet({ open, onOpenChange, subject }: Props) {
  const { data: grades } = useGradeLevels();
  const upsert = useUpsertOlympiadSubject();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);

  const initialRef = useRef<{
    name: string;
    description: string;
    status: "active" | "archived";
    grades: string[];
  }>({ name: "", description: "", status: "active", grades: [] });

  useEffect(() => {
    if (subject) {
      setName(subject.name);
      setDescription(subject.description ?? "");
      setStatus(subject.status);
      setSelectedGrades(subject.grade_level_ids);
      initialRef.current = {
        name: subject.name,
        description: subject.description ?? "",
        status: subject.status,
        grades: [...subject.grade_level_ids].sort(),
      };
    } else {
      setName("");
      setDescription("");
      setStatus("active");
      setSelectedGrades([]);
      initialRef.current = { name: "", description: "", status: "active", grades: [] };
    }
  }, [subject, open]);

  const toggleGrade = (id: string, checked: boolean) =>
    setSelectedGrades((s) =>
      checked ? [...new Set([...s, id])] : s.filter((g) => g !== id),
    );

  const handleSubmit = async () => {
    try {
      await upsert.mutateAsync({
        id: subject?.id,
        name: name.trim(),
        description: description.trim() || null,
        status,
        grade_level_ids: selectedGrades,
      });
      onOpenChange(false);
    } catch {
      // onError on the mutation already surfaces toastError.
      // Keep the sheet open so the user can correct and retry.
    }
  };

  const isDirty = (() => {
    const init = initialRef.current;
    const currentGrades = [...selectedGrades].sort();
    return (
      name.trim() !== init.name.trim() ||
      description !== init.description ||
      status !== init.status ||
      currentGrades.length !== init.grades.length ||
      currentGrades.some((g, i) => g !== init.grades[i])
    );
  })();

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={subject?.id ? "Edit subject" : "New subject"}
      subtitle="Subjects persist across campaign years."
      primaryAction={{
        label: "Save",
        onClick: handleSubmit,
        loading: upsert.isPending,
        disabled: !name.trim() || upsert.isPending,
      }}
      secondaryAction={{
        label: "Cancel",
        onClick: () => onOpenChange(false),
      }}
    >
      <form
        data-dirty={isDirty ? "true" : "false"}
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="space-y-4"
      >
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Description</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Applicable classes</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(grades ?? []).map((g) => (
              <label key={g.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selectedGrades.includes(g.id)}
                  onCheckedChange={(v) => toggleGrade(g.id, !!v)}
                />
                <span>{g.grade_name}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as "active" | "archived")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </form>
    </MobileSheet>
  );
}
