import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { compressSheetToBase64 } from "@/lib/hybridImage";

/**
 * Phone-side hooks for the hybrid upload flow (Phase 3).
 *
 * The phone page is unauthenticated — the token IS the auth. Both edge
 * functions accept the anon key in Authorization (default behaviour of
 * supabase.functions.invoke when there is no user session) and validate the
 * pairing token themselves.
 */

// ── Device fingerprint ──────────────────────────────────────────────────
//
// Per the plan: simple userAgent + screen + timezone combo. No external
// fingerprinting library. Stable across page reloads within the same browser
// session/device.

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function getDeviceFingerprint(): string {
  if (typeof window === "undefined") return "ssr";
  const ua = navigator.userAgent || "";
  const screen = typeof window.screen !== "undefined"
    ? `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth || 0}`
    : "0x0x0";
  const tz =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "unknown"
      : "unknown";
  return fnv1a(`${ua}|${screen}|${tz}`);
}

// ── Validate token ───────────────────────────────────────────────────────

export interface ValidatedPairing {
  attempt_id: string;
  attempt_status: string;
  exam_id: string;
  exam_title: string;
  student_name: string;
  max_pages: number;
  expires_at: string;
  institution_id: string;
}

async function unwrapFunctionError(error: unknown): Promise<Error> {
  // supabase-js v2.89+ wraps the real body on error.context — same pattern as
  // CLAUDE.md §21 and useHybridPairingToken.
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = (await ctx.json()) as { error?: string };
      if (body?.error) return new Error(body.error);
    } catch {
      /* fall through */
    }
  }
  return error instanceof Error ? error : new Error("Unknown error");
}

export function useValidatePairingToken(token: string | undefined) {
  const deviceFingerprint = useMemo(() => getDeviceFingerprint(), []);
  return useQuery({
    queryKey: ["hybrid-validate-token", token, deviceFingerprint],
    enabled: !!token,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<ValidatedPairing> => {
      const { data, error } = await supabase.functions.invoke(
        "validate-hybrid-pairing-token",
        { body: { token, device_fingerprint: deviceFingerprint } },
      );
      if (error) throw await unwrapFunctionError(error);
      return data as ValidatedPairing;
    },
  });
}

// ── Compress + upload ────────────────────────────────────────────────────

export interface UploadHybridPageArgs {
  token: string;
  pageNumber: number;
  file: File | Blob;
}

export interface UploadHybridPageResult {
  page_id: string;
  storage_path: string;
  page_number: number;
  attempt_status: string;
}

export function useUploadHybridPage() {
  const deviceFingerprint = useMemo(() => getDeviceFingerprint(), []);

  return useMutation<UploadHybridPageResult, Error, UploadHybridPageArgs>({
    mutationFn: async ({ token, pageNumber, file }) => {
      const { base64, sizeBytes } = await compressSheetToBase64(file);

      const { data, error } = await supabase.functions.invoke(
        "upload-hybrid-page",
        {
          body: {
            token,
            device_fingerprint: deviceFingerprint,
            page_number: pageNumber,
            file_base64: base64,
            file_size_bytes: sizeBytes,
            content_type: "image/jpeg",
          },
        },
      );
      if (error) throw await unwrapFunctionError(error);
      return data as UploadHybridPageResult;
    },
  });
}
