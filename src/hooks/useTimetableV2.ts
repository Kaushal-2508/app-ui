// =============================================================
// useTimetableV2 — hooks for the rebuilt timetable (tt_* schema).
// Parallel to the legacy useTimetableBuilder during Plan 2 dev.
// Consumed by /school/timetable-v2 (read-only class list first;
// write paths land in follow-up slices).
// =============================================================

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { useUserRole } from "@/hooks/useUserRole";
import { useIsTimetableManager } from "@/hooks/useIsTimetableManager";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { compareClassNames } from "@/lib/classSort";
import { useAuth } from "@/hooks/useAuth";
import {
  invalidateSubstitutionCaches,
  localISODate,
  notifySubstituteAssigned,
} from "@/lib/substitutions";

export type PublishStatus = "draft" | "published";

export interface ClassListV2Row {
  classId: string;
  className: string;
  section: string | null;
  wingId: string | null;
  structureId: string | null;
  structureName: string | null;
  publishStatus: PublishStatus | null;   // null ⇒ no structure assigned (Empty)
  filledCount: number;                   // non-break cells with any slot_type set
  requiredCount: number;                 // working_days × non-break period_slots
  lastEditedAt: string | null;
  lastEditedBy: string | null;           // profile name if we can resolve it
}

interface ClassRow {
  id: string;
  name: string;
  section: string | null;
  academic_year: string;
  is_active: boolean;
}

interface CsRow {
  class_id: string;
  structure_id: string;
  publish_status: PublishStatus;
  academic_year: string;
  structure: { id: string; name: string; working_days: string[] } | null;
}

interface SlotCountRow {
  class_id: string;
  period_slot_id: string;
}

interface StructureSlotCountRow {
  structure_id: string;
  kind: string;
  days: string[] | null;
}

/**
 * Class-list home view for /school/timetable-v2.
 * Returns one row per class in scope, with publish status + fill
 * percentage + last edit metadata derived from tt_slots.
 *
 * `restrictToWingIds`: when non-null, the class set is filtered to ONLY
 * those wings — even when `wingId` (the per-page dropdown filter) is null.
 * Used by `TimetablePageV2` to scope coordinators to their assigned wings;
 * admins should pass `null` here so they see every wing.
 */
export function useClassListV2(
  academicYear: string,
  wingId: string | null,
  restrictToWingIds: string[] | null = null,
) {
  const { institutionId } = useEffectiveInstitution();
  const { data: roleInfo } = useUserRole();
  // tt_manager_overrides grant ⇒ institution-wide scope, same as an admin.
  const { isTimetableManager } = useIsTimetableManager();
  const isAdmin = !!(roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin) || isTimetableManager;
  const isCoordinator = !!roleInfo?.isCoordinator;
  const restrictKey = restrictToWingIds ? [...restrictToWingIds].sort().join(",") : null;

  return useQuery({
    queryKey: ["timetable-v2", "class-list", institutionId, academicYear, wingId, isCoordinator, restrictKey],
    enabled: !!institutionId && !!academicYear && (isAdmin || isCoordinator),
    queryFn: async (): Promise<ClassListV2Row[]> => {
      // 1. Classes in scope (institution + year). Wing filter is
      //    applied AFTER we join wing_class_mappings, since `classes`
      //    has no wing_id column — the mapping table is authoritative.
      const { data: classesData, error: classesErr } = await supabase
        .from("classes")
        .select("id, name, section, academic_year, is_active")
        .eq("institution_id", institutionId!)
        .eq("academic_year", academicYear)
        .eq("is_active", true);
      if (classesErr) throw classesErr;
      const allClasses = (classesData ?? []) as ClassRow[];
      if (allClasses.length === 0) return [];

      const allClassIds = allClasses.map((c) => c.id);

      // 2. Wing mapping join — pulls wing_id per class.
      const { data: mappingRows, error: mapErr } = await supabase
        .from("wing_class_mappings")
        .select("class_id, wing_id")
        .in("class_id", allClassIds);
      if (mapErr) throw mapErr;
      const wingByClass = new Map<string, string | null>();
      for (const m of (mappingRows ?? []) as { class_id: string; wing_id: string }[]) {
        wingByClass.set(m.class_id, m.wing_id);
      }

      // 3. Apply wing filters client-side. The `restrictToWingIds` set is
      //    the hard scope (used to pin coordinators to their wings); the
      //    `wingId` dropdown is a UI filter on top. Both must agree.
      const restrictSet = restrictToWingIds ? new Set(restrictToWingIds) : null;
      const classes = allClasses.filter((c) => {
        const w = wingByClass.get(c.id) ?? null;
        if (restrictSet && (w === null || !restrictSet.has(w))) return false;
        if (wingId && w !== wingId) return false;
        return true;
      });
      if (classes.length === 0) return [];

      const classIds = classes.map((c) => c.id);

      // 2. Class → structure mapping for this year (with publish_status).
      const { data: csData, error: csErr } = await supabase
        .from("tt_class_structure" as never)
        .select("class_id, structure_id, publish_status, academic_year, structure:tt_period_structures!tt_class_structure_structure_id_fkey(id, name, working_days)")
        .in("class_id", classIds)
        .eq("academic_year", academicYear);
      if (csErr) throw csErr;
      const csByClass = new Map<string, CsRow>();
      for (const row of (csData ?? []) as unknown as CsRow[]) {
        csByClass.set(row.class_id, row);
      }

      // 3. Slot counts + latest edit per class, aggregated SERVER-SIDE.
      //    This used to select every tt_slots row for the year and count them
      //    on the client. PostgREST silently caps at 1000 rows and both live
      //    schools are past it (1484 and 1129 rows), so whichever classes fell
      //    beyond the cap reported "0 / N cells filled" and read as never set
      //    up. CLAUDE.md section 23: never fetch rows to count them.
      type FillArgs = { _class_ids: string[]; _academic_year: string };
      const { data: fillData, error: fillErr } = await (
        supabase.rpc as unknown as (
          fn: "tt_class_fill_counts",
          args: FillArgs,
        ) => Promise<{ data: unknown; error: { message: string } | null }>
      )("tt_class_fill_counts", { _class_ids: classIds, _academic_year: academicYear });
      if (fillErr) throw fillErr;
      type FillRow = { class_id: string; filled: number; last_edit: string | null };
      const filledByClass = new Map<string, number>();
      const lastEditByClass = new Map<string, string>();
      for (const row of (fillData ?? []) as unknown as FillRow[]) {
        filledByClass.set(row.class_id, row.filled);
        if (row.last_edit) lastEditByClass.set(row.class_id, row.last_edit);
      }

      // 4. Required cell counts per structure. With per-day overrides each day
      // can have its own period count, so we sum the count over working_days
      // instead of multiplying. Override slots (days != null) replace the
      // default schedule for the days they list — never additive.
      const structureIds = Array.from(
        new Set(
          ((csData ?? []) as unknown as CsRow[])
            .map((r) => r.structure_id)
            .filter((id): id is string => !!id),
        ),
      );
      const slotsByStructure = new Map<string, StructureSlotCountRow[]>();
      if (structureIds.length > 0) {
        const { data: psData, error: psErr } = await supabase
          .from("tt_period_slots" as never)
          .select("structure_id, kind, days")
          .in("structure_id", structureIds);
        if (psErr) throw psErr;
        for (const row of (psData ?? []) as unknown as StructureSlotCountRow[]) {
          if (!slotsByStructure.has(row.structure_id)) slotsByStructure.set(row.structure_id, []);
          slotsByStructure.get(row.structure_id)!.push(row);
        }
      }

      // Required cells = Σ(over working_days) of period-slot count for that day.
      const requiredCellsForStructure = (
        rows: StructureSlotCountRow[] | undefined,
        workingDays: string[],
      ): number => {
        if (!rows || workingDays.length === 0) return 0;
        let total = 0;
        for (const day of workingDays) {
          const overrides = rows.filter((r) => r.kind === "period" && r.days !== null && r.days.includes(day));
          if (overrides.length > 0) {
            total += overrides.length;
          } else {
            total += rows.filter((r) => r.kind === "period" && r.days === null).length;
          }
        }
        return total;
      };

      // 5. Assemble.
      return classes
        .map((c): ClassListV2Row => {
          const cs = csByClass.get(c.id) ?? null;
          const structure = cs?.structure ?? null;
          const required = cs
            ? requiredCellsForStructure(slotsByStructure.get(cs.structure_id), structure?.working_days ?? [])
            : 0;
          return {
            classId: c.id,
            className: c.name,
            section: c.section,
            wingId: wingByClass.get(c.id) ?? null,
            structureId: cs?.structure_id ?? null,
            structureName: structure?.name ?? null,
            publishStatus: cs?.publish_status ?? null,
            filledCount: filledByClass.get(c.id) ?? 0,
            requiredCount: required,
            lastEditedAt: lastEditByClass.get(c.id) ?? null,
            lastEditedBy: null,  // left for a follow-up slice (join to profiles)
          };
        })
        .sort((a, b) => {
          const byName = compareClassNames(a.className, b.className);
          if (byName !== 0) return byName;
          return (a.section ?? "").localeCompare(b.section ?? "");
        });
    },
  });
}

/**
 * Active (or fallback) academic year codes for the AY selector.
 * Reads cal_academic_years when populated; returns an empty list
 * if the institution hasn't opted into explicit AY rows yet
 * (callers fall back to the legacy date-based heuristic).
 */
export function useCalAcademicYears() {
  const { institutionId } = useEffectiveInstitution();

  return useQuery({
    queryKey: ["cal-academic-years", institutionId],
    enabled: !!institutionId,
    queryFn: async (): Promise<{ code: string; isActive: boolean }[]> => {
      const { data, error } = await supabase
        .from("cal_academic_years" as never)
        .select("code, is_active")
        .eq("institution_id", institutionId!)
        .order("code", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as { code: string; is_active: boolean }[]).map((r) => ({
        code: r.code,
        isActive: r.is_active,
      }));
    },
  });
}

/**
 * Wings accessible to the calling user for the Timetable v2 scope.
 * Admin sees all wings in their institution; coordinator sees only
 * wings they're assigned to. Mirrors the legacy pattern — returns
 * an empty list for roles that shouldn't see a wing picker.
 */
