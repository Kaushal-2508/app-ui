import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { useUserRole } from "@/hooks/useUserRole";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { resolvePTMHat, type PTMHat, type PTMMode, type PTMScopeType } from "@/lib/ptm";
import { callPtmRpc, isMissingSchemaError, probeFrom, ptmKeys, type PgError } from "./ptmClient";

/**
 * How much of the PTM schema is live: `legacy` (the pre-2026-09-28 columns
 * only), `full` (Tushar's PTM migration), `online` (the residential mode
 * columns of 2026-10-03). Each level reads with its own select, so a column
 * that is not there yet never fails the whole list.
 */
export type PTMSchemaLevel = "legacy" | "full" | "online" | "sessions";

/** PostgREST types a to-one embed as `T | T[]`; collapse it to the object. */
const pickOne = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? v[0] ?? null : v ?? null;

export interface PTMClassRef {
  id: string;
  name: string;
  section: string | null;
}

export interface PTMSchedule {
  id: string;
  institution_id: string;
  title: string;
  description: string | null;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  /** Legacy single-class column; unioned into `classes` below. */
  class_id: string | null;
  slot_duration_minutes: number;
  /** Stored status: `scheduled` or `cancelled` (older rows may carry
   *  `completed`). What the card shows is ptmEffectiveStatus(). */
  status: string;
  created_by: string | null;
  /** The hat the creator acted under; drives who else may edit or cancel.
   *  NULL on legacy rows, which were admin-only. */
  created_as_role: PTMHat | null;
  venue: string | null;
  scope_type: PTMScopeType;
  scope_wing_id: string | null;
  scope_wing_name: string | null;
  slot_booking_enabled: boolean;
  booking_cutoff_minutes: number;
  feedback_edit_days: number;
  /** Readable by everyone who can see the row; a student in scope is a
   *  legitimate submitter, and the RPC re-checks scope on every call. */
  feedback_token: string | null;
  cancelled_at: string | null;
  /** Empty means school-wide (zero junction rows and no legacy class_id) for
   *  an in-person PTM. An online PTM has no class rows at all: its reach is
   *  the students its teachers picked. */
  classes: PTMClassRef[];
  /** `in_person` until the online migration is live. */
  mode: PTMMode;
  /** Gap after every slot, online only (0 for in-person PTMs). */
  slot_buffer_minutes: number;
  /** Online: the participating teachers. Empty for in-person PTMs, and for
   *  students (the table is readable by staff only). */
  online_teacher_ids: string[];
}

/** One row of ptm_manageable_scope(_as_role): what this hat may target. */
export interface PTMManageableScope {
  can_school: boolean;
  wings: { id: string; name: string; class_ids: string[] }[];
  classes: { id: string; name: string; section: string | null; wing_id: string | null }[];
}

const BASE_COLUMNS =
  "id, institution_id, title, description, scheduled_date, start_time, end_time, class_id, slot_duration_minutes, status, created_by";
const NEW_COLUMNS =
  "created_as_role, venue, scope_type, scope_wing_id, slot_booking_enabled, booking_cutoff_minutes, feedback_edit_days, feedback_token, cancelled_at";
const EMBEDS =
  "class:classes(id, name, section), schedule_classes:ptm_schedule_classes(classes(id, name, section))";
const WING_EMBED = "scope_wing:wings(id, name)";
const ONLINE_COLUMNS = "mode, slot_buffer_minutes";
const ONLINE_EMBED = "online_teachers:ptm_online_teachers(teacher_id)";

/** The selects stay template literals: `+` widens to plain string and drops
 *  the literal type supabase-js uses to type embeds (see usePTM.ts history). */
const LEGACY_SELECT = `${BASE_COLUMNS}, ${EMBEDS}` as const;
const FULL_SELECT = `${BASE_COLUMNS}, ${NEW_COLUMNS}, ${EMBEDS}, ${WING_EMBED}` as const;
const ONLINE_SELECT =
  `${BASE_COLUMNS}, ${NEW_COLUMNS}, ${ONLINE_COLUMNS}, ${EMBEDS}, ${WING_EMBED}, ${ONLINE_EMBED}` as const;

/** The raw row either select returns. New columns are optional so the same
 *  mapper serves both shapes. */
type RawScheduleRow = {
  id: string;
  institution_id: string;
  title: string;
  description: string | null;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  class_id: string | null;
  slot_duration_minutes: number;
  status: string;
  created_by: string | null;
  created_as_role?: string | null;
  venue?: string | null;
  scope_type?: string | null;
  scope_wing_id?: string | null;
  slot_booking_enabled?: boolean | null;
  booking_cutoff_minutes?: number | null;
  feedback_edit_days?: number | null;
  feedback_token?: string | null;
  cancelled_at?: string | null;
  mode?: string | null;
  slot_buffer_minutes?: number | null;
  class: PTMClassRef | PTMClassRef[] | null;
  schedule_classes: { classes: PTMClassRef | PTMClassRef[] | null }[] | null;
  scope_wing?: { id: string; name: string } | { id: string; name: string }[] | null;
  online_teachers?: { teacher_id: string }[] | null;
};

