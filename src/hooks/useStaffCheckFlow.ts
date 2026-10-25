import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import {
  useAttendanceSettings,
  useEffectiveAttendanceSettings,
  type AttendanceSettingsRow,
} from "@/hooks/useAttendance";
import { useCheckInStaff, useCheckOutStaff } from "@/hooks/useStaffAttendance";
import { useTeacherPendingSyllabusDays } from "@/hooks/useSyllabusProgress";
import { useUserRole } from "@/hooks/useUserRole";
import type { DashboardActions } from "@/lib/dashboardActions";
import { DASHBOARD_ACTIONS_KEY } from "@/lib/dashboardActionsKey";

export interface StaffCheckFlow {
  institutionId: string | null;
  /** The school's settings merged over the defaults (null without an institution). */
  settings: AttendanceSettingsRow | null;
  settingsLoading: boolean;
  isTeacher: boolean;
  checkIn: () => void;
  checkOut: (recordId: string) => void;
  checkingIn: boolean;
  checkingOut: boolean;
  backlogOpen: boolean;
  setBacklogOpen: (open: boolean) => void;
  syllabusOpen: boolean;
  setSyllabusOpen: (open: boolean) => void;
}

/**
 * The staff member's own check-in and check-out, shared by the greeting button
 * (StaffCheckInCard) and the dashboard action cards, so both record the same way and
 * open the same teacher sheets afterwards:
 *   check in  -> CheckInBacklogSheet, only when there are unlogged days;
 *   check out -> CheckOutSyllabusSheet, dismissible. Check-out is NEVER blocked.
 * Render <StaffCheckSheets flow={…} /> from a component that stays mounted when the button
 * or card that started the action disappears.
 *
 * Single flight: a ref, not isPending, guards each action, because a second tap in the
 * same frame still sees the old isPending (§23: mutations are idempotent). On success the
 * dashboard's card is dropped from the cached answer at once, so there is no second tap in
 * the gap before the refetch lands. The database's UNIQUE(staff_id, date) and the friendly
 * 23505 toast stay as the last line.
 */
export function useStaffCheckFlow(): StaffCheckFlow {
  const queryClient = useQueryClient();
  const { data: roleInfo } = useUserRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const settings = useEffectiveAttendanceSettings(institutionId);
  const { isLoading: settingsLoading } = useAttendanceSettings(institutionId);
  const checkInMutation = useCheckInStaff();
  const checkOutMutation = useCheckOutStaff();
  const isTeacher = !!roleInfo?.isTeacher;
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [syllabusOpen, setSyllabusOpen] = useState(false);
  const checkInFlight = useRef(false);
  const checkOutFlight = useRef(false);
  // Same cache key as the My Week chip (staleTime 60s, teachers only): the backlog sheet
  // opens only when there is a backlog, never as an empty sheet every morning.
  const pendingBacklog = useTeacherPendingSyllabusDays({ includeToday: false, enabled: isTeacher });

  // Drop the card just used from every cached answer that holds a good one, so there is no
  // second tap before the refetch lands. A plain setQueriesData would turn a failed answer into
  // a "success" holding the last good one (old cards standing in for a failed check, §6) and
  // make every answer look brand new, so: good answers only, each keeping its own age, and all
  // marked stale again, as the write's own invalidation had left them.
  const dropCard = (card: "checkIn" | "checkOut") => {
    for (const query of queryClient.getQueryCache().findAll({ queryKey: DASHBOARD_ACTIONS_KEY })) {
      const answer = query.state.data as DashboardActions | undefined;
      if (query.state.status !== "success" || !answer) continue;
      queryClient.setQueryData<DashboardActions>(
        query.queryKey,
        card === "checkIn" ? { ...answer, checkIn: null } : { ...answer, checkOut: null },
        { updatedAt: query.state.dataUpdatedAt },
      );
    }
    void queryClient.invalidateQueries({ queryKey: DASHBOARD_ACTIONS_KEY, refetchType: "none" });
  };

  const checkIn = () => {
    if (!institutionId || checkInFlight.current) return;
    checkInFlight.current = true;
    checkInMutation.mutate(
      { institutionId, settings },
      {
        onSuccess: () => {
          dropCard("checkIn");
          if (isTeacher && (pendingBacklog.data?.unresolved_day_count ?? 0) > 0) setBacklogOpen(true);
        },
        onSettled: () => {
          checkInFlight.current = false;
        },
      },
    );
  };

  const checkOut = (recordId: string) => {
    if (checkOutFlight.current) return;
    checkOutFlight.current = true;
    checkOutMutation.mutate(recordId, {
      // Everyone checks out on the tap; teachers then get the syllabus sheet for today's
      // classes, which they can dismiss (it gated the check-out until 2026-09-11). A tap that
      // found the day already closed (row null) changed nothing, so it opens no sheet.
      onSuccess: (row) => {
        dropCard("checkOut");
        if (isTeacher && row) setSyllabusOpen(true);
      },
      onSettled: () => {
        checkOutFlight.current = false;
      },
    });
  };

  return {
    institutionId,
    settings,
    settingsLoading,
    isTeacher,
    checkIn,
    checkOut,
    checkingIn: checkInMutation.isPending,
    checkingOut: checkOutMutation.isPending,
    backlogOpen,
    setBacklogOpen,
    syllabusOpen,
    setSyllabusOpen,
  };
}