export function useTimetableV2Wings() {
  const { institutionId } = useEffectiveInstitution();
  const { data: roleInfo } = useUserRole();
  // tt_manager_overrides grant ⇒ institution-wide scope, same as an admin.
  const { isTimetableManager } = useIsTimetableManager();
  const isAdmin = !!(roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin) || isTimetableManager;
  const isCoordinator = !!roleInfo?.isCoordinator;

  return useQuery({
    queryKey: ["timetable-v2", "wings", institutionId, isAdmin, isCoordinator],
    enabled: !!institutionId && (isAdmin || isCoordinator),
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      if (isAdmin) {
        const { data, error } = await supabase
          .from("wings")
          .select("id, name")
          .eq("institution_id", institutionId!)
          .order("name");
        if (error) throw error;
        return (data ?? []) as { id: string; name: string }[];
      }
      // Coordinator: only their assigned wings.
      const { data: assignments, error: aErr } = await supabase
        .from("wing_assignments")
        .select("wing_id, wings:wing_id(id, name)")
        .eq("user_id", (await supabase.auth.getUser()).data.user?.id ?? "");
      if (aErr) throw aErr;
      type Row = { wing_id: string; wings: { id: string; name: string } | null };
      return ((assignments ?? []) as unknown as Row[])
        .map((r) => r.wings)
        .filter((w): w is { id: string; name: string } => !!w)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

// =============================================================
// CLASS WORKSPACE — Slice B (grid + slot drawer + publish toggle)
// =============================================================

export type Weekday =
  | "monday" | "tuesday" | "wednesday" | "thursday"
  | "friday" | "saturday" | "sunday";

export type SlotType =
  | "theory" | "practical" | "library" | "sports"
  | "arts"   | "assembly"  | "free"    | "break"
  | "other";

export interface PeriodSlotV2 {
  id: string;
  period_number: number;
  label: string;
  start_time: string;
  end_time: string;
  kind: "period" | "break";
  /** NULL = applies to every working day. Non-null = applies only to those
   *  days, and any day listed here switches that day to override-mode. */
  days: Weekday[] | null;
}

export interface PeriodStructureV2 {
  id: string;
  name: string;
  working_days: Weekday[];
  slots: PeriodSlotV2[];
}

/**
 * Read-side slot resolver. For day D, returns the override slots when D has
 * any (`days` array contains D); otherwise the default slots (`days === null`).
 * This mirrors the dialog's mental model: a day either uses defaults or has
 * its own custom schedule — never a merge of the two.
 */
export function slotsForDay(slots: PeriodSlotV2[], day: Weekday): PeriodSlotV2[] {
  const overrides = slots.filter((s) => s.days !== null && s.days.includes(day));
  if (overrides.length > 0) return overrides;
  return slots.filter((s) => s.days === null);
}

export interface ResolvedSlotV2 {
  id: string;
  class_id: string;
  period_slot_id: string;
  day: Weekday;
  academic_year: string;
  slot_type: SlotType;
  subject_id: string | null;
  teacher_id: string | null;
  resource_id: string | null;
  notes: string | null;
  custom_label: string | null;
  subject_name: string | null;
  teacher_name: string | null;
  /** Optional band cell — each student sees their own enrolled optional here. (Legacy, superseded by optional_group_id.) */
  is_optional_band?: boolean;
  /** When set, this cell hosts the optional group's subjects in parallel. */
  optional_group_id?: string | null;
  optional_group_name?: string | null;
}

export interface ClassWorkspaceData {
  structureId: string | null;
  structure: PeriodStructureV2 | null;
  publishStatus: "draft" | "published" | null;
  slots: ResolvedSlotV2[];
}

/** Loads the class's period structure, period slots, and tt_slots. */
export function useClassWorkspaceV2(classId: string | null, academicYear: string) {
  return useQuery({
    queryKey: ["timetable-v2", "workspace", classId, academicYear],
    enabled: !!classId && !!academicYear,
    queryFn: async (): Promise<ClassWorkspaceData> => {
      const { data: csRow, error: csErr } = await supabase
        .from("tt_class_structure" as never)
        .select("structure_id, publish_status")
        .eq("class_id", classId!)
        .eq("academic_year", academicYear)
        .maybeSingle();
      if (csErr) throw csErr;
      const cs = csRow as { structure_id: string; publish_status: "draft" | "published" } | null;
      if (!cs) {
        return { structureId: null, structure: null, publishStatus: null, slots: [] };
      }

      const { data: structureRow, error: sErr } = await supabase
        .from("tt_period_structures" as never)
        .select("id, name, working_days")
        .eq("id", cs.structure_id)
        .maybeSingle();
      if (sErr) throw sErr;
      const { data: periodSlotsData, error: psErr } = await supabase
        .from("tt_period_slots" as never)
        .select("id, period_number, label, start_time, end_time, kind, days")
        .eq("structure_id", cs.structure_id)
        .order("period_number", { ascending: true });
      if (psErr) throw psErr;

      const structure: PeriodStructureV2 | null = structureRow
        ? {
            id: (structureRow as { id: string }).id,
            name: (structureRow as { name: string }).name,
            working_days: ((structureRow as { working_days: string[] }).working_days ?? []) as Weekday[],
            slots: ((periodSlotsData ?? []) as unknown as PeriodSlotV2[]).sort(
              (a, b) => a.start_time.localeCompare(b.start_time),
            ),
          }
        : null;

      const { data: slotRows, error: slotErr } = await supabase
        .from("tt_slots" as never)
        .select(
          "id, class_id, period_slot_id, day, academic_year, slot_type, subject_id, teacher_id, resource_id, notes, custom_label, is_optional_band, optional_group_id, optional_group:optional_groups!tt_slots_optional_group_id_fkey(id, name), subject:universal_subjects!tt_slots_subject_id_fkey(id, name), teacher:profiles!tt_slots_teacher_id_fkey(id, full_name)",
        )
        .eq("class_id", classId!)
        .eq("academic_year", academicYear);
      if (slotErr) throw slotErr;
      type SlotRaw = {
        id: string;
        class_id: string;
        period_slot_id: string;
        day: Weekday;
        academic_year: string;
        slot_type: SlotType;
        subject_id: string | null;
        teacher_id: string | null;
        resource_id: string | null;
        notes: string | null;
        custom_label: string | null;
        is_optional_band: boolean | null;
        optional_group_id: string | null;
        optional_group: { id: string; name: string } | null;
        subject: { id: string; name: string } | null;
        teacher: { id: string; full_name: string | null } | null;
      };
      const slots: ResolvedSlotV2[] = ((slotRows ?? []) as unknown as SlotRaw[]).map((r) => ({
        id: r.id,
        class_id: r.class_id,
        period_slot_id: r.period_slot_id,
        day: r.day,
        academic_year: r.academic_year,
        slot_type: r.slot_type,
        subject_id: r.subject_id,
        teacher_id: r.teacher_id,
        resource_id: r.resource_id,
        notes: r.notes,
        custom_label: r.custom_label,
        subject_name: r.subject?.name ?? null,
        teacher_name: r.teacher?.full_name ?? null,
        is_optional_band: r.is_optional_band ?? false,
        optional_group_id: r.optional_group_id,
        optional_group_name: r.optional_group?.name ?? null,
      }));

      return {
        structureId: cs.structure_id,
        structure,
        publishStatus: cs.publish_status,
        slots,
      };
    },
  });
}

export interface SubjectOption { id: string; name: string }

export function useSubjectsForClassV2(classId: string | null) {
  const { institutionId } = useEffectiveInstitution();
  return useQuery({
    queryKey: ["timetable-v2", "subjects-for-class", institutionId, classId],
    enabled: !!institutionId && !!classId,
    queryFn: async (): Promise<SubjectOption[]> => {
      const { data, error } = await supabase
        .from("subject_class_mappings")
        .select("subject_id, universal_subjects:universal_subjects(id, name)")
        .eq("institution_id", institutionId!)
        .eq("class_id", classId!);
      if (error) throw error;
      type Row = { subject_id: string; universal_subjects: { id: string; name: string } | null };
      return ((data ?? []) as Row[])
        .map((r) => r.universal_subjects)
        .filter((s): s is NonNullable<typeof s> => !!s)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

export interface TeacherOption { id: string; full_name: string }

export function useTeachersForClassSubjectV2(classId: string | null, subjectId: string | null) {
  return useQuery({
    queryKey: ["timetable-v2", "teachers-for-class-subject", classId, subjectId],
    enabled: !!classId && !!subjectId,
    queryFn: async (): Promise<TeacherOption[]> => {
      const { data, error } = await supabase
        .from("class_assignments")
        .select("user_id, profiles:profiles!class_assignments_user_id_fkey(id, full_name)")
        .eq("class_id", classId!)
        .eq("subject_id", subjectId!)
        .eq("role", "teacher");
      if (error) throw error;
      type Row = { user_id: string; profiles: { id: string; full_name: string | null } | null };
      const seen = new Set<string>();
      const out: TeacherOption[] = [];
      for (const r of (data ?? []) as Row[]) {
        if (seen.has(r.user_id)) continue;
        seen.add(r.user_id);
        out.push({ id: r.user_id, full_name: r.profiles?.full_name ?? "Unnamed teacher" });
      }
      return out.sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
  });
}

export interface SaveTtSlotInput {
  id?: string;
  class_id: string;
  period_slot_id: string;
  day: Weekday;
  academic_year: string;
  slot_type: SlotType;
  subject_id: string | null;
  teacher_id: string | null;
  resource_id: string | null;
  notes: string | null;
  custom_label: string | null;
  is_optional_band?: boolean;
  optional_group_id?: string | null;
}

export function useSaveTtSlot(classId: string | null, academicYear: string) {
  const { institutionId } = useEffectiveInstitution();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveTtSlotInput) => {
      const { data, error } = await supabase
        .from("tt_slots" as never)
        .upsert(
          {
            ...(input.id ? { id: input.id } : {}),
            institution_id: institutionId!,
            class_id: input.class_id,
            period_slot_id: input.period_slot_id,
            day: input.day,
            academic_year: input.academic_year,
            slot_type: input.slot_type,
            subject_id: input.subject_id,
            teacher_id: input.teacher_id,
            resource_id: input.resource_id,
            notes: input.notes,
            custom_label: input.custom_label,
            is_optional_band: input.is_optional_band ?? false,
            optional_group_id: input.optional_group_id ?? null,
          } as never,
          { onConflict: "class_id,period_slot_id,day,academic_year" },
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "workspace", classId, academicYear] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "class-list"] });
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't save the slot.", context: "saveTtSlot" }),
  });
}

export function useDeleteTtSlot(classId: string | null, academicYear: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (slotId: string) => {
      const { error } = await supabase.from("tt_slots" as never).delete().eq("id", slotId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "workspace", classId, academicYear] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "class-list"] });
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't delete the slot.", context: "deleteTtSlot" }),
  });
}

// =============================================================
// TEACHER + STUDENT WEEK — Slice E (read-only views)
// =============================================================

export interface TeacherWeekSlot {
  id: string;
  day: Weekday;
  period_label: string;
  start_time: string;
  end_time: string;
  period_kind: "period" | "break";
  class_id: string;
  class_name: string;
  class_section: string | null;
  subject_id: string | null;
  subject_name: string | null;
  custom_label: string | null;
  slot_type: SlotType;
  notes: string | null;
  /** True when this period comes from an optional group (parallel electives).
      Lesson-plan capture is not offered for these yet — tt_lesson_plans is
      one row per slot per date and a group cell hosts N subjects. */
  isOptionalGroup?: boolean;
  optionalGroupName?: string | null;
}

/**
 * Teacher's own week — their assigned tt_slots across every class
 * they teach. Agenda-style (one row per slot, grouped by day) since
 * different classes can run different period structures.
 */
