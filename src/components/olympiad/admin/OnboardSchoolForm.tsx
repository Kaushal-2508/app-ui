import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useOnboardSchool,
  type OnboardSchoolInput,
  type OnboardSchoolResult,
} from "@/hooks/olympiad/useOnboardSchool";
import { useOlympiadInstitutions } from "@/hooks/olympiad/useOlympiadInstitutions";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type OnboardSchoolFormProps = {
  campaignId: string;
  onSuccess: (result: OnboardSchoolResult) => void;
};

function useGradeLevelMap() {
  return useQuery({
    queryKey: ["grade-levels", "olympiad"],
    queryFn: async () => {
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

export function OnboardSchoolForm({ campaignId, onSuccess }: OnboardSchoolFormProps) {
  const onboard = useOnboardSchool();
  const { data: institutions } = useOlympiadInstitutions();
  const { data: grades } = useGradeLevelMap();

  const [isExisting, setIsExisting] = useState(false);
  const [institutionId, setInstitutionId] = useState<string>("");
  const [schoolName, setSchoolName] = useState("");
  const [city, setCity] = useState("");
  const [stateField, setStateField] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  const [priceOverride, setPriceOverride] = useState<string>("");
  const [notes, setNotes] = useState("");

  // When existing-school toggle is set and an institution is picked, autofill the name.
  useEffect(() => {
    if (isExisting && institutionId && institutions) {
      const inst = institutions.find((i) => i.id === institutionId);
      if (inst) {
        setSchoolName(inst.name);
      }
    }
  }, [isExisting, institutionId, institutions]);

  const isDirty =
    schoolName !== "" ||
    contactName !== "" ||
    contactEmail !== "" ||
    contactPhone !== "";

  const resetForm = () => {
    setIsExisting(false);
    setInstitutionId("");
    setSchoolName("");
    setCity("");
    setStateField("");
    setContactName("");
    setContactEmail("");
    setContactPhone("");
    setSelectedGrades([]);
    setPriceOverride("");
    setNotes("");
  };

  const toggleGrade = (id: string, checked: boolean) =>
    setSelectedGrades((s) =>
      checked ? [...new Set([...s, id])] : s.filter((g) => g !== id),
    );

  const canSubmit =
    !!contactName.trim() &&
    !!contactEmail.trim() &&
    !!contactPhone.trim() &&
    selectedGrades.length > 0 &&
    (isExisting ? !!institutionId : !!schoolName.trim());

  const onSubmit = async () => {
    const input: OnboardSchoolInput = {
      campaign_id: campaignId,
      is_existing_salci_school: isExisting,
      institution_id: isExisting ? institutionId : undefined,
      school_name: !isExisting ? schoolName.trim() : undefined,
      city: city.trim() || undefined,
      state: stateField.trim() || undefined,
      primary_contact_name: contactName.trim(),
      primary_contact_email: contactEmail.trim(),
      primary_contact_phone: contactPhone.trim(),
      participating_grade_level_ids: selectedGrades,
      price_override_rupees: priceOverride.trim() ? Number(priceOverride) : null,
      internal_notes: notes.trim() || null,
    };
    try {
      const result = await onboard.mutateAsync(input);
      onSuccess(result);
      resetForm();
    } catch {
      // toastError fires on error path via useOnboardSchool onError
    }
  };

  return (
    <form
      data-dirty={isDirty ? "true" : "false"}
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
      className="surface-card frosted-shadow rounded-card p-5 space-y-4"
    >
      {/* Existing-SALCI toggle */}
      <div className="flex items-center justify-between rounded-md border border-surface-stroke p-3">
        <div>
          <p className="text-sm font-medium text-ink-900">Existing SALCI school?</p>
          <p className="text-[11px] text-ink-500">
            Toggle on if this institution already uses SALCI
          </p>
        </div>
        <Switch
          checked={isExisting}
          onCheckedChange={(v) => {
            setIsExisting(v);
            setInstitutionId("");
          }}
        />
      </div>

      {/* Institution picker or new school fields */}
      {isExisting ? (
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Pick institution</Label>
          <Select value={institutionId} onValueChange={setInstitutionId}>
            <SelectTrigger>
              <SelectValue placeholder="Select an institution" />
            </SelectTrigger>
            <SelectContent>
              {(institutions ?? []).map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.name} ({i.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">School name</Label>
          <Input
            value={schoolName}
            onChange={(e) => setSchoolName(e.target.value)}
            placeholder="e.g. Delhi Public School"
            required
          />
        </div>
      )}

      {/* City / State */}
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">City</Label>
          <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Optional" />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">State</Label>
          <Input
            value={stateField}
            onChange={(e) => setStateField(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>

      {/* Primary contact */}
      <fieldset className="grid gap-1.5">
        <legend className="text-xs font-medium text-ink-600">Primary contact</legend>
        <Input
          placeholder="Name"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
          required
        />
        <Input
          type="email"
          placeholder="Email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          required
        />
        <Input
          placeholder="Phone (10 digits)"
          value={contactPhone}
          onChange={(e) =>
            setContactPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
          }
          required
        />
      </fieldset>

      {/* Participating classes */}
      <div className="grid gap-1.5">
        <Label className="text-xs font-medium text-ink-600">Participating classes</Label>
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

      {/* Price override */}
      <div className="grid gap-1.5">
        <Label className="text-xs font-medium text-ink-600">
          Price override (₹, optional)
        </Label>
        <Input
          type="number"
          value={priceOverride}
          onChange={(e) => setPriceOverride(e.target.value)}
          placeholder="Leave blank to use campaign default"
          min={1}
        />
      </div>

      {/* Internal notes */}
      <div className="grid gap-1.5">
        <Label className="text-xs font-medium text-ink-600">Internal notes</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>

      {/* Submit */}
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={!canSubmit || onboard.isPending}>
          {onboard.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Onboard
        </Button>
      </div>
    </form>
  );
}