function toHat(value: string | null | undefined): PTMHat | null {
  return value === "admin" || value === "coordinator" || value === "teacher" ? value : null;
}

function toScopeType(value: string | null | undefined, classCount: number): PTMScopeType {
  if (value === "school" || value === "wing" || value === "class") return value;
  // Legacy rows predate scope_type: infer it from the class list.
  return classCount === 0 ? "school" : "class";
}

function mapScheduleRow(row: RawScheduleRow): PTMSchedule {
  const legacyClass = pickOne<PTMClassRef>(row.class);
  const junctionClasses = (row.schedule_classes ?? [])
    .map((link) => pickOne<PTMClassRef>(link.classes))
    .filter((c): c is PTMClassRef => c !== null);
  // The legacy single class_id and the junction rows are unioned server-side
  // too (ptm_audience); mirror that so a PTM never drops its scope depending
  // on which column carries it.
  const classes =
    legacyClass && !junctionClasses.some((c) => c.id === legacyClass.id)
      ? [...junctionClasses, legacyClass]
      : junctionClasses;
  const wing = pickOne(row.scope_wing);
  return {
    id: row.id,
    institution_id: row.institution_id,
    title: row.title,
    description: row.description,
    scheduled_date: row.scheduled_date,
    start_time: row.start_time,
    end_time: row.end_time,
    class_id: row.class_id,
    slot_duration_minutes: row.slot_duration_minutes,
    status: row.status,
    created_by: row.created_by,
    created_as_role: toHat(row.created_as_role),
    venue: row.venue ?? null,
    scope_type: toScopeType(row.scope_type, classes.length),
    scope_wing_id: row.scope_wing_id ?? null,
    scope_wing_name: wing?.name ?? null,
    slot_booking_enabled: row.slot_booking_enabled ?? false,
    booking_cutoff_minutes: row.booking_cutoff_minutes ?? 60,
    feedback_edit_days: row.feedback_edit_days ?? 3,
    feedback_token: row.feedback_token ?? null,
    cancelled_at: row.cancelled_at ?? null,
    classes,
    mode: row.mode === "online" ? "online" : "in_person",
    slot_buffer_minutes: row.slot_buffer_minutes ?? 0,
    online_teacher_ids: (row.online_teachers ?? []).map((t) => t.teacher_id),
  };
}

/**
 * Schema probe: which PTM migrations have landed? Bounded reads of one new
 * column each, widest first, cached for the session. "Column does not
 * exist" steps down a level; any other failure reads as `legacy`, because
 * the PTM tab must keep rendering the legacy rows on the probe. Below
 * `full` every write action stays hidden; below `online` the residential
 * option, the mode badges and the Join buttons stay hidden.
 */