export function useTeacherWeekV2(academicYear: string) {
  return useQuery({
    queryKey: ["timetable-v2", "teacher-week", academicYear],
    enabled: !!academicYear,
    queryFn: async (): Promise<TeacherWeekSlot[]> => {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) return [];
      const { data, error } = await supabase
        .from("tt_slots" as never)
        .select(
          "id, day, slot_type, notes, custom_label, class_id, period_slot_id, " +
          "period:tt_period_slots!tt_slots_period_slot_id_fkey(id, label, start_time, end_time, kind), " +
          "class:classes!tt_slots_class_id_fkey(id, name, section), " +
          "subject:universal_subjects!tt_slots_subject_id_fkey(id, name)",
        )
        .eq("teacher_id", user.id)
        .eq("academic_year", academicYear);
      if (error) throw error;
      type Row = {
        id: string;
        day: Weekday;
        slot_type: SlotType;
        notes: string | null;
        custom_label: string | null;
        class_id: string;
        period_slot_id: string;
        period: { id: string; label: string; start_time: string; end_time: string; kind: "period" | "break" } | null;
        class: { id: string; name: string; section: string | null } | null;
        subject: { id: string; name: string } | null;
      };
      const rows = (data ?? []) as unknown as Row[];
      const owned: TeacherWeekSlot[] = rows
        .filter((r) => !!r.period && !!r.class)
        .map((r): TeacherWeekSlot => ({
          id: r.id,
          day: r.day,
          period_label: r.period!.label,
          start_time: r.period!.start_time,
          end_time: r.period!.end_time,
          period_kind: r.period!.kind,
          class_id: r.class!.id,
          class_name: r.class!.name,
          class_section: r.class!.section,
          subject_id: r.subject?.id ?? null,
          subject_name: r.subject?.name ?? null,
          custom_label: r.custom_label,
          slot_type: r.slot_type,
          notes: r.notes,
        }));

      // Optional-group periods: cells with no teacher_id where this teacher
      // teaches one of the group's subjects in that class. Resolved by a
      // SECURITY DEFINER RPC (the raw tt_slots row isn't teacher-readable).
      const { data: groupRows, error: gErr } = await supabase.rpc("my_teacher_optional_week", {
        _academic_year: academicYear,
      });
      if (gErr) throw gErr;
      type GroupRow = {
        slot_id: string; day: string; period_slot_id: string; period_label: string;
        start_time: string; end_time: string; period_kind: string;
        class_id: string; class_name: string; class_section: string | null;
        subject_id: string; subject_name: string; group_name: string; notes: string | null;
      };
      const ownedIds = new Set(owned.map((s) => s.id));
      const groupSlots: TeacherWeekSlot[] = ((groupRows ?? []) as unknown as GroupRow[])
        .filter((r) => !ownedIds.has(r.slot_id))
        .map((r): TeacherWeekSlot => ({
          id: r.slot_id,
          day: r.day as Weekday,
          period_label: r.period_label,
          start_time: r.start_time,
          end_time: r.end_time,
          period_kind: (r.period_kind === "break" ? "break" : "period"),
          class_id: r.class_id,
          class_name: r.class_name,
          class_section: r.class_section,
          subject_id: r.subject_id,
          subject_name: r.subject_name,
          custom_label: null,
          slot_type: "free",
          notes: r.notes,
          isOptionalGroup: true,
          optionalGroupName: r.group_name,
        }));

      return [...owned, ...groupSlots].sort((a, b) => {
        const dayOrder = dayIndex(a.day) - dayIndex(b.day);
        if (dayOrder !== 0) return dayOrder;
        return a.start_time.localeCompare(b.start_time);
      });
    },
  });
}

/**
 * Teacher timetable readiness — staged empty-state classifier so the
 * teacher's "Timetable" tab can show a specific notification depending on
 * what's outstanding instead of a generic "nothing here" message.
 *
 *   * `no-class-assignments` — admin hasn't put this teacher in any class yet
 *     (no `class_assignments` row with role='teacher').
 *   * `awaiting-admin` — teacher is in classes, but the admin hasn't
 *     published a `tt_class_structure` for any of them.
 *   * `awaiting-coordinator` — admin published a structure, but the
 *     coordinator hasn't assigned this teacher to any periods yet.
 *   * `ready` — there's at least one tt_slot keyed to this teacher and the
 *     class structure is published — show the agenda.
 */
export type TeacherTimetableStatus =
  | "no-class-assignments"
  | "awaiting-admin"
  | "awaiting-coordinator"
  | "ready";

export interface TeacherTimetableStatusResult {
  status: TeacherTimetableStatus;
  publishedClassCount: number;
}

export function useTeacherTimetableStatusV2(academicYear: string) {
  return useQuery({
    queryKey: ["timetable-v2", "teacher-status", academicYear],
    enabled: !!academicYear,
    queryFn: async (): Promise<TeacherTimetableStatusResult> => {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) {
        return { status: "no-class-assignments", publishedClassCount: 0 };
      }

      const { data: assignments, error: aErr } = await supabase
        .from("class_assignments")
        .select("class_id, classes!class_assignments_class_id_fkey(academic_year)")
        .eq("user_id", user.id)
        .eq("role", "teacher");
      if (aErr) throw aErr;
      type AssignRow = {
        class_id: string;
        classes: { academic_year: string } | null;
      };
      const yearAssignments = ((assignments ?? []) as unknown as AssignRow[])
        .filter((a) => a.classes?.academic_year === academicYear);
      if (yearAssignments.length === 0) {
        return { status: "no-class-assignments", publishedClassCount: 0 };
      }

      const classIds = Array.from(new Set(yearAssignments.map((a) => a.class_id)));
      const { data: csRows, error: csErr } = await supabase
        .from("tt_class_structure" as never)
        .select("class_id, publish_status")
        .in("class_id", classIds)
        .eq("academic_year", academicYear);
      if (csErr) throw csErr;
      const published = ((csRows ?? []) as unknown as { class_id: string; publish_status: string }[])
        .filter((r) => r.publish_status === "published");
      if (published.length === 0) {
        return { status: "awaiting-admin", publishedClassCount: 0 };
      }

      const { count, error: cErr } = await supabase
        .from("tt_slots" as never)
        .select("id", { count: "exact", head: true })
        .eq("teacher_id", user.id)
        .eq("academic_year", academicYear);
      if (cErr) throw cErr;
      if (!count || count === 0) {
        // A teacher whose only periods are optional-group cells owns no
        // tt_slots row (teacher_id is NULL there) — check before showing
        // the "awaiting coordinator" blocker.
        // Do NOT swallow this error: on failure the fall-through below states
        // "awaiting coordinator" as fact, which is a different claim from
        // "we could not check".
        const { data: groupRows, error: gErr } = await supabase.rpc(
          "my_teacher_optional_week",
          { _academic_year: academicYear },
        );
        if (gErr) throw gErr;
        if ((groupRows ?? []).length > 0) {
          return { status: "ready", publishedClassCount: published.length };
        }
        return { status: "awaiting-coordinator", publishedClassCount: published.length };
      }

      return { status: "ready", publishedClassCount: published.length };
    },
  });
}

export interface StudentWeekData {
  structure: PeriodStructureV2 | null;
  classId: string | null;
  className: string | null;
  classSection: string | null;
  publishStatus: "draft" | "published" | null;
  slots: ResolvedSlotV2[];
}

/**
 * Student's own week — the timetable for their enrolled class.
 * Returns the class's period structure + every tt_slots row for
 * that class. RLS scopes reads to published rows in classes where
 * the student has a class_assignments row with role='student'.
 */
export function useStudentWeekV2(academicYear: string) {
  return useQuery({
    queryKey: ["timetable-v2", "student-week", academicYear],
    enabled: !!academicYear,
    queryFn: async (): Promise<StudentWeekData> => {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) {
        return { structure: null, classId: null, className: null, classSection: null, publishStatus: null, slots: [] };
      }
      // Resolve which class this student belongs to for the AY.
      const { data: caRows, error: caErr } = await supabase
        .from("class_assignments")
        .select("class_id, classes:class_id(id, name, section, academic_year)")
        .eq("user_id", user.id)
        .eq("role", "student");
      if (caErr) throw caErr;
      type CaRow = { class_id: string; classes: { id: string; name: string; section: string | null; academic_year: string } | null };
      const match = ((caRows ?? []) as unknown as CaRow[])
        .find((r) => r.classes?.academic_year === academicYear);
      if (!match || !match.classes) {
        return { structure: null, classId: null, className: null, classSection: null, publishStatus: null, slots: [] };
      }
      const classId = match.classes.id;

      // Reuse the workspace fetcher shape for the structure + slots.
      const { data: csRow, error: csErr } = await supabase
        .from("tt_class_structure" as never)
        .select("structure_id, publish_status")
        .eq("class_id", classId)
        .eq("academic_year", academicYear)
        .maybeSingle();
      if (csErr) throw csErr;
      const cs = csRow as { structure_id: string; publish_status: "draft" | "published" } | null;
      if (!cs || cs.publish_status !== "published") {
        return {
          structure: null,
          classId,
          className: match.classes.name,
          classSection: match.classes.section,
          publishStatus: cs?.publish_status ?? null,
          slots: [],
        };
      }

      const [{ data: structureRow }, { data: periodSlotsData }] = await Promise.all([
        supabase.from("tt_period_structures" as never).select("id, name, working_days").eq("id", cs.structure_id).maybeSingle(),
        supabase
          .from("tt_period_slots" as never)
          .select("id, period_number, label, start_time, end_time, kind, days")
          .eq("structure_id", cs.structure_id)
          .order("period_number", { ascending: true }),
      ]);

      const structure: PeriodStructureV2 | null = structureRow
        ? {
            id: (structureRow as { id: string }).id,
            name: (structureRow as { name: string }).name,
            working_days: ((structureRow as { working_days: string[] }).working_days ?? []) as Weekday[],
            slots: ((periodSlotsData ?? []) as unknown as PeriodSlotV2[]).sort(
              (a, b) => a.start_time.localeCompare(b.start_time),
            ),
          }
        : null;

      const { data: slotRows, error: slotErr } = await supabase
        .from("tt_slots" as never)
        .select(
          "id, class_id, period_slot_id, day, academic_year, slot_type, subject_id, teacher_id, resource_id, notes, custom_label, is_optional_band, optional_group_id, " +
          "optional_group:optional_groups!tt_slots_optional_group_id_fkey(id, name), " +
          "subject:universal_subjects!tt_slots_subject_id_fkey(id, name), " +
          "teacher:profiles!tt_slots_teacher_id_fkey(id, full_name)",
        )
        .eq("class_id", classId)
        .eq("academic_year", academicYear);
      if (slotErr) throw slotErr;
      type SlotRaw = {
        id: string;
        class_id: string;
        period_slot_id: string;
        day: Weekday;
        academic_year: string;
        slot_type: SlotType;
        subject_id: string | null;
        teacher_id: string | null;
        resource_id: string | null;
        notes: string | null;
        custom_label: string | null;
        is_optional_band: boolean | null;
        optional_group_id: string | null;
        optional_group: { id: string; name: string } | null;
        subject: { id: string; name: string } | null;
        teacher: { id: string; full_name: string | null } | null;
      };
      const slots: ResolvedSlotV2[] = ((slotRows ?? []) as unknown as SlotRaw[]).map((r) => ({
        id: r.id,
        class_id: r.class_id,
        period_slot_id: r.period_slot_id,
        day: r.day,
        academic_year: r.academic_year,
        slot_type: r.slot_type,
        subject_id: r.subject_id,
        teacher_id: r.teacher_id,
        resource_id: r.resource_id,
        notes: null,            // students never see notes
        custom_label: r.custom_label,
        subject_name: r.subject?.name ?? null,
        teacher_name: r.teacher?.full_name ?? null,
        is_optional_band: r.is_optional_band ?? false,
        optional_group_id: r.optional_group_id,
        optional_group_name: r.optional_group?.name ?? null,
      }));

      // Optional-group substitution: replace each group cell's (empty)
      // subject/teacher with the caller's chosen subject for that group.
      // One auth.uid()-derived RPC — no N+1, no caller-supplied identity.
      const hasGroupSlots = slots.some((s) => s.optional_group_id);
      if (hasGroupSlots) {
        const { data: choiceRows, error: choiceErr } = await supabase.rpc("my_optional_slot_choices", {
          _class_id: classId,
          _academic_year: academicYear,
        });
        // Never swallow this: a failed lookup used to be indistinguishable
        // from "no choice recorded", which silently blanked the optional
        // subject out of every student's timetable (CLAUDE.md §6).
        if (choiceErr) throw choiceErr;
        const choiceMap = new Map<string, { subject_name: string | null; teacher_name: string | null }>(
          ((choiceRows ?? []) as Array<{ slot_id: string; subject_name: string | null; teacher_name: string | null }>)
            .map((c) => [c.slot_id, { subject_name: c.subject_name, teacher_name: c.teacher_name }]),
        );
        for (const s of slots) {
          if (!s.optional_group_id) continue;
          const r = choiceMap.get(s.id);
          // Only overwrite when this student actually has a choice. With no
          // choice we leave subject_name null so the cell falls back to the
          // group name plus "Optionals in parallel", which is true whether the
          // student has yet to pick or the school has recorded no choices at
          // all. The old "· not selected" blamed the student for both.
          if (r?.subject_name) {
            s.subject_name = r.subject_name;
            s.teacher_name = r.teacher_name ?? null;
          }
        }
      }

      // Optional-band substitution: replace each band cell's (empty) subject /
      // teacher with the specific optional batch THIS student is enrolled in.
      // One RPC — no N+1. tt_slots rows are untouched (read-side only).
      const hasBand = slots.some((s) => s.is_optional_band);
      if (hasBand) {
        const { data: bandRows, error: bandErr } = await supabase.rpc("student_band_resolution", {
          _student: user.id,
          _class_id: classId,
          _academic_year: academicYear,
        });
        if (bandErr) throw bandErr;
        const bandMap = new Map<string, { subject_name: string | null; teacher_name: string | null }>(
          ((bandRows ?? []) as Array<{ band_slot_id: string; subject_name: string | null; teacher_name: string | null }>)
            .map((b) => [b.band_slot_id, { subject_name: b.subject_name, teacher_name: b.teacher_name }]),
        );
        for (const s of slots) {
          if (!s.is_optional_band) continue;
          const r = bandMap.get(s.id);
          s.subject_name = r?.subject_name ?? "Optional · not enrolled";
          s.teacher_name = r?.teacher_name ?? null;
        }
      }
      // Honour the read-side semantic: a day with override slots ignores the
      // default schedule entirely. We filter the cells to only those whose
      // (day, period_slot_id) belongs to that day's effective period set.
      const effectivePeriodIdsByDay = new Map<Weekday, Set<string>>();
      if (structure) {
        for (const day of structure.working_days) {
          effectivePeriodIdsByDay.set(
            day,
            new Set(slotsForDay(structure.slots, day).map((p) => p.id)),
          );
        }
      }
      const filteredSlots = structure
        ? slots.filter((s) => effectivePeriodIdsByDay.get(s.day)?.has(s.period_slot_id) ?? false)
        : slots;

      return {
        structure,
        classId,
        className: match.classes.name,
        classSection: match.classes.section,
        publishStatus: cs.publish_status,
        slots: filteredSlots,
      };
    },
  });
}

