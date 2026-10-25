import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarCheck,
  CalendarPlus,
  Clock,
  FileText,
  Pencil,
  Users,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MobileSheet } from "@/components/shared/sheets";
import { ScopePicker, type ScopeValue } from "./ScopePicker";
import { PTMScopeChips } from "./PTMScopeChips";
import { FormSection, SettingRow } from "./formParts";
import { DURATIONS, EDIT_WINDOWS, bookingClosesNote, withCurrent } from "./formOptions";
import { PTM_DEFAULTS, ptmBookingWindowOpen, timeToMinutes, type PTMHat } from "@/lib/ptm";
import {
  useCreatePTM,
  usePTMManageableScope,
  useUpdatePTM,
  type PTMSchedule,
} from "@/hooks/ptm";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string;
  hat: PTMHat;
  /** Editing an existing PTM; scope is immutable then. */
  ptm?: PTMSchedule | null;
  onSaved?: (ptmId: string) => void;
}

interface FormState {
  title: string;
  description: string;
  venue: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  slotBookingEnabled: boolean;
  slotDurationMinutes: number;
  bookingCutoffMinutes: number;
  feedbackEditDays: number;
}

// DURATIONS, EDIT_WINDOWS, bookingClosesNote and withCurrent live in
// ./formOptions since 2026-10-03, shared with the residential form.

function emptyForm(): FormState {
  return {
    title: "",
    description: "",
    venue: "",
    scheduledDate: "",
    startTime: "",
    endTime: "",
    slotBookingEnabled: false,
    slotDurationMinutes: PTM_DEFAULTS.slotDurationMinutes,
    bookingCutoffMinutes: PTM_DEFAULTS.bookingCutoffMinutes,
    feedbackEditDays: PTM_DEFAULTS.feedbackEditDays,
  };
}

function formFrom(ptm: PTMSchedule): FormState {
  return {
    title: ptm.title,
    description: ptm.description ?? "",
    venue: ptm.venue ?? "",
    scheduledDate: ptm.scheduled_date,
    startTime: ptm.start_time.slice(0, 5),
    endTime: ptm.end_time.slice(0, 5),
    slotBookingEnabled: ptm.slot_booking_enabled,
    slotDurationMinutes: ptm.slot_duration_minutes,
    bookingCutoffMinutes: ptm.booking_cutoff_minutes,
    feedbackEditDays: ptm.feedback_edit_days,
  };
}

/**
 * Create or edit a PTM. Scope is chosen once, at creation: changing who a
 * meeting is for after families have been notified and have booked is a
 * cancel-and-recreate, and the server enforces that too.
 */
