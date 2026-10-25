import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { toastError } from "@/lib/toast";
import { callPtmRpc, ptmKeys } from "./ptmClient";

/**
 * The Google account a teacher joins Meet with. It lives in
 * `user_google_accounts`, a table the browser cannot read (Tushar,
 * 2026-10-05: `profiles` is readable school-wide, so a personal Gmail
 * there would leak to students). Read through `get_google_email`, which
 * allows yourself or a school admin asking about someone in their school;
 * write through `set_google_email`. Everyone else only ever sees
 * `has_google_email` from the pickers.
 */

/** Looks like an email. The server cannot tell a Google account from any
 *  other address, so the copy says what to enter rather than checking. */
export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** The stored address, or null when none is set. `self` asks for the
 *  caller's own; otherwise `userId` is a teacher an admin is looking at. */
export function useGoogleEmail(userId: string | null, self: boolean, enabled = true) {
  return useQuery({
    queryKey: ptmKeys.googleEmail(userId),
    queryFn: async (): Promise<string | null> => {
      if (!userId) return null;
      const email = await callPtmRpc<string | null>("get_google_email", {
        _user_id: self ? null : userId,
      });
      return email ?? null;
    },
    enabled: enabled && !!userId,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useMyGoogleEmail(userId: string | null, enabled = true) {
  return useGoogleEmail(userId, true, enabled);
}

/*
 * The login email IS the Google account unless someone set another (Naman,
 * 2026-10-05). Since 20261006120000 the server does this itself:
 * `get_google_email` falls back to the login email and no online PTM call
 * refuses a teacher without a row. The one-day frontend bridge that wrote the
 * default through `set_google_email` (28b4dedb) was removed on 2026-10-06.
 */

/** Set or clear a Google account: your own, or (an admin) a teacher's. */
export function useSetGoogleEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; email: string | null; self: boolean }) => {
      await callPtmRpc<null>("set_google_email", {
        _email: input.email ? input.email.trim().toLowerCase() : null,
        _user_id: input.self ? null : input.userId,
      });
    },
    onSuccess: (_v, input) => {
      queryClient.invalidateQueries({ queryKey: ptmKeys.googleEmail(input.userId) });
      queryClient.invalidateQueries({ queryKey: ["ptm-online-teacher-options"] });
      queryClient.invalidateQueries({ queryKey: ["ptm-online-sessions"] });
      toast.success(input.email ? "Google account saved." : "Google account removed.");
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't save the Google account.", context: "setGoogleEmail" }),
  });
}