// =============================================================
// SUBSTITUTIONS — Slice C
// =============================================================

export type SubstitutionStatus =
  | "pending"
  | "assigned"
  | "completed"
  | "cancelled"
  | "no_teacher_available";

export interface SubstitutionRow {
  id: string;
  slot_id: string;
  date: string;                     // ISO yyyy-mm-dd
  /** `pending` rows come from the auto-flow: the teacher is out, no cover yet. */
  status: SubstitutionStatus;
  substitute_teacher_id: string | null;
  substitute_teacher_name: string | null;
  reason: string | null;
  created_at: string;
}

/**
 * All substitutions for a class's slots within the given AY. Keyed
 * by slot_id for fast lookup on the grid. Filtered to today-and-
 * future so past cover-ups don't clutter the view, and to rows that
 * still mean something: a `cancelled` row (the teacher checked in
 * after all) is not a cover.
 */
export function useSubstitutionsForClass(classId: string | null, academicYear: string) {
  return useQuery({
    queryKey: ["timetable-v2", "substitutions", classId, academicYear],
    enabled: !!classId && !!academicYear,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, SubstitutionRow[]>> => {
      // Find the slots for this class + year first so we can scope
      // the substitution query. One class-year is at most a few dozen
      // cells; the range is the backstop, not the expected size.
      const { data: slotIds, error: slotErr } = await supabase
        .from("tt_slots" as never)
        .select("id")
        .eq("class_id", classId!)
        .eq("academic_year", academicYear)
        .range(0, 499);
      if (slotErr) throw slotErr;
      const ids = ((slotIds ?? []) as unknown as { id: string }[]).map((r) => r.id);
      if (ids.length === 0) return new Map();

      const { data, error } = await supabase
        .from("tt_substitutions" as never)
        .select("id, slot_id, date, status, reason, created_at, substitute_teacher_id, substitute:profiles!tt_substitutions_substitute_teacher_id_fkey(id, full_name)")
        .in("slot_id", ids)
        .gte("date", localISODate())
        .neq("status", "cancelled")
        .order("date", { ascending: true })
        .range(0, 499);
      if (error) throw error;
      type Row = {
        id: string;
        slot_id: string;
        date: string;
        status: SubstitutionStatus;
        reason: string | null;
        created_at: string;
        substitute_teacher_id: string | null;
        substitute: { id: string; full_name: string | null } | null;
      };
      const bySlot = new Map<string, SubstitutionRow[]>();
      for (const r of (data ?? []) as unknown as Row[]) {
        const row: SubstitutionRow = {
          id: r.id,
          slot_id: r.slot_id,
          date: r.date,
          status: r.status,
          substitute_teacher_id: r.substitute_teacher_id,
          substitute_teacher_name: r.substitute?.full_name ?? null,
          reason: r.reason,
          created_at: r.created_at,
        };
        const list = bySlot.get(r.slot_id) ?? [];
        list.push(row);
        bySlot.set(r.slot_id, list);
      }
      return bySlot;
    },
  });
}

/**
 * One cover that involves the signed-in teacher, from `tt_my_covers`:
 *   * `covering` - they are the substitute for someone else's period;
 *   * `covered`  - one of their own periods is being covered by someone else.
 * Only real covers (assigned/completed); a pending "nobody yet" row is not one.
 */
export interface MyCoverRow {
  substitution_id: string;
  slot_id: string;
  cover_date: string;               // ISO yyyy-mm-dd
  cover_role: "covering" | "covered";
  class_id: string;
  class_name: string;
  class_section: string | null;
  subject_id: string | null;
  /** Subject, or the optional group's name for a basket period. */
  subject_name: string | null;
  period_label: string;
  start_time: string;
  end_time: string;
  /** Covering: whose period it is. Covered: who is covering it. */
  other_teacher_name: string | null;
  reason: string | null;
}

/**
 * The teacher's covers inside a date window (the page asks for one week).
 * Server-bounded to 62 days and 500 rows. Keyed under
 * ["timetable-v2", "substitutions"] so invalidateSubstitutionCaches clears it.
 */
export function useMyCovers(fromIso: string, toIso: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["timetable-v2", "substitutions", "mine", user?.id ?? null, fromIso, toIso],
    enabled: !!user?.id && !!fromIso && !!toIso,
    staleTime: 60_000,
    queryFn: async (): Promise<MyCoverRow[]> => {
      const { data, error } = await supabase.rpc(
        "tt_my_covers" as never,
        { p_from: fromIso, p_to: toIso } as never,
      );
      if (error) throw error;
      return (data ?? []) as unknown as MyCoverRow[];
    },
  });
}

/**
 * List of teachers in the institution, sorted by name. Used to
 * populate the substitute teacher picker. Unlike the regular
 * teacher picker, substitutes don't need to be assigned to the
 * class/subject — any teacher can cover.
 */
export function useInstitutionTeachers() {
  const { institutionId } = useEffectiveInstitution();
  return useQuery({
    queryKey: ["timetable-v2", "institution-teachers", institutionId],
    enabled: !!institutionId,
    queryFn: async (): Promise<TeacherOption[]> => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, profiles:profiles!user_roles_user_id_fkey(id, full_name)")
        .eq("role", "teacher")
        .eq("institution_id", institutionId!);
      if (error) throw error;
      type Row = { user_id: string; profiles: { id: string; full_name: string | null } | null };
      const seen = new Set<string>();
      const out: TeacherOption[] = [];
      for (const r of (data ?? []) as Row[]) {
        if (seen.has(r.user_id)) continue;
        seen.add(r.user_id);
        out.push({ id: r.user_id, full_name: r.profiles?.full_name ?? "Unnamed teacher" });
      }
      return out.sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
  });
}

export interface CreateSubstitutionInput {
  slot_id: string;
  date: string;                     // ISO yyyy-mm-dd
  substitute_teacher_id: string;
  reason: string | null;
}

export function useUpsertSubstitution() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: CreateSubstitutionInput) => {
      const actorId = user?.id ?? null;
      const { data, error } = await supabase
        .from("tt_substitutions" as never)
        .upsert(
          {
            slot_id: input.slot_id,
            date: input.date,
            substitute_teacher_id: input.substitute_teacher_id,
            reason: input.reason,
            // A manual cover IS an assignment. The row for this slot+date
            // often exists already as the auto-flow's `pending` row (teacher
            // missed check-in) or a `cancelled` one, and an upsert UPDATEs
            // only the columns it is sent. Without these the period kept
            // status `pending` with a substitute on it: still listed as
            // needing cover everywhere, and never credited to the substitute.
            status: "assigned",
            assigned_by: actorId,
            assigned_at: new Date().toISOString(),
            cancelled_reason: null,
            created_by: actorId,
          } as never,
          // tt_substitutions is keyed UNIQUE (slot_id, date). It has no
          // subject_id column: that key belongs to tt_lesson_plans, and a
          // stray "subject_id" here failed every save with 42703.
          { onConflict: "slot_id,date" },
        )
        .select("id")
        .single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: (row) => {
      toast.success("Substitute saved");
      invalidateSubstitutionCaches(queryClient);
      if (row?.id) notifySubstituteAssigned(row.id);
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't save the substitute.", context: "upsertSubstitution" }),
  });
}

export function useDeleteSubstitution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (subId: string) => {
      // A DELETE blocked by RLS returns no error and no rows, which reads as
      // success (CLAUDE.md §6). Ask for the deleted id back and treat "no row
      // came back" as the failure it is.
      const { data, error } = await supabase
        .from("tt_substitutions" as never)
        .delete()
        .eq("id", subId)
        .select("id");
      if (error) throw error;
      if (!data || (data as unknown[]).length === 0) {
        throw new Error("You can't remove this substitute. Only an admin or this class's coordinator can.");
      }
    },
    onSuccess: () => {
      toast.success("Substitute removed");
      invalidateSubstitutionCaches(queryClient);
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't remove the substitute.", context: "deleteSubstitution" }),
  });
}

// =============================================================
// LESSON PLANS — Slice G
// =============================================================

export type LessonPlanStatus = "planned" | "done" | "pending" | "skipped";

export interface LessonPlanRow {
  id: string;
  slot_id: string;
  date: string;
  status: LessonPlanStatus;
  note: string | null;
  owner_teacher_id: string | null;
  subject_id: string | null;
  class_id: string;
  /** Chapter (syllabus_topics row) the teacher tagged on this plan. */
  topic_id: string | null;
  /**
   * True when the teacher logged this period with a note instead of a chapter
   * (surprise test, class activity). Such a row still counts as "this day was
   * logged" for the check-out gate, but never as syllabus coverage.
   */
  is_note_only: boolean;
  /** When the row was first written. Only useLessonPlanForDate selects it. */
  created_at?: string;
}

export interface UpsertLessonPlanInput {
  slot_id: string;
  class_id: string;
  subject_id: string | null;
  owner_teacher_id: string;
  date: string;
  /** Optional — defaults to 'planned' on insert; preserved on update. */
  status?: LessonPlanStatus;
  note: string | null;
  session_type?: "teaching" | "test" | "doubt_session" | "other";
  /**
   * Chapter (syllabus_topics) the lesson is targeting.
   * `null` clears it; **omit entirely to leave whatever is already on the row**.
   * Past-date saves rely on that: the chapter there is written by
   * `record_syllabus_progress` from the jar, and sending `null` from a dialog
   * that no longer shows a chapter picker would wipe it.
   */
  topic_id?: string | null;
  /**
   * Chapter-mode saves pass `false` explicitly so that toggling note-only OFF
   * converts the row back. Note-only saves do NOT come through here at all,
   * they go through useRecordPeriodNote.
   */
  is_note_only?: boolean;
}

