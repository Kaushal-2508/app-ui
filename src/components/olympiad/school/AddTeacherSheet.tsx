import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { OlympiadTeacherCredentials } from "@/components/olympiad/school/OlympiadTeacherCredentials";
import {
  useCreateOlympiadTeacher,
  type CreateOlympiadTeacherResult,
} from "@/hooks/olympiad/useCreateOlympiadTeacher";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type GradeLevel = {
  id: string;
  grade_name: string;
  display_order: number | null;
};

function useParticipatingGrades(participatingGradeIds: string[]) {
  return useQuery({
    queryKey: ["grade-levels", "participating", participatingGradeIds],
    queryFn: async (): Promise<GradeLevel[]> => {
      if (participatingGradeIds.length === 0) return [];
      const { data, error } = await supabase
        .from("grade_levels")
        .select("id, grade_name, display_order")
        .in("id", participatingGradeIds)
        .order("display_order");
      if (error) throw error;
      return (data ?? []) as GradeLevel[];
    },
    enabled: participatingGradeIds.length > 0,
    staleTime: 5 * 60_000,
  });
}

const PHONE_RE = /^[6-9]\d{9}$/;

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  olySchoolId: string;
  participatingGradeIds: string[];
};

export function AddTeacherSheet({
  open,
  onOpenChange,
  olySchoolId,
  participatingGradeIds,
}: Props) {
  const createTeacher = useCreateOlympiadTeacher();
  const { data: grades } = useParticipatingGrades(participatingGradeIds);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  const [created, setCreated] = useState<CreateOlympiadTeacherResult | null>(null);

  const initialRef = useRef({ fullName: "", email: "", phone: "" });

  useEffect(() => {
    if (!open) {
      setFullName("");
      setEmail("");
      setPhone("");
      setSelectedGrades([]);
      setCreated(null);
      initialRef.current = { fullName: "", email: "", phone: "" };
    }
  }, [open]);

  const clearForm = () => {
    setCreated(null);
    setFullName("");
    setEmail("");
    setPhone("");
    setSelectedGrades([]);
    initialRef.current = { fullName: "", email: "", phone: "" };
  };

  const isDirty =
    fullName !== initialRef.current.fullName ||
    email !== initialRef.current.email ||
    phone !== initialRef.current.phone;

  const toggleGrade = (id: string, checked: boolean) =>
    setSelectedGrades((prev) =>
      checked ? [...new Set([...prev, id])] : prev.filter((g) => g !== id),
    );

  const phoneValid = PHONE_RE.test(phone);
  const canSubmit =
    !!fullName.trim() &&
    !!email.trim() &&
    phoneValid &&
    selectedGrades.length > 0;

  const onSubmit = async () => {
    try {
      const res = await createTeacher.mutateAsync({
        oly_school_id: olySchoolId,
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        grade_level_ids: selectedGrades,
      });
      // Keep the sheet open and reveal the login credentials so the admin can
      // hand them to the teacher directly.
      setCreated(res);
    } catch {
      // toastError fires via useCreateOlympiadTeacher onError
    }
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={created ? "Teacher created" : "Add Olympiad Teacher"}
      subtitle={
        created
          ? "Share these login details with the teacher"
          : "Create a new teacher account for this school"
      }
      icon={created ? <CheckCircle2 className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
      primaryAction={
        created
          ? { label: "Done", onClick: () => onOpenChange(false) }
          : {
              label: "Create teacher",
              onClick: () => void onSubmit(),
              loading: createTeacher.isPending,
              disabled: !canSubmit,
            }
      }
      secondaryAction={
        created
          ? { label: "Add another", onClick: clearForm }
          : { label: "Cancel", onClick: () => onOpenChange(false) }
      }
    >
      {created ? (
        <OlympiadTeacherCredentials
          name={fullName.trim()}
          email={created.email}
          password={created.temp_password}
        />
      ) : (
      <form
        data-dirty={isDirty ? "true" : "false"}
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
        className="space-y-4"
      >
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Full name</Label>
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Priya Sharma"
            required
          />
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Email</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teacher@school.edu"
            required
          />
          <p className="text-[11px] text-ink-500">
            A password-set link will be sent to this address.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Phone</Label>
          <Input
            value={phone}
            onChange={(e) =>
              setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
            }
            placeholder="10-digit Indian mobile"
            required
          />
          {phone.length === 10 && !phoneValid && (
            <p className="text-[11px] text-red-500">
              Must start with 6–9 and be 10 digits.
            </p>
          )}
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">
            Assign to classes (select at least one)
          </Label>
          {(grades ?? []).length === 0 ? (
            <p className="text-[11px] text-ink-500 flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading classes…
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(grades ?? []).map((g) => (
                <label key={g.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={selectedGrades.includes(g.id)}
                    onCheckedChange={(v) => toggleGrade(g.id, !!v)}
                  />
                  <span>{g.grade_name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </form>
      )}
    </MobileSheet>
  );
}
