import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { toastError } from "@/lib/toast";
import { callPtmRpc, ptmKeys } from "./ptmClient";

/** One row of ptm_booking_grid(_ptm_id, _class_id): a computed slot, plus
 *  any booking whose slot_time no longer fits the grid (`off_grid`). Names
 *  are NULL for students; they only see free or taken. */
export interface PTMSlotRow {
  slot_time: string;
  booking_id: string | null;
  student_id: string | null;
  student_name: string | null;
  attended: boolean | null;
  is_mine: boolean;
  off_grid: boolean;
}

/** One row of ptm_my_bookings(): the calling student's active bookings.
 *  `teacher_id` and `meet_uri` are set for online PTMs only, and only once
 *  the online migration is live (older rows leave them undefined). */
export interface PTMMyBooking {
  ptm_id: string;
  booking_id: string;
  slot_time: string;
  class_id: string;
  teacher_id?: string | null;
  meet_uri?: string | null;
}

/**
 * The slot grid for one class. `classId` NULL means "the caller's own class",
 * which is how a student asks for it; staff always name the class.
 */
export function usePTMBookingGrid(ptmId: string | null, classId: string | null, enabled = true) {
  return useQuery({
    queryKey: ptmKeys.grid(ptmId, classId),
    queryFn: async (): Promise<PTMSlotRow[]> => {
      if (!ptmId) return [];
      const rows = await callPtmRpc<PTMSlotRow[] | null>("ptm_booking_grid", {
        _ptm_id: ptmId,
        _class_id: classId,
      });
      return rows ?? [];
    },
    enabled: enabled && !!ptmId,
    // Slots change hands while families book; a minute is the floor
    // CLAUDE.md 23 allows without a justification, and the booking RPC
    // reports a taken slot anyway.
    staleTime: 60_000,
  });
}

export function usePTMMyBookings(enabled = true) {
  return useQuery({
    queryKey: ptmKeys.myBookings,
    queryFn: async (): Promise<PTMMyBooking[]> => {
      const rows = await callPtmRpc<PTMMyBooking[] | null>("ptm_my_bookings");
      return rows ?? [];
    },
    enabled,
    staleTime: 60_000,
  });
}

function invalidateBookings(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["ptm-booking-grid"] });
  queryClient.invalidateQueries({ queryKey: ptmKeys.myBookings });
  queryClient.invalidateQueries({ queryKey: ["ptm-feedback-summary"] });
  // Online PTMs: the per-teacher grid, the student's session and the staff
  // session counts all show bookings too.
  queryClient.invalidateQueries({ queryKey: ["ptm-online-grid"] });
  queryClient.invalidateQueries({ queryKey: ptmKeys.onlineMySessions });
  queryClient.invalidateQueries({ queryKey: ["ptm-online-sessions"] });
}

/**
 * Book, or move, the family's slot. The same RPC serves both modes. Online,
 * the server checks the teacher against the student's own participant
 * rows, so a family can only ever book their own teachers; `teacherId` is
 * sent only when the family has several teachers on the PTM (spec
 * 2026-10-09, section 5.5), so an older server sees the call it knows.
 */
export function useBookPTMSlot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      ptmId: string;
      slotTime: string;
      replace: boolean;
      teacherId?: string | null;
      /** For the toast only. */
      teacherName?: string | null;
    }) =>
      callPtmRpc<string>("book_ptm_slot", {
        _ptm_id: input.ptmId,
        _slot_time: input.slotTime,
        _replace: input.replace,
        ...(input.teacherId ? { _teacher_id: input.teacherId } : {}),
      }),
    onSuccess: (_id, input) => {
      invalidateBookings(queryClient);
      const who = input.teacherName ? ` with ${input.teacherName}` : "";
      toast.success(input.replace ? `Your slot${who} has been moved.` : `Slot booked${who}.`);
    },
    onError: (e: Error) => {
      // "That slot was just taken": redraw the grid so the taken tile shows.
      queryClient.invalidateQueries({ queryKey: ["ptm-booking-grid"] });
      queryClient.invalidateQueries({ queryKey: ["ptm-online-grid"] });
      toastError(e, { fallback: "Couldn't book that slot.", context: "bookPTMSlot" });
    },
  });
}

export function useCancelPTMBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bookingId: string }) => {
      await callPtmRpc<null>("cancel_ptm_booking", { _booking_id: input.bookingId });
    },
    onSuccess: () => {
      invalidateBookings(queryClient);
      toast.success("Booking cancelled.");
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't cancel the booking.", context: "cancelPTMBooking" }),
  });
}

export function useSetPTMBookingAttended() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bookingId: string; attended: boolean }) => {
      await callPtmRpc<null>("set_ptm_booking_attended", {
        _booking_id: input.bookingId,
        _attended: input.attended,
      });
    },
    onSuccess: () => invalidateBookings(queryClient),
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't update attendance.", context: "setPTMBookingAttended" }),
  });
}