/**
 * Fetch a single lesson plan row keyed on (slot_id, date). Returns
 * null when there's no row yet — callers treat that as "new" and
 * offer a create form.
 */
export function useLessonPlanForDate(
  slotId: string | null,
  date: string | null,
  subjectId?: string | null,
) {
  return useQuery({
    queryKey: ["timetable-v2", "lesson-plan", slotId, date, subjectId ?? null],
    enabled: !!slotId && !!date,
    queryFn: async (): Promise<LessonPlanRow | null> => {
      // Scoped to the subject: an optional-group period is ONE slot shared by
      // several subjects, each with its own teacher and its own plan row, so
      // (slot_id, date) alone can match several rows and maybeSingle() would
      // throw. For an ordinary slot the subject is fixed, so this is the same
      // row as before.
      let q = supabase
        .from("tt_lesson_plans" as never)
        .select("id, slot_id, date, status, note, owner_teacher_id, subject_id, class_id, topic_id, is_note_only, created_at")
        .eq("slot_id", slotId!)
        .eq("date", date!);
      if (subjectId !== undefined) {
        q = subjectId === null ? q.is("subject_id", null) : q.eq("subject_id", subjectId);
      }
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      return (data as unknown as LessonPlanRow | null) ?? null;
    },
  });
}

export function useUpsertLessonPlan() {
  const { institutionId } = useEffectiveInstitution();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertLessonPlanInput) => {
      const { data: userRes } = await supabase.auth.getUser();
      // Status default policy: when the dialog doesn't expose a status
      // picker we just want the lesson plan to exist as a record; default
      // to 'planned' on first save and preserve whatever the row already
      // has on subsequent edits. Fetch existing first to avoid clobbering.
      let nextStatus: LessonPlanStatus = input.status ?? "planned";
      if (input.status === undefined) {
        // Scoped to the subject: the upsert key is (slot_id, date, subject_id),
        // and a basket period holds one row per subject on the same slot+date.
        let prev = supabase
          .from("tt_lesson_plans" as never)
          .select("status, is_note_only")
          .eq("slot_id", input.slot_id)
          .eq("date", input.date);
        prev = input.subject_id === null ? prev.is("subject_id", null) : prev.eq("subject_id", input.subject_id);
        const { data: existing } = await prev.maybeSingle();
        const prior = existing as { status: LessonPlanStatus; is_note_only: boolean } | null;
        // A note-only row is born "done" (the period was logged with a note).
        // Turning it back into a teaching row must NOT inherit that: the row
        // would claim a delivered lesson while the syllabus log holds nothing.
        // 148 such rows had piled up by 2026-09-29, most still carrying the
        // note's text ("Holiday due to Innovista", "PTM").
        const leavingNote = !!prior?.is_note_only && input.is_note_only === false;
        if (prior && !leavingNote) nextStatus = prior.status;
      }

      // Built conditionally: PostgREST's upsert only UPDATEs the columns present
      // in the payload, so omitting topic_id is how a caller says "leave the
      // chapter alone" (see UpsertLessonPlanInput). On a fresh INSERT the column
      // simply takes its default.
      const payload: Record<string, unknown> = {
        institution_id: institutionId!,
        slot_id: input.slot_id,
        class_id: input.class_id,
        subject_id: input.subject_id,
        owner_teacher_id: input.owner_teacher_id,
        date: input.date,
        session_type: input.session_type ?? "teaching",
        status: nextStatus,
        note: input.note,
        is_note_only: input.is_note_only ?? false,
        updated_by: userRes.user?.id ?? null,
        created_by: userRes.user?.id ?? null,
      };
      if (input.topic_id !== undefined) payload.topic_id = input.topic_id;

      const { data, error } = await supabase
        .from("tt_lesson_plans" as never)
        .upsert(payload as never, { onConflict: "slot_id,date,subject_id" })
        .select()
        .single();
      if (error) throw error;
      return data as LessonPlanRow;
    },
    onSuccess: (row) => {
      toast.success("Lesson plan saved");
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "lesson-plan", row.slot_id, row.date] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "teacher-plans-week"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus-coverage"] });
      queryClient.invalidateQueries({ queryKey: ["dash"] });
      // A save can flip a day from unlogged to logged, so the backlog chip and
      // the check-out gate have to refetch. This was missing before note-only.
      queryClient.invalidateQueries({ queryKey: ["teacher-pending-syllabus-days"] });
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't save the lesson plan.", context: "upsertLessonPlan" }),
  });
}

export interface RecordPeriodNoteInput {
  classId: string;
  subjectId: string | null;
  date: string;
  note: string;
  /**
   * The exact period, when the caller knows it (the lesson-plan dialog). Omit
   * and the server resolves one from class + subject + weekday, which is what
   * the check-out gate and backlog sheet need since they are organised per
   * (class, subject) group and have no period to hand.
   */
  slotId?: string | null;
}

/**
 * Log a period that had no chapter delivery: a surprise test, a class activity,
 * an assembly that ate the period. Writes a note-only `tt_lesson_plans` row,
 * which counts as "this day was logged" (so the check-out gate releases the
 * teacher) but never as syllabus coverage.
 *
 * One SECURITY DEFINER RPC rather than a client-side upsert, because slot
 * resolution and the row shape must not drift between the three surfaces that
 * offer this.
 */
export function useRecordPeriodNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecordPeriodNoteInput): Promise<string> => {
      const { data, error } = await supabase.rpc("tt_record_period_note", {
        p_class_id: input.classId,
        // Supabase typegen types every uuid arg as a bare `string`, with no way
        // to express "nullable argument". A NULL subject is legal here and the
        // RPC compares it with IS NOT DISTINCT FROM: a period with no subject
        // (assembly, free period) can still carry a note, it just has no
        // (class, subject) group for the check-out gate to resolve.
        p_subject_id: input.subjectId as string,
        p_date: input.date,
        p_note: input.note,
        p_slot_id: input.slotId ?? undefined,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast.success("Note saved");
      // Prefix invalidation covers the lesson-plan, week-plans and month-count keys.
      queryClient.invalidateQueries({ queryKey: ["timetable-v2"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-pending-syllabus-days"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus-progress-state"] });
      queryClient.invalidateQueries({ queryKey: ["dash"] });
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't save the note.", context: "recordPeriodNote" }),
  });
}

/**
 * Count of `tt_lesson_plans` rows the teacher has saved for a given month,
 * scoped to their teaching slots. Used by the timetable header to render
 * the "20 / 30 plans" progress badge — paired with a client-side total
 * derived from the recurring slot template + weekday occurrences in month.
 */
export function useTeacherMonthLessonPlanCount(
  slotIds: string[],
  year: number,
  month: number,
  ownerTeacherId?: string | null,
) {
  return useQuery({
    queryKey: ["timetable-v2", "teacher-month-plans-count", slotIds.length, year, month, ownerTeacherId ?? null],
    enabled: slotIds.length > 0,
    queryFn: async (): Promise<number> => {
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0); // last day of month
      const toIso = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };
      // Scoped to the teacher's own rows: an optional-group period is a slot
      // shared with the other subjects in the basket, so an unscoped count
      // credits this teacher with colleagues' plans.
      let q = supabase
        .from("tt_lesson_plans" as never)
        .select("id", { count: "exact", head: true })
        .in("slot_id", slotIds)
        .gte("date", toIso(start))
        .lte("date", toIso(end));
      if (ownerTeacherId) q = q.eq("owner_teacher_id", ownerTeacherId);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/**
 * Pulls every lesson plan for a teacher-owned slot whose date is
 * in the current or upcoming week. Used by the agenda row's
 * "status" badge. The recurring-slot → per-date mapping is done
 * at the call site since it depends on which week the UI is on.
 */
export interface LessonPlanWeekRow extends LessonPlanRow {
  /** Name of the chapter in `topic_id`, embedded so the week card can name
   *  the planned chapter without a second query. Null when no chapter. */
  topic_name: string | null;
}

export function useTeacherPlansForWeek(slotIds: string[], weekDates: string[]) {
  const key = [
    "timetable-v2",
    "teacher-plans-week",
    slotIds.length,
    weekDates[0],
    weekDates[weekDates.length - 1],
  ];
  return useQuery({
    queryKey: key,
    enabled: slotIds.length > 0 && weekDates.length > 0,
    // A week's plans change only when this teacher saves one, and every save
    // path invalidates "timetable-v2"; the week card has no other live input.
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, LessonPlanWeekRow>> => {
      // Bounded by construction: at most (slots × 7 dates) rows, far under
      // PostgREST's 1000-row cap for any real timetable (a teacher's whole
      // week is a few dozen periods).
      const { data, error } = await supabase
        .from("tt_lesson_plans" as never)
        .select(
          "id, slot_id, date, status, note, owner_teacher_id, subject_id, class_id, topic_id, is_note_only, " +
          "topic:syllabus_topics!tt_lesson_plans_topic_id_fkey(topic_name)",
        )
        .in("slot_id", slotIds)
        .in("date", weekDates);
      if (error) throw error;
      type RawRow = LessonPlanRow & {
        topic: { topic_name: string } | { topic_name: string }[] | null;
      };
      const map = new Map<string, LessonPlanWeekRow>();
      for (const raw of (data ?? []) as unknown as RawRow[]) {
        const { topic, ...r } = raw;
        const topicOne = Array.isArray(topic) ? (topic[0] ?? null) : topic;
        // Subject is part of the key: a basket period holds one row per
        // subject, and the caller looks up with the subject they teach.
        map.set(`${r.slot_id}|${r.date}|${r.subject_id ?? ""}`, {
          ...r,
          topic_name: topicOne?.topic_name ?? null,
        });
      }
      return map;
    },
  });
}

// =============================================================
// SETTINGS — Slice D (period structures + shared resources)
// =============================================================

export interface TtPeriodStructureRow {
  id: string;
  name: string;
  working_days: Weekday[];
  slotCount: number;
  usedByClassCount: number;
}

export function useTtPeriodStructures() {
  const { institutionId } = useEffectiveInstitution();
  return useQuery({
    queryKey: ["timetable-v2", "period-structures", institutionId],
    enabled: !!institutionId,
    queryFn: async (): Promise<TtPeriodStructureRow[]> => {
      const [structuresRes, slotsRes, assignsRes] = await Promise.all([
        supabase
          .from("tt_period_structures" as never)
          .select("id, name, working_days")
          .eq("institution_id", institutionId!)
          .order("name"),
        supabase
          .from("tt_period_slots" as never)
          .select("structure_id, kind"),
        supabase
          .from("tt_class_structure" as never)
          .select("structure_id")
          .eq("institution_id", institutionId!),
      ]);
      if (structuresRes.error) throw structuresRes.error;
      if (slotsRes.error) throw slotsRes.error;
      if (assignsRes.error) throw assignsRes.error;

      type Struct = { id: string; name: string; working_days: string[] };
      type Slot = { structure_id: string; kind: string };
      type Assign = { structure_id: string };

      const structs = (structuresRes.data ?? []) as unknown as Struct[];
      const slots = (slotsRes.data ?? []) as unknown as Slot[];
      const assigns = (assignsRes.data ?? []) as unknown as Assign[];

      const slotCountByStruct = new Map<string, number>();
      for (const s of slots) {
        if (s.kind !== "period") continue;
        slotCountByStruct.set(s.structure_id, (slotCountByStruct.get(s.structure_id) ?? 0) + 1);
      }
      const assignCountByStruct = new Map<string, number>();
      for (const a of assigns) {
        assignCountByStruct.set(a.structure_id, (assignCountByStruct.get(a.structure_id) ?? 0) + 1);
      }

      return structs.map((s): TtPeriodStructureRow => ({
        id: s.id,
        name: s.name,
        working_days: (s.working_days ?? []) as Weekday[],
        slotCount: slotCountByStruct.get(s.id) ?? 0,
        usedByClassCount: assignCountByStruct.get(s.id) ?? 0,
      }));
    },
  });
}

export interface NewPeriodSlotInput {
  /** Present when this input represents an existing tt_period_slots row
   *  (edit mode). Absent for brand-new rows added in the dialog before
   *  save. Used by `useUpdatePeriodStructure`'s "patch" mode to tell
   *  UPDATEs from INSERTs. */
  id?: string;
  label: string;
  start_time: string;     // "HH:MM"
  end_time: string;       // "HH:MM"
  kind: "period" | "break";
  /** Optional per-day scope. Omit/null → applies to every working day.
   *  Non-empty array → applies only to those weekdays (override mode). */
  days?: Weekday[] | null;
}

export interface CreatePeriodStructureInput {
  name: string;
  working_days: Weekday[];
  slots: NewPeriodSlotInput[];
}

/**
 * Bucket slots by their day-set (defaults vs each per-day override) and
 * number each bucket independently. Within a bucket, sort by start_time and
 * assign period_number = 1..N for "period" kind, 1000+idx for "break". This
 * keeps period_number a stable display index per day-set without colliding
 * across buckets (the migration drops the unique constraint, but we still
 * want sane numbering for downstream rendering).
 */
function numberSlotsByDayBucket(
  slots: NewPeriodSlotInput[],
): Array<NewPeriodSlotInput & { period_number: number }> {
  const bucketKey = (s: NewPeriodSlotInput) =>
    s.days && s.days.length > 0 ? [...s.days].sort().join(",") : "__default__";
  const buckets = new Map<string, NewPeriodSlotInput[]>();
  for (const s of slots) {
    const k = bucketKey(s);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(s);
  }

  const numbered: Array<NewPeriodSlotInput & { period_number: number }> = [];
  for (const bucket of buckets.values()) {
    const ordered = [...bucket].sort((a, b) => a.start_time.localeCompare(b.start_time));
    let periodIdx = 0;
    let breakIdx = 0;
    for (const s of ordered) {
      const period_number = s.kind === "break" ? 1000 + ++breakIdx : ++periodIdx;
      numbered.push({ ...s, period_number });
    }
  }
  return numbered;
}

/**
 * Atomically create a tt_period_structures row and its child
 * tt_period_slots rows. Non-break slots numbered 1..N by start
 * time; break slots numbered 1000+index to preserve the
 * UNIQUE(structure_id, period_number) invariant (same scheme as
 * legacy). If any slot insert fails, the parent is rolled back
 * so the institution never ends up with an orphaned structure.
 */
export function useCreatePeriodStructure() {
  const { institutionId } = useEffectiveInstitution();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePeriodStructureInput) => {
      // 1. Create the parent structure.
      const { data: userRes } = await supabase.auth.getUser();
      const { data: parent, error: parentErr } = await supabase
        .from("tt_period_structures" as never)
        .insert({
          institution_id: institutionId!,
          name: input.name,
          working_days: input.working_days,
          created_by: userRes.user?.id ?? null,
        } as never)
        .select("id")
        .single();
      if (parentErr) throw parentErr;
      const structureId = (parent as { id: string }).id;

      // 2. Number rows by start_time within their day-set so per-day overrides
      // get their own 1..N counter. Defaults (days===null) live in their own
      // "all-days" bucket, while [saturday] overrides number independently.
      const rows = numberSlotsByDayBucket(input.slots).map((s) => ({
        structure_id: structureId,
        period_number: s.period_number,
        label: s.label,
        start_time: s.start_time.length === 5 ? `${s.start_time}:00` : s.start_time,
        end_time: s.end_time.length === 5 ? `${s.end_time}:00` : s.end_time,
        kind: s.kind,
        days: s.days ?? null,
      }));
      const { error: slotsErr } = await supabase
        .from("tt_period_slots" as never)
        .insert(rows as never);
      if (slotsErr) {
        // Rollback the parent to avoid orphans.
        await supabase.from("tt_period_structures" as never).delete().eq("id", structureId);
        throw slotsErr;
      }

      return structureId;
    },
    onSuccess: () => {
      toast.success("Period structure created");
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "period-structures"] });
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't create the period structure.", context: "createPeriodStructure" }),
  });
}

