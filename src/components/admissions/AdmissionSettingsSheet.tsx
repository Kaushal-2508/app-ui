import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Globe, Hash, ListChecks, Plus, Receipt, Settings2, UserCog, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { MobileSheet } from "@/components/shared/sheets";
import { DEFAULT_DOCUMENT_CHECKLIST, admissionNumberPreview, formSchemaError, normalizeFormSchema, type ChecklistItem, type FormQuestion } from "@/lib/admissions";
import {
  useAdmissionStaff,
  useAdmissionStaffOptions,
  useSetAdmissionSettings,
  useSetAdmissionStaff,
  type AdmissionSettings,
} from "@/hooks/admissions";
import { FormDesigner } from "./FormDesigner";
import { Field, SectionCard } from "./parts";

function keyFor(label: string, taken: Set<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "document";
  let key = base;
  let n = 2;
  while (taken.has(key)) key = `${base}_${n++}`;
  return key;
}

/**
 * The school's admissions settings: the registration fee default, the
 * admission number prefix and next number (decided 2026-10-09: numbers are
 * auto from a prefix), the certificate checklist, the staff who may work the
 * pipeline besides the admins, the public form switch, and the school's own
 * questions (Naman, 2026-10-12: "like we create a google form").
 */
export function AdmissionSettingsSheet({
  open,
  onOpenChange,
  institutionId,
  settings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string;
  settings: AdmissionSettings | undefined;
}) {
  const save = useSetAdmissionSettings();
  const staff = useAdmissionStaff(institutionId, open);
  const staffOptions = useAdmissionStaffOptions(institutionId, open);
  const saveStaff = useSetAdmissionStaff();
  const [fee, setFee] = useState("");
  const [prefix, setPrefix] = useState("");
  const [nextSeq, setNextSeq] = useState("");
  const [formOn, setFormOn] = useState(true);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [schema, setSchema] = useState<FormQuestion[]>([]);
  const [newDoc, setNewDoc] = useState("");
  const [staffIds, setStaffIds] = useState<string[]>([]);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current && settings) {
      setFee(String(settings.registration_fee_rupees));
      setPrefix(settings.admission_number_prefix ?? "");
      setNextSeq(String(settings.next_admission_seq));
      setFormOn(settings.enquiry_form_enabled);
      setChecklist(settings.document_checklist.length > 0 ? settings.document_checklist : DEFAULT_DOCUMENT_CHECKLIST);
      setSchema(settings.form_schema ?? []);
      setNewDoc("");
    }
    wasOpen.current = open;
  }, [open, settings]);
  const staffSeeded = useRef(false);
  useEffect(() => {
    if (!open) {
      staffSeeded.current = false;
      return;
    }
    if (!staffSeeded.current && staff.data) {
      staffSeeded.current = true;
      setStaffIds(staff.data.map((s) => s.user_id));
    }
  }, [open, staff.data]);

  const pending = save.isPending || saveStaff.isPending;
  const feeN = Number(fee);
  const seqN = Number(nextSeq);
  const schemaError = formSchemaError(schema);
  const valid = Number.isFinite(feeN) && feeN >= 0 && Number.isInteger(seqN) && seqN >= 1 && !schemaError;
  const preview = admissionNumberPreview(prefix, seqN || 1);
  const staffChanged = useMemo(() => {
    const was = new Set((staff.data ?? []).map((s) => s.user_id));
    return was.size !== staffIds.length || staffIds.some((id) => !was.has(id));
  }, [staff.data, staffIds]);
  const options = useMemo<SearchableSelectOption[]>(
    () =>
      (staffOptions.data ?? [])
        .filter((o) => !staffIds.includes(o.user_id))
        .map((o) => ({ value: o.user_id, label: o.full_name, description: o.role })),
    [staffOptions.data, staffIds],
  );
  const nameOf = (id: string) =>
    staff.data?.find((s) => s.user_id === id)?.full_name ?? staffOptions.data?.find((o) => o.user_id === id)?.full_name ?? "Staff";

  const submit = () => {
    if (!valid || pending) return;
    const patch = {
      registration_fee_rupees: Math.round(feeN),
      admission_number_prefix: prefix.trim() || null,
      next_admission_seq: seqN,
      enquiry_form_enabled: formOn,
      document_checklist: checklist,
      form_schema: normalizeFormSchema(schema),
    };
    save.mutate(
      { institutionId, patch },
      {
        onSuccess: () => {
          if (staffChanged) saveStaff.mutate({ institutionId, userIds: staffIds }, { onSuccess: () => onOpenChange(false) });
          else onOpenChange(false);
        },
      },
    );
  };

  const addDoc = () => {
    const label = newDoc.trim();
    if (!label) return;
    setChecklist((list) => [...list, { key: keyFor(label, new Set(list.map((d) => d.key))), label }]);
    setNewDoc("");
  };

  const removeRow = (label: string, onClick: () => void) => (
    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-ink-500" aria-label={`Remove ${label}`} onClick={onClick}>
      <X className="h-4 w-4" aria-hidden="true" />
    </Button>
  );

  return (
    <MobileSheet
      open={open}
      onOpenChange={(next) => !pending && onOpenChange(next)}
      title="Admissions settings"
      subtitle="How this school runs admissions"
      icon={<Settings2 className="h-5 w-5" />}
      desktopWidth="lg"
      primaryAction={{ label: "Save settings", onClick: submit, loading: pending, disabled: !valid || pending || !settings }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false), disabled: pending }}
    >
      <div className="space-y-4 p-4">
        <SectionCard icon={<Receipt />} tone="mint" title="Registration fee" hint="What the desk collects to register a child">
          <Field label="Default amount" htmlFor="set-fee">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-500">Rs</span>
              <Input id="set-fee" type="number" inputMode="numeric" min={0} step={1} value={fee} onChange={(e) => setFee(e.target.value)} className="pl-9 font-semibold tabular-nums" />
            </div>
          </Field>
        </SectionCard>

        <SectionCard icon={<Hash />} tone="teal" title="Admission numbers" hint="Auto from a prefix; the desk can still change one on the form">
          <Field label="Prefix" htmlFor="set-prefix">
            <Input id="set-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="2026/" autoComplete="off" />
          </Field>
          <Field label="Next number" htmlFor="set-seq">
            <Input id="set-seq" type="number" inputMode="numeric" min={1} step={1} value={nextSeq} onChange={(e) => setNextSeq(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm text-ink-700 ring-1 ring-inset ring-surface-stroke">
              {preview ? (
                <>
                  The next admission will be <span className="font-semibold tabular-nums text-ink-900">{preview}</span>.
                </>
              ) : (
                "Without a prefix the desk types every admission number by hand."
              )}
            </p>
          </div>
        </SectionCard>

        <SectionCard icon={<ClipboardList />} tone="peach" title="Certificates to collect" hint="Ticked one by one at admission; unticked ones show as pending">
          <div className="space-y-3 sm:col-span-2">
            <ul className="divide-y divide-surface-stroke overflow-hidden rounded-xl border border-surface-stroke" data-checklist-editor="">
              {checklist.map((d) => (
                <li key={d.key} className="flex items-center gap-2 px-3 py-2 text-sm text-ink-900">
                  <span className="min-w-0 flex-1 truncate">{d.label}</span>
                  {removeRow(d.label, () => setChecklist((list) => list.filter((x) => x.key !== d.key)))}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Input
                value={newDoc}
                onChange={(e) => setNewDoc(e.target.value)}
                placeholder="Add a certificate"
                aria-label="Add a certificate"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addDoc();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addDoc} disabled={!newDoc.trim()}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Add
              </Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard icon={<ListChecks />} tone="rose" title="Your own questions" hint="What else to ask parents, beyond name, class and phone">
          <div className="sm:col-span-2">
            <FormDesigner value={schema} onChange={setSchema} />
          </div>
        </SectionCard>

        <SectionCard icon={<UserCog />} tone="violet" title="Admissions staff" hint="School admins always have access; name the receptionist here">
          <div className="space-y-3 sm:col-span-2">
            {staff.isError ? (
              <p className="text-sm text-ink-600">Couldn't load the staff list. Close and reopen this sheet.</p>
            ) : (
              <>
                {staffIds.length > 0 && (
                  <ul className="divide-y divide-surface-stroke overflow-hidden rounded-xl border border-surface-stroke" data-staff-list="">
                    {staffIds.map((id) => (
                      <li key={id} className="flex items-center gap-2 px-3 py-2 text-sm text-ink-900">
                        <span className="min-w-0 flex-1 truncate">{nameOf(id)}</span>
                        {removeRow(nameOf(id), () => setStaffIds((ids) => ids.filter((x) => x !== id)))}
                      </li>
                    ))}
                  </ul>
                )}
                <SearchableSelect
                  value=""
                  onValueChange={(id) => id && setStaffIds((ids) => (ids.includes(id) ? ids : [...ids, id]))}
                  options={options}
                  placeholder={staffOptions.isLoading ? "Loading staff…" : "Add a staff member"}
                  searchPlaceholder="Search staff"
                  emptyText="No staff matches."
                  disabled={staffOptions.isLoading}
                />
              </>
            )}
          </div>
        </SectionCard>

        <SectionCard icon={<Globe />} tone="sky" title="Online enquiry form" hint="The link parents use from the website or a poster">
          <div className="flex items-center justify-between gap-3 sm:col-span-2">
            <Label htmlFor="set-form" className="text-sm text-ink-900">
              Parents can enquire from the school's link
            </Label>
            <Switch id="set-form" checked={formOn} onCheckedChange={setFormOn} />
          </div>
        </SectionCard>
      </div>
    </MobileSheet>
  );
}