export function PTMFormSheet({ open, onOpenChange, institutionId, hat, ptm, onSaved }: Props) {
  const isEdit = !!ptm;
  const [form, setForm] = useState<FormState>(emptyForm);
  const [scope, setScope] = useState<ScopeValue>({ scopeType: "school", wingId: null, classIds: [] });
  const [dirty, setDirty] = useState(false);

  const manageable = usePTMManageableScope(hat, open && !isEdit);
  const createPTM = useCreatePTM();
  const updatePTM = useUpdatePTM();
  const pending = createPTM.isPending || updatePTM.isPending;

  // Reset when the sheet OPENS, so a cancelled edit never leaks into the
  // next one. Only on the opening: a refetch of `ptm` while the sheet is up
  // (another admin's edit, a window refocus) must not wipe what is typed.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setForm(ptm ? formFrom(ptm) : emptyForm());
      setDirty(false);
    }
    wasOpen.current = open;
  }, [open, ptm]);

  // Default the scope to the widest thing this hat may target, once per
  // opening: a background refetch of the scope must not wipe a half-made
  // class selection.
  const scopeDefaulted = useRef(false);
  useEffect(() => {
    if (!open) {
      scopeDefaulted.current = false;
      return;
    }
    if (isEdit || !manageable.data || scopeDefaulted.current) return;
    scopeDefaulted.current = true;
    const s = manageable.data;
    const scopeType = s.can_school ? "school" : s.wings.length > 0 ? "wing" : "class";
    setScope({ scopeType, wingId: null, classIds: [] });
  }, [open, isEdit, manageable.data]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setDirty(true);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const timeError = useMemo(() => {
    if (!form.startTime || !form.endTime) return null;
    const start = timeToMinutes(form.startTime);
    const end = timeToMinutes(form.endTime);
    if (end <= start) return "The end time must be after the start time.";
    if (form.slotBookingEnabled && end - start < form.slotDurationMinutes) {
      return "The meeting is shorter than one slot.";
    }
    return null;
  }, [form.startTime, form.endTime, form.slotBookingEnabled, form.slotDurationMinutes]);

  // Slot booking on a meeting whose booking cutoff has already passed opens
  // with booking closed, so no family can ever book (the server refuses).
  // Checked on a new PTM, and on an edit only when slot booking is switched
  // on or the start moves, so fixing a venue mid-meeting is never blocked.
  // Browser time, like ptmBookingWindowOpen (CLAUDE.md 24).
  const bookingError = useMemo(() => {
    if (!form.slotBookingEnabled || !form.scheduledDate || !form.startTime || !form.endTime) return null;
    const touchesBooking =
      !ptm ||
      !ptm.slot_booking_enabled ||
      form.scheduledDate !== ptm.scheduled_date ||
      form.startTime !== ptm.start_time.slice(0, 5);
    if (!touchesBooking) return null;
    const open = ptmBookingWindowOpen({
      scheduled_date: form.scheduledDate,
      start_time: form.startTime,
      end_time: form.endTime,
      status: "scheduled",
      booking_cutoff_minutes: form.bookingCutoffMinutes,
    });
    if (open) return null;
    // Shown right under bookingClosesNote(), so it follows on from it.
    return "With this start time booking has already closed, so no family could book a slot. Start the meeting later, or turn slot booking off.";
  }, [ptm, form.slotBookingEnabled, form.scheduledDate, form.startTime, form.endTime, form.bookingCutoffMinutes]);

  const scopeError = useMemo(() => {
    if (isEdit) return null;
    if (!manageable.data) return "Loading";
    if (scope.scopeType === "wing" && !scope.wingId) return "Choose a wing.";
    if (scope.scopeType === "class" && scope.classIds.length === 0) return "Choose at least one class.";
    return null;
  }, [isEdit, manageable.data, scope]);

  const durationOptions = withCurrent(
    DURATIONS.map((d) => ({ value: d, label: `${d} minutes` })),
    form.slotDurationMinutes,
    (v) => ({ value: v, label: `${v} minutes` }),
  );
  const editWindowOptions = withCurrent(EDIT_WINDOWS, form.feedbackEditDays, (v) => ({
    value: v,
    label: `${v} ${v === 1 ? "day" : "days"} after it ends`,
  }));

  const canSubmit =
    !pending &&
    form.title.trim().length > 0 &&
    !!form.scheduledDate &&
    !!form.startTime &&
    !!form.endTime &&
    !timeError &&
    !bookingError &&
    !scopeError;

  const submit = () => {
    if (!canSubmit) return;
    if (isEdit && ptm) {
      updatePTM.mutate(
        { ptmId: ptm.id, ...form },
        {
          onSuccess: () => {
            onSaved?.(ptm.id);
            onOpenChange(false);
          },
        },
      );
      return;
    }
    createPTM.mutate(
      {
        institutionId,
        hat,
        ...form,
        scopeType: scope.scopeType,
        scopeWingId: scope.wingId,
        classIds: scope.classIds,
      },
      {
        onSuccess: (id) => {
          onSaved?.(id);
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit PTM" : "Schedule a PTM"}
      subtitle={isEdit ? ptm?.title : "Families and teachers are notified when you save"}
      icon={isEdit ? <Pencil className="h-5 w-5" /> : <CalendarPlus className="h-5 w-5" />}
      desktopWidth="md"
      primaryAction={{
        label: isEdit ? "Save changes" : "Schedule PTM",
        onClick: submit,
        loading: pending,
        disabled: !canSubmit,
      }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false), disabled: pending }}
    >
      {/* data-dirty keeps the service worker from reloading a half-filled
          form under the user (CLAUDE.md section 17). Sections sit flat on
          the sheet, split by hairlines and coloured headings: bordered
          cards on a tinted floor read as a box inside a box (Naman,
          2026-09-29). */}
      <form
        data-dirty={dirty ? "true" : undefined}
        className="divide-y divide-surface-stroke"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormSection icon={<FileText />} tone="teal" title="Details">
          <div className="space-y-1.5">
            <Label htmlFor="ptm-title">Title</Label>
            <Input
              id="ptm-title"
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
              placeholder="e.g. Term 1 PTM"
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ptm-description">Description</Label>
            <Textarea
              id="ptm-description"
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              placeholder="Optional. What families should bring or expect."
              rows={2}
              maxLength={1000}
              className="min-h-16"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ptm-venue">Venue</Label>
            <Input
              id="ptm-venue"
              value={form.venue}
              onChange={(e) => update("venue", e.target.value)}
              placeholder="Optional. e.g. Main hall, ground floor"
              maxLength={120}
            />
          </div>
        </FormSection>

        <FormSection icon={<Users />} tone="violet" title="Who it is for">
          {isEdit && ptm ? (
            <div className="space-y-1.5">
              <PTMScopeChips
                scopeType={ptm.scope_type}
                wingName={ptm.scope_wing_name}
                classes={ptm.classes}
                max={6}
              />
              <p className="text-xs text-ink-500">
                To change who it is for, cancel this PTM and schedule a new one.
              </p>
            </div>
          ) : (
            <ScopePicker
              scope={manageable.data}
              isLoading={manageable.isLoading}
              isError={manageable.isError}
              value={scope}
              onChange={(next) => {
                setDirty(true);
                setScope(next);
              }}
            />
          )}
        </FormSection>

        <FormSection icon={<Clock />} tone="sky" title="When">
          {/* One row from sm up; on a phone the date takes the full width
              and the two times share the row below it. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="col-span-2 space-y-1.5 sm:col-span-1">
              <Label htmlFor="ptm-date">Date</Label>
              <Input
                id="ptm-date"
                type="date"
                value={form.scheduledDate}
                onChange={(e) => update("scheduledDate", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ptm-start">Starts</Label>
              <Input
                id="ptm-start"
                type="time"
                value={form.startTime}
                onChange={(e) => update("startTime", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ptm-end">Ends</Label>
              <Input
                id="ptm-end"
                type="time"
                value={form.endTime}
                onChange={(e) => update("endTime", e.target.value)}
              />
            </div>
          </div>
          {timeError && <p className="text-sm text-rose-600 dark:text-rose-400">{timeError}</p>}
        </FormSection>

        <FormSection icon={<CalendarCheck />} tone="peach" title="Booking and feedback">
          <SettingRow
            htmlFor="ptm-slots"
            title="Slot booking"
            description="Families pick a time to meet the teachers. One family per slot per class."
            control={
              <Switch
                id="ptm-slots"
                checked={form.slotBookingEnabled}
                onCheckedChange={(checked) => update("slotBookingEnabled", checked)}
              />
            }
          />

          {form.slotBookingEnabled && (
            <div className="space-y-2">
              <Label id="ptm-duration-label">Slot length</Label>
              {/* One tap instead of a dropdown; equal columns for however
                  many options there are (an older PTM may add its own). */}
              <ToggleGroup
                type="single"
                aria-labelledby="ptm-duration-label"
                value={String(form.slotDurationMinutes)}
                onValueChange={(v) => {
                  // Radix sends "" when the chosen item is tapped again.
                  if (v) update("slotDurationMinutes", Number(v));
                }}
                className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-muted/70 p-1"
              >
                {durationOptions.map((d) => (
                  <ToggleGroupItem
                    key={d.value}
                    value={String(d.value)}
                    aria-label={d.label}
                    className="h-9 px-0 text-ink-600 hover:bg-surface-card hover:text-ink-900 data-[state=on]:bg-brand-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-card-sm"
                  >
                    {d.value} min
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="text-xs text-ink-500">
                {bookingClosesNote(form.bookingCutoffMinutes)}
                {isEdit && ptm?.slot_booking_enabled && form.slotDurationMinutes !== ptm.slot_duration_minutes &&
                  " Slot length can only change while no family has booked."}
              </p>
              {bookingError && (
                <p className="text-sm text-rose-600 dark:text-rose-400">{bookingError}</p>
              )}
            </div>
          )}

          <div className="space-y-3 border-t border-dashed border-surface-stroke pt-3">
            <SettingRow
              htmlFor="ptm-edit-window"
              title="Feedback stays open"
              description="Feedback opens when the meeting starts. A family can edit theirs until it closes."
            />
            <Select
              value={String(form.feedbackEditDays)}
              onValueChange={(v) => update("feedbackEditDays", Number(v))}
            >
              <SelectTrigger id="ptm-edit-window">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {editWindowOptions.map((w) => (
                  <SelectItem key={w.value} value={String(w.value)}>
                    {w.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </FormSection>
      </form>
    </MobileSheet>
  );
}