/**
 * Class roster grouped by wing, scoped to the institution and academic year.
 * Includes each class's current `tt_class_structure` assignment (if any) so
 * the assignment dialog can render "currently uses Senior Wing" etc.
 */
export interface AssignmentClassRow {
  classId: string;
  className: string;
  section: string | null;
  wingId: string | null;
  wingName: string | null;
  currentStructureId: string | null;
  currentStructureName: string | null;
  publishStatus: PublishStatus | null;
}

export interface AssignmentWingGroup {
  wingId: string | null;        // null = "Unassigned to a wing"
  wingName: string;
  classes: AssignmentClassRow[];
}

export function useClassesForAssignmentV2(academicYear: string) {
  const { institutionId } = useEffectiveInstitution();
  return useQuery({
    queryKey: ["timetable-v2", "assignment-classes", institutionId, academicYear],
    enabled: !!institutionId && !!academicYear,
    queryFn: async (): Promise<AssignmentWingGroup[]> => {
      const [classesRes, mappingsRes, wingsRes, csRes] = await Promise.all([
        supabase
          .from("classes")
          .select("id, name, section, academic_year, is_active")
          .eq("institution_id", institutionId!)
          .eq("academic_year", academicYear)
          .eq("is_active", true),
        supabase
          .from("wing_class_mappings")
          .select("class_id, wing_id"),
        supabase
          .from("wings")
          .select("id, name")
          .eq("institution_id", institutionId!),
        supabase
          .from("tt_class_structure" as never)
          .select(
            "class_id, structure_id, publish_status, " +
            "structure:tt_period_structures!tt_class_structure_structure_id_fkey(id, name)",
          )
          .eq("institution_id", institutionId!)
          .eq("academic_year", academicYear),
      ]);
      if (classesRes.error) throw classesRes.error;
      if (mappingsRes.error) throw mappingsRes.error;
      if (wingsRes.error) throw wingsRes.error;
      if (csRes.error) throw csRes.error;

      type CsRow = {
        class_id: string;
        structure_id: string;
        publish_status: PublishStatus;
        structure: { id: string; name: string } | null;
      };

      const wingByClass = new Map<string, string>();
      for (const m of (mappingsRes.data ?? []) as { class_id: string; wing_id: string }[]) {
        wingByClass.set(m.class_id, m.wing_id);
      }
      const wingNames = new Map<string, string>();
      for (const w of (wingsRes.data ?? []) as { id: string; name: string }[]) {
        wingNames.set(w.id, w.name);
      }
      const csByClass = new Map<string, CsRow>();
      for (const r of (csRes.data ?? []) as unknown as CsRow[]) {
        csByClass.set(r.class_id, r);
      }

      const classRows = (classesRes.data ?? []) as { id: string; name: string; section: string | null }[];
      const enriched: AssignmentClassRow[] = classRows.map((c) => {
        const wingId = wingByClass.get(c.id) ?? null;
        const cs = csByClass.get(c.id) ?? null;
        return {
          classId: c.id,
          className: c.name,
          section: c.section,
          wingId,
          wingName: wingId ? wingNames.get(wingId) ?? null : null,
          currentStructureId: cs?.structure_id ?? null,
          currentStructureName: cs?.structure?.name ?? null,
          publishStatus: cs?.publish_status ?? null,
        };
      });

      // Group by wing (null wing → "Other classes" bucket).
      const byWing = new Map<string | null, AssignmentClassRow[]>();
      for (const row of enriched) {
        const k = row.wingId;
        if (!byWing.has(k)) byWing.set(k, []);
        byWing.get(k)!.push(row);
      }
      const groups: AssignmentWingGroup[] = [];
      for (const [wingId, classes] of byWing.entries()) {
        groups.push({
          wingId,
          wingName: wingId
            ? wingNames.get(wingId) ?? "Wing"
            : "Classes without a wing",
          classes: classes.sort((a, b) => {
            const byName = compareClassNames(a.className, b.className);
            if (byName !== 0) return byName;
            return (a.section ?? "").localeCompare(b.section ?? "");
          }),
        });
      }
      // Sort groups: real wings alphabetical first, "no wing" last.
      groups.sort((a, b) => {
        if (a.wingId === null && b.wingId !== null) return 1;
        if (b.wingId === null && a.wingId !== null) return -1;
        return a.wingName.localeCompare(b.wingName);
      });
      return groups;
    },
  });
}

export interface AssignStructureToClassesInput {
  structureId: string;
  classIds: string[];
  academicYear: string;
}

/**
 * Admin-only: upsert `tt_class_structure` for each class in `classIds`,
 * pointing them at the given structure for the given academic year.
 *
 * If a class is already on a different structure for this AY, its
 * scheduled `tt_slots` cells reference period_slot_ids of the OLD
 * structure — those rows survive the upsert (FK is `period_slots(id)`,
 * not `class_structure`), but become invisible because the read path
 * filters cells to the new structure's effective period set. We delete
 * them eagerly so the data stays consistent.
 *
 * Brand-new assignments (class had no prior structure) skip the wipe.
 * Idempotent re-assignment to the same structure also skips the wipe.
 */
export function useAssignStructureToClassesV2() {
  const { institutionId } = useEffectiveInstitution();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AssignStructureToClassesInput) => {
      if (!institutionId) throw new Error("Missing institution context.");
      if (input.classIds.length === 0) return { assigned: 0 };

      const { data: existingRows, error: selErr } = await supabase
        .from("tt_class_structure" as never)
        .select("class_id, structure_id")
        .in("class_id", input.classIds)
        .eq("academic_year", input.academicYear);
      if (selErr) throw selErr;
      const existing = new Map<string, string>();
      for (const r of (existingRows ?? []) as unknown as { class_id: string; structure_id: string }[]) {
        existing.set(r.class_id, r.structure_id);
      }
      const switching = input.classIds.filter(
        (id) => existing.has(id) && existing.get(id) !== input.structureId,
      );

      // Wipe scheduled cells for classes whose structure is being replaced.
      if (switching.length > 0) {
        const { error: dErr } = await supabase
          .from("tt_slots" as never)
          .delete()
          .in("class_id", switching)
          .eq("academic_year", input.academicYear);
        if (dErr) throw dErr;
      }

      // Upsert the assignment row. Omit publish_status so existing rows keep
      // their previous status; new rows fall back to the column default
      // ('draft'). class_id + academic_year is the canonical conflict target.
      const rows = input.classIds.map((classId) => ({
        institution_id: institutionId,
        class_id: classId,
        structure_id: input.structureId,
        academic_year: input.academicYear,
      }));
      const { error: upErr } = await supabase
        .from("tt_class_structure" as never)
        .upsert(rows as never, { onConflict: "class_id,academic_year" });
      if (upErr) throw upErr;

      return { assigned: input.classIds.length, switched: switching.length };
    },
    onSuccess: (_, vars) => {
      toast.success(
        vars.classIds.length === 1
          ? "Structure assigned to 1 class"
          : `Structure assigned to ${vars.classIds.length} classes`,
      );
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "period-structures"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "period-structure-detail"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "assignment-classes"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "class-list"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "workspace"] });
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't assign the structure.", context: "assignStructureToClasses" }),
  });
}

export interface UnassignStructureInput {
  classIds: string[];
  academicYear: string;
}

/**
 * Admin-only: remove the `tt_class_structure` row for each class in
 * `classIds`, AND wipe any `tt_slots` cells those classes have for the
 * year. After this, the workspace shows "No period structure assigned"
 * and admins can pick a fresh structure.
 */