export function usePTMSchemaReady(enabled = true) {
  const query = useQuery({
    queryKey: ptmKeys.ready,
    queryFn: async (): Promise<PTMSchemaLevel> => {
      const online = await supabase.from("ptm_schedules").select("id, scope_type, mode").limit(1);
      if (!online.error) {
        // Class sessions (2026-10-06): the table's existence is the whole
        // test. "Does not exist" keeps the flat online shapes; a permission
        // error means the table is there but not readable by this account,
        // which still says the migration landed (the RPCs are what the
        // frontend actually calls).
        const sessions = await probeFrom("ptm_online_class_sessions").select("id").limit(0);
        return sessions.error && isMissingSchemaError(sessions.error as PgError) ? "online" : "sessions";
      }
      if (!isMissingSchemaError(online.error as PgError)) return "legacy";
      const full = await supabase.from("ptm_schedules").select("id, scope_type").limit(1);
      return full.error ? "legacy" : "full";
    },
    enabled,
    // A schema change is a deploy, not a minute-by-minute event.
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const level: PTMSchemaLevel = query.data ?? "legacy";
  return {
    ready: level !== "legacy",
    onlineReady: level === "online" || level === "sessions",
    /** Class sessions of an admin-made online PTM (spec 2026-10-06). */
    sessionsReady: level === "sessions",
    level,
    isLoading: query.isLoading,
  };
}

function selectFor(level: PTMSchemaLevel) {
  const base = supabase.from("ptm_schedules");
  return level === "online" || level === "sessions"
    ? base.select(ONLINE_SELECT)
    : level === "full"
      ? base.select(FULL_SELECT)
      : base.select(LEGACY_SELECT);
}

/**
 * The hat this account acts under for PTM rights. Resolved from the raw
 * roles for single-role accounts and from the app-bar switcher for dual-role
 * ones (CLAUDE.md section 25). NULL for students and platform admins.
 */
export function usePTMHat(): { hat: PTMHat | null; isLoading: boolean } {
  const { data: roleInfo, isLoading } = useUserRole();
  const { activeViewRole, hasDualRole } = useActiveRole();
  const hat = useMemo(
    () => resolvePTMHat(roleInfo, activeViewRole, hasDualRole),
    [roleInfo, activeViewRole, hasDualRole],
  );
  return { hat, isLoading };
}

/**
 * `enabled` lets the caller wait for the schema probe, so the list is fetched
 * once with the right select instead of legacy-then-full on every cold load.
 */
export function usePTMSchedules(
  institutionId: string | null,
  level: PTMSchemaLevel,
  enabled = true,
) {
  return useQuery({
    queryKey: ptmKeys.schedules(institutionId, level),
    queryFn: async (): Promise<PTMSchedule[]> => {
      if (!institutionId) return [];
      const { data, error } = await selectFor(level)
        .eq("institution_id", institutionId)
        .order("scheduled_date", { ascending: false })
        .order("start_time", { ascending: false })
        // A school runs a handful of PTMs a term, but "a filter is not a
        // bound" (CLAUDE.md 23): PostgREST silently caps at 1000 anyway.
        .range(0, 99);
      if (error) throw error;
      return ((data ?? []) as unknown as RawScheduleRow[]).map(mapScheduleRow);
    },
    enabled: enabled && !!institutionId,
    staleTime: 60_000,
  });
}

export function usePTMSchedule(ptmId: string | null, level: PTMSchemaLevel) {
  return useQuery({
    queryKey: ptmKeys.schedule(ptmId, level),
    queryFn: async (): Promise<PTMSchedule | null> => {
      if (!ptmId) return null;
      const { data, error } = await selectFor(level).eq("id", ptmId).maybeSingle();
      if (error) throw error;
      return data ? mapScheduleRow(data as unknown as RawScheduleRow) : null;
    },
    enabled: !!ptmId,
    staleTime: 60_000,
  });
}

/** What the current hat may schedule for. Drives the scope picker and the
 *  Edit / Cancel visibility; the server re-checks every write. */
export function usePTMManageableScope(hat: PTMHat | null, enabled = true) {
  return useQuery({
    queryKey: ptmKeys.scope(hat),
    queryFn: async (): Promise<PTMManageableScope> => {
      const data = await callPtmRpc<PTMManageableScope | null>("ptm_manageable_scope", {
        _as_role: hat,
      });
      return data ?? { can_school: false, wings: [], classes: [] };
    },
    enabled: enabled && !!hat,
    // Wing and class assignments change rarely; this is picker furniture.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export interface CreatePTMInput {
  institutionId: string;
  hat: PTMHat;
  title: string;
  description: string;
  venue: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  scopeType: PTMScopeType;
  scopeWingId: string | null;
  classIds: string[];
  slotBookingEnabled: boolean;
  slotDurationMinutes: number;
  bookingCutoffMinutes: number;
  feedbackEditDays: number;
}

export function useCreatePTM() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePTMInput): Promise<string> =>
      callPtmRpc<string>("create_ptm_schedule", {
        _institution_id: input.institutionId,
        _title: input.title.trim(),
        _description: input.description.trim() || null,
        _scheduled_date: input.scheduledDate,
        _start_time: input.startTime,
        _end_time: input.endTime,
        _slot_duration_minutes: input.slotDurationMinutes,
        _class_ids: input.scopeType === "class" ? input.classIds : null,
        _as_role: input.hat,
        _scope_type: input.scopeType,
        _scope_wing_id: input.scopeType === "wing" ? input.scopeWingId : null,
        _venue: input.venue.trim() || null,
        _slot_booking_enabled: input.slotBookingEnabled,
        _booking_cutoff_minutes: input.bookingCutoffMinutes,
        _feedback_edit_days: input.feedbackEditDays,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ptm-schedules"] });
      // The notification fanout is a DB trigger, so it has already run in
      // the same transaction by the time we get here.
      toast.success("PTM scheduled. Teachers and students have been notified.");
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't schedule the PTM.", context: "createPTM" }),
  });
}

export interface UpdatePTMInput {
  ptmId: string;
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

export function useUpdatePTM() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdatePTMInput): Promise<void> => {
      await callPtmRpc<null>("update_ptm_schedule", {
        _ptm_id: input.ptmId,
        _title: input.title.trim(),
        _description: input.description.trim() || null,
        _venue: input.venue.trim() || null,
        _scheduled_date: input.scheduledDate,
        _start_time: input.startTime,
        _end_time: input.endTime,
        _slot_booking_enabled: input.slotBookingEnabled,
        _slot_duration_minutes: input.slotDurationMinutes,
        _booking_cutoff_minutes: input.bookingCutoffMinutes,
        _feedback_edit_days: input.feedbackEditDays,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ptm-schedules"] });
      queryClient.invalidateQueries({ queryKey: ["ptm-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["ptm-booking-grid"] });
      // tg_ptm_notify_changed decides whether a reschedule notice goes out.
      toast.success("PTM updated. If the date or time changed, everyone has been told.");
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't update the PTM.", context: "updatePTM" }),
  });
}

export function useCancelPTM() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ptmId: string; reason: string }): Promise<void> => {
      await callPtmRpc<null>("cancel_ptm_schedule", {
        _ptm_id: input.ptmId,
        _reason: input.reason.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ptm-schedules"] });
      queryClient.invalidateQueries({ queryKey: ["ptm-schedule"] });
      toast.success("PTM cancelled. Everyone it was scheduled for has been told.");
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't cancel the PTM.", context: "cancelPTM" }),
  });
}