export function useUnassignStructureFromClassesV2() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UnassignStructureInput) => {
      if (input.classIds.length === 0) return;

      const { error: dSlotsErr } = await supabase
        .from("tt_slots" as never)
        .delete()
        .in("class_id", input.classIds)
        .eq("academic_year", input.academicYear);
      if (dSlotsErr) throw dSlotsErr;

      const { error: dCsErr } = await supabase
        .from("tt_class_structure" as never)
        .delete()
        .in("class_id", input.classIds)
        .eq("academic_year", input.academicYear);
      if (dCsErr) throw dCsErr;
    },
    onSuccess: (_, vars) => {
      toast.success(
        vars.classIds.length === 1
          ? "Structure unassigned from 1 class"
          : `Structure unassigned from ${vars.classIds.length} classes`,
      );
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "period-structures"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "period-structure-detail"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "assignment-classes"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "class-list"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "workspace"] });
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't unassign the structure.", context: "unassignStructure" }),
  });
}

/**
 * Single-structure detail fetcher used by the edit dialog to prefill.
 * Returns the parent row plus its sorted period slots.
 */
export interface TtPeriodStructureDetail {
  id: string;
  name: string;
  working_days: Weekday[];
  slots: NewPeriodSlotInput[];
  usedByClassCount: number;
}

export function useTtPeriodStructureDetail(structureId: string | null) {
  return useQuery({
    queryKey: ["timetable-v2", "period-structure-detail", structureId],
    enabled: !!structureId,
    queryFn: async (): Promise<TtPeriodStructureDetail | null> => {
      const { data: parent, error: pErr } = await supabase
        .from("tt_period_structures" as never)
        .select("id, name, working_days")
        .eq("id", structureId!)
        .maybeSingle();
      if (pErr) throw pErr;
      if (!parent) return null;

      const [{ data: slotRows, error: sErr }, { data: assignRows, error: aErr }] = await Promise.all([
        supabase
          .from("tt_period_slots" as never)
          // `id` is required so the edit dialog can drive `useUpdatePeriodStructure`
          // in "patch" mode (UPDATE existing rows in place vs. INSERT new ones).
          // Without it every seeded row looked like a new insert and re-created
          // duplicates that then failed the overlap trigger with a 400.
          .select("id, label, start_time, end_time, kind, days")
          .eq("structure_id", structureId!)
          .order("start_time", { ascending: true }),
        supabase
          .from("tt_class_structure" as never)
          .select("class_id")
          .eq("structure_id", structureId!),
      ]);
      if (sErr) throw sErr;
      if (aErr) throw aErr;

      const p = parent as { id: string; name: string; working_days: string[] };
      const slots = ((slotRows ?? []) as unknown as { id: string; label: string; start_time: string; end_time: string; kind: "period" | "break"; days: string[] | null }[])
        .map((s) => ({
          id: s.id,
          label: s.label,
          // Database stores TIME as "HH:MM:SS"; trim to "HH:MM" for the
          // <input type="time"> control which rejects seconds.
          start_time: s.start_time.length > 5 ? s.start_time.slice(0, 5) : s.start_time,
          end_time: s.end_time.length > 5 ? s.end_time.slice(0, 5) : s.end_time,
          kind: s.kind,
          days: (s.days as Weekday[] | null) ?? null,
        }));

      return {
        id: p.id,
        name: p.name,
        working_days: (p.working_days ?? []) as Weekday[],
        slots,
        usedByClassCount: (assignRows ?? []).length,
      };
    },
  });
}

export interface UpdatePeriodStructureInput {
  id: string;
  name: string;
  working_days: Weekday[];
  slots: NewPeriodSlotInput[];
  /** How to reconcile the slots list with existing `tt_period_slots` rows:
   *  - `"skip"`    — leave slot rows untouched (name/working_days only).
   *  - `"patch"`   — UPDATE existing rows in place (matched by id),
   *                  INSERT brand-new rows, DELETE only rows in
   *                  `deletedSlotIds`. Cascade on those DELETEs removes
   *                  the referencing `tt_slots` cells. Safe for structures
   *                  that are in use by classes when the caller has already
   *                  confirmed any cascading deletes with the user.
   *  - `"replace"` — nuclear: DELETE every `tt_period_slot` for this
   *                  structure and INSERT the new set. Cascade wipes every
   *                  scheduled `tt_slots` cell. Use only when
   *                  `usedByClassCount === 0`. */
  slotsAction: "skip" | "patch" | "replace";
  /** For `slotsAction === "patch"`: ids of previously-existing
   *  `tt_period_slots` rows to DELETE. Cascade removes their `tt_slots`
   *  cells; caller must have confirmed the affected-cell count with the
   *  user. Ignored in "skip" and "replace" modes. */
  deletedSlotIds?: string[];
}

/**
 * Update a period structure. Always patches name + working_days.
 * `slotsAction` controls how slot rows are reconciled — see the input type
 * for the semantics of each mode. "patch" is safe for in-use structures
 * because it never mass-deletes; "replace" is only for unused ones because
 * the cascade wipes every scheduled cell.
 */
export function useUpdatePeriodStructure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdatePeriodStructureInput) => {
      const { error: pErr } = await supabase
        .from("tt_period_structures" as never)
        .update({ name: input.name, working_days: input.working_days } as never)
        .eq("id", input.id);
      if (pErr) throw pErr;

      if (input.slotsAction === "replace") {
        const { error: delErr } = await supabase
          .from("tt_period_slots" as never)
          .delete()
          .eq("structure_id", input.id);
        if (delErr) throw delErr;

        const rows = numberSlotsByDayBucket(input.slots).map((s) => ({
          structure_id: input.id,
          period_number: s.period_number,
          label: s.label,
          start_time: s.start_time.length === 5 ? `${s.start_time}:00` : s.start_time,
          end_time: s.end_time.length === 5 ? `${s.end_time}:00` : s.end_time,
          kind: s.kind,
          days: s.days ?? null,
        }));
        const { error: insErr } = await supabase
          .from("tt_period_slots" as never)
          .insert(rows as never);
        if (insErr) throw insErr;
      } else if (input.slotsAction === "patch") {
        // 1. DELETE removed rows first — cascade wipes their tt_slots cells.
        if (input.deletedSlotIds && input.deletedSlotIds.length > 0) {
          const { error: dErr } = await supabase
            .from("tt_period_slots" as never)
            .delete()
            .in("id", input.deletedSlotIds);
          if (dErr) throw dErr;
        }

        // 2. UPDATE existing rows in place. period_number is left alone —
        //    downstream display sorts by start_time, so renumbering isn't
        //    needed and would just risk UNIQUE(structure_id, period_number)
        //    collisions during the mid-batch state.
        for (const s of input.slots) {
          if (!s.id) continue;
          const { error: uErr } = await supabase
            .from("tt_period_slots" as never)
            .update({
              label: s.label,
              start_time: s.start_time.length === 5 ? `${s.start_time}:00` : s.start_time,
              end_time: s.end_time.length === 5 ? `${s.end_time}:00` : s.end_time,
              kind: s.kind,
              days: s.days ?? null,
            } as never)
            .eq("id", s.id);
          if (uErr) throw uErr;
        }

        // 3. INSERT brand-new rows with monotonically-increasing
        //    period_numbers past the current max in each kind bucket so
        //    the UNIQUE(structure_id, period_number) constraint holds.
        const newSlots = input.slots.filter((s) => !s.id);
        if (newSlots.length > 0) {
          const { data: existing, error: qErr } = await supabase
            .from("tt_period_slots" as never)
            .select("period_number, kind")
            .eq("structure_id", input.id);
          if (qErr) throw qErr;

          const rows = ((existing ?? []) as unknown as Array<{
            period_number: number;
            kind: "period" | "break";
          }>);
          let nextPeriodNum =
            Math.max(0, ...rows.filter((r) => r.kind === "period").map((r) => r.period_number)) + 1;
          let nextBreakNum =
            Math.max(999, ...rows.filter((r) => r.kind === "break").map((r) => r.period_number)) + 1;

          const insertRows = newSlots.map((s) => {
            const period_number = s.kind === "break" ? nextBreakNum++ : nextPeriodNum++;
            return {
              structure_id: input.id,
              period_number,
              label: s.label,
              start_time: s.start_time.length === 5 ? `${s.start_time}:00` : s.start_time,
              end_time: s.end_time.length === 5 ? `${s.end_time}:00` : s.end_time,
              kind: s.kind,
              days: s.days ?? null,
            };
          });
          const { error: iErr } = await supabase
            .from("tt_period_slots" as never)
            .insert(insertRows as never);
          if (iErr) throw iErr;
        }
      }

      // Sweep orphaned tt_slots after the update. Two cases produce orphans:
      //   1) A working day was removed — cells scheduled for that weekday are
      //      no longer renderable.
      //   2) Per-day overrides changed which periods apply on a day — cells
      //      pointing at period_slots that no longer apply on their day get
      //      hidden by the read-side filter; we delete them here so the data
      //      stays consistent.
      // Skipped in "replace" mode: the mass cascade already wiped every
      // tt_slot referencing this structure.
      if (input.slotsAction !== "replace") {
        const { data: classRows, error: cErr } = await supabase
          .from("tt_class_structure" as never)
          .select("class_id")
          .eq("structure_id", input.id);
        if (cErr) throw cErr;
        const classIds = ((classRows ?? []) as unknown as { class_id: string }[])
          .map((r) => r.class_id);
        if (classIds.length > 0) {
          const allWeekdays: Weekday[] = [
            "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
          ];
          const removedDays = allWeekdays.filter((d) => !input.working_days.includes(d));
          if (removedDays.length > 0) {
            const { error: dErr } = await supabase
              .from("tt_slots" as never)
              .delete()
              .in("class_id", classIds)
              .in("day", removedDays);
            if (dErr) throw dErr;
          }
        }
      }

      return input.id;
    },
    onSuccess: (id) => {
      toast.success("Period structure updated");
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "period-structures"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "period-structure-detail", id] });
      // Class workspaces that use this structure also need to refresh.
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "class-workspace"] });
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't update the period structure.", context: "updatePeriodStructure" }),
  });
}

/**
 * Delete a period structure. The FK from `tt_class_structure` →
 * `tt_period_structures` is `ON DELETE RESTRICT`, so we manually cascade
 * in the right order before the parent delete:
 *   1. Resolve the class IDs currently using this structure.
 *   2. Wipe their `tt_slots` cells for every academic year (otherwise the
 *      tt_class_structure DELETE would only block on this structure, but
 *      we'd still leave orphan cells if the FK was looser).
 *   3. Drop the `tt_class_structure` rows.
 *   4. Delete the structure parent (which cascade-deletes period_slots).
 *
 * The caller is expected to confirm with the user before invoking this on
 * an in-use structure — the UI shows an AlertDialog with the class count.
 */
export function useDeletePeriodStructure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (structureId: string) => {
      const { data: csRows, error: csSelErr } = await supabase
        .from("tt_class_structure" as never)
        .select("class_id, academic_year")
        .eq("structure_id", structureId);
      if (csSelErr) throw csSelErr;
      const assigns = (csRows ?? []) as unknown as { class_id: string; academic_year: string }[];

      if (assigns.length > 0) {
        const classIds = Array.from(new Set(assigns.map((r) => r.class_id)));
        const academicYears = Array.from(new Set(assigns.map((r) => r.academic_year)));

        // Wipe scheduled cells for the affected (class, AY) pairs. Scoping
        // by both fields keeps unrelated AYs untouched if a class happens to
        // be on a different structure for another year.
        const { error: dSlotsErr } = await supabase
          .from("tt_slots" as never)
          .delete()
          .in("class_id", classIds)
          .in("academic_year", academicYears);
        if (dSlotsErr) throw dSlotsErr;

        // Drop the assignment rows so the parent delete clears RESTRICT.
        const { error: dCsErr } = await supabase
          .from("tt_class_structure" as never)
          .delete()
          .eq("structure_id", structureId);
        if (dCsErr) throw dCsErr;
      }

      const { error } = await supabase
        .from("tt_period_structures" as never)
        .delete()
        .eq("id", structureId);
      if (error) throw error;

      return { unassignedCount: assigns.length };
    },
    onSuccess: () => {
      toast.success("Period structure deleted");
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "period-structures"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "period-structure-detail"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "assignment-classes"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "class-list"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "workspace"] });
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't delete the period structure.", context: "deletePeriodStructure" }),
  });
}

export type ResourceKind = "lab" | "library" | "computer_room" | "sports_facility" | "other";

export interface TtResourceRow {
  id: string;
  name: string;
  kind: ResourceKind;
  capacity: number;
  description: string | null;
}

export function useTtResources() {
  const { institutionId } = useEffectiveInstitution();
  return useQuery({
    queryKey: ["timetable-v2", "resources", institutionId],
    enabled: !!institutionId,
    queryFn: async (): Promise<TtResourceRow[]> => {
      const { data, error } = await supabase
        .from("tt_resources" as never)
        .select("id, name, kind, capacity, description")
        .eq("institution_id", institutionId!)
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as TtResourceRow[];
    },
  });
}

export interface CreateResourceInput {
  name: string;
  kind: ResourceKind;
  capacity: number;
  description: string | null;
}

export function useCreateResource() {
  const { institutionId } = useEffectiveInstitution();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateResourceInput) => {
      const { data: userRes } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("tt_resources" as never)
        .insert({
          institution_id: institutionId!,
          name: input.name,
          kind: input.kind,
          capacity: input.capacity,
          description: input.description,
          created_by: userRes.user?.id ?? null,
        } as never)
        .select()
        .single();
      if (error) throw error;
      return data as TtResourceRow;
    },
    onSuccess: () => {
      toast.success("Resource added");
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "resources"] });
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't add the resource.", context: "createResource" }),
  });
}

export function useDeleteResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (resourceId: string) => {
      const { error } = await supabase
        .from("tt_resources" as never)
        .delete()
        .eq("id", resourceId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Resource deleted");
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "resources"] });
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't delete the resource.", context: "deleteResource" }),
  });
}

// =============================================================
// CALENDAR WINDOW — per-weekday holiday / exam-block labels
// =============================================================

export interface CalendarWindowV2 {
  holidaysByDay: Record<Weekday, string | null>;
  examBlocksByDay: Record<Weekday, string | null>;
  holidays: Set<Weekday>;
}

function emptyDayMap<T>(fill: T): Record<Weekday, T> {
  return {
    monday: fill,
    tuesday: fill,
    wednesday: fill,
    thursday: fill,
    friday: fill,
    saturday: fill,
    sunday: fill,
  };
}

function jsDayToWeekday(day: number): Weekday {
  const map: Weekday[] = [
    "sunday", "monday", "tuesday", "wednesday",
    "thursday", "friday", "saturday",
  ];
  return map[day];
}

/**
 * Scans cal_events for the AY and, for each weekday that's in the
 * class's working_days set, returns the first holiday/exam-block
 * title encountered. The grid uses these labels under each day
 * header + as an overlay on cells. Mirrors the legacy
 * useCalendarWindow shape so the v2 grid can reuse the same
 * rendering pattern.
 */
export function useCalendarWindowV2(
  academicYear: string,
  workingDays: Weekday[] | null,
) {
  const { institutionId } = useEffectiveInstitution();
  return useQuery({
    queryKey: ["timetable-v2", "calendar-window", institutionId, academicYear, workingDays?.join(",")],
    enabled: !!institutionId && !!academicYear && !!workingDays && workingDays.length > 0,
    queryFn: async (): Promise<CalendarWindowV2> => {
      const out: CalendarWindowV2 = {
        holidaysByDay: emptyDayMap<string | null>(null),
        examBlocksByDay: emptyDayMap<string | null>(null),
        holidays: new Set<Weekday>(),
      };

      const { data, error } = await supabase
        .from("cal_events" as never)
        .select("kind, title, starts_on, ends_on")
        .eq("institution_id", institutionId!)
        .eq("academic_year", academicYear);
      if (error) throw error;

      type Row = { kind: string; title: string; starts_on: string; ends_on: string };
      const rows = (data ?? []) as Row[];
      const working = new Set(workingDays ?? []);

      for (const row of rows) {
        const start = new Date(row.starts_on);
        const end = row.ends_on ? new Date(row.ends_on) : start;
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const wd = jsDayToWeekday(d.getDay());
          if (!working.has(wd)) continue;
          if (row.kind === "holiday") {
            out.holidays.add(wd);
            if (!out.holidaysByDay[wd]) out.holidaysByDay[wd] = row.title;
          } else if (row.kind === "exam_block") {
            if (!out.examBlocksByDay[wd]) out.examBlocksByDay[wd] = row.title;
          }
        }
      }
      return out;
    },
  });
}

// =============================================================
// TEACHER LOAD — aggregated hours across scope
// =============================================================

export interface TeacherLoadRow {
  teacherId: string;
  teacherName: string;
  dayCounts: Record<Weekday, number>;
  total: number;
}

/**
 * Aggregates tt_slots by teacher across all classes in scope.
 * Admin: every class in the institution. Coordinator: classes in
 * their wing_assignments. Used by the class workspace to surface
 * "is this teacher already full elsewhere" when filling a cell.
 */
export function useTeacherLoadV2(academicYear: string, wingId: string | null) {
  const { institutionId } = useEffectiveInstitution();
  return useQuery({
    queryKey: ["timetable-v2", "teacher-load", institutionId, academicYear, wingId],
    enabled: !!institutionId && !!academicYear,
    queryFn: async (): Promise<TeacherLoadRow[]> => {
      // 1. All slots with a teacher in the AY (RLS already narrows
      //    to classes the caller can see — no need to redo the
      //    class-scope filter here).
      const { data: slotData, error: slotErr } = await supabase
        .from("tt_slots" as never)
        .select(
          "teacher_id, day, class_id, teacher:profiles!tt_slots_teacher_id_fkey(id, full_name)",
        )
        .eq("academic_year", academicYear)
        .not("teacher_id", "is", null);
      if (slotErr) throw slotErr;
      type Row = {
        teacher_id: string;
        day: Weekday;
        class_id: string;
        teacher: { id: string; full_name: string | null } | null;
      };
      let rows = (slotData ?? []) as unknown as Row[];

      // 1b. Optional-group periods carry teacher_id NULL (the basket holds
      //     several subjects, each with its own teacher), so the query above
      //     counts them as zero load. Resolve each group cell to the teachers
      //     who actually teach one of its subjects in that class, otherwise an
      //     admin reads a teacher as free and double-books a period she is
      //     already teaching. Bounded read; one row per (slot, teacher).
      const { data: groupSlotData, error: groupSlotErr } = await supabase
        .from("tt_slots" as never)
        .select("id, day, class_id, optional_group_id")
        .eq("academic_year", academicYear)
        .not("optional_group_id", "is", null)
        .range(0, 999);
      if (groupSlotErr) throw groupSlotErr;
      type GroupSlotRow = { id: string; day: Weekday; class_id: string; optional_group_id: string };
      const groupSlots = (groupSlotData ?? []) as unknown as GroupSlotRow[];

      if (groupSlots.length > 0) {
        const groupIds = [...new Set(groupSlots.map((g) => g.optional_group_id))];
        const classIds = [...new Set(groupSlots.map((g) => g.class_id))];

        const [{ data: memberData, error: memberErr }, { data: assignData, error: assignErr }] =
          await Promise.all([
            supabase
              .from("optional_group_subjects")
              .select("group_id, subject_id")
              .in("group_id", groupIds)
              .range(0, 999),
            supabase
              .from("class_assignments")
              .select("class_id, subject_id, user_id, profiles:profiles!class_assignments_user_id_fkey(id, full_name)")
              .in("class_id", classIds)
              .eq("role", "teacher")
              .not("subject_id", "is", null)
              .range(0, 1999),
          ]);
        if (memberErr) throw memberErr;
        if (assignErr) throw assignErr;

        const subjectsByGroup = new Map<string, string[]>();
        for (const m of (memberData ?? []) as { group_id: string; subject_id: string }[]) {
          const list = subjectsByGroup.get(m.group_id) ?? [];
          list.push(m.subject_id);
          subjectsByGroup.set(m.group_id, list);
        }
        type AssignRow = {
          class_id: string; subject_id: string | null; user_id: string;
          profiles: { id: string; full_name: string | null } | null;
        };
        const teachersByClassSubject = new Map<string, AssignRow[]>();
        for (const a of (assignData ?? []) as unknown as AssignRow[]) {
          if (!a.subject_id) continue;
          const k = `${a.class_id}|${a.subject_id}`;
          const list = teachersByClassSubject.get(k) ?? [];
          list.push(a);
          teachersByClassSubject.set(k, list);
        }

        for (const g of groupSlots) {
          const seen = new Set<string>();
          for (const subjectId of subjectsByGroup.get(g.optional_group_id) ?? []) {
            for (const a of teachersByClassSubject.get(`${g.class_id}|${subjectId}`) ?? []) {
              // A teacher teaching two subjects of the same basket still owes
              // this period exactly once.
              if (seen.has(a.user_id)) continue;
              seen.add(a.user_id);
              rows.push({
                teacher_id: a.user_id,
                day: g.day,
                class_id: g.class_id,
                teacher: { id: a.user_id, full_name: a.profiles?.full_name ?? null },
              });
            }
          }
        }
      }

      // 2. If coordinator wants only their wing, filter to classes
      //    in wing_class_mappings for that wing.
      if (wingId) {
        const classIdSet = new Set<string>();
        const { data: mapRows, error: mapErr } = await supabase
          .from("wing_class_mappings")
          .select("class_id")
          .eq("wing_id", wingId);
        if (mapErr) throw mapErr;
        for (const m of (mapRows ?? []) as { class_id: string }[]) {
          classIdSet.add(m.class_id);
        }
        rows = rows.filter((r) => classIdSet.has(r.class_id));
      }

      // 3. Aggregate.
      const acc = new Map<string, TeacherLoadRow>();
      for (const r of rows) {
        if (!r.teacher_id) continue;
        const existing = acc.get(r.teacher_id) ?? {
          teacherId: r.teacher_id,
          teacherName: r.teacher?.full_name ?? "Unnamed teacher",
          dayCounts: emptyDayMap(0),
          total: 0,
        };
        existing.dayCounts[r.day] = (existing.dayCounts[r.day] ?? 0) + 1;
        existing.total += 1;
        acc.set(r.teacher_id, existing);
      }
      return Array.from(acc.values()).sort((a, b) => b.total - a.total);
    },
  });
}

function dayIndex(d: Weekday): number {
  const order: Record<Weekday, number> = {
    monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
    friday: 4, saturday: 5, sunday: 6,
  };
  return order[d];
}

export function useSetPublishStatusV2(classId: string | null, academicYear: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (status: "draft" | "published") => {
      // Route through the SECURITY DEFINER RPC so a coordinator-in-wing
      // can publish the class they edit, without giving them blanket
      // write access on tt_class_structure (assignment + delete stay
      // admin-only via the existing RLS policy).
      const { error } = await supabase.rpc(
        "tt_set_publish_status" as never,
        {
          p_class_id: classId!,
          p_academic_year: academicYear,
          p_status: status,
        } as never,
      );
      if (error) throw error;
      return status;
    },
    onSuccess: (status) => {
      toast.success(status === "published" ? "Timetable published" : "Reverted to draft");
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "workspace", classId, academicYear] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "class-list"] });
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't change publish state.", context: "setPublishStatusV2" }),
  });
}
