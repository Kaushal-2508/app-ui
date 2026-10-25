import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hybrid proctoring snapshots (flow correction, Phase 2).
 *
 * Written DIRECTLY by the authenticated student — no edge function. The
 * existing `hybrid_sheets_authenticated_insert` storage policy permits the
 * write; the `hybrid_proctoring_snapshots` RLS permits the row. Teacher reads
 * go through signed URLs.
 */

export interface UploadSnapshotArgs {
  attemptId: string;
  examId: string;
  institutionId: string;
  blob: Blob;
}

/** Deterministic-ish unique suffix without Date.now()/Math.random in shared libs. */
function snapshotKey(): string {
  // Allowed here (client runtime, not a workflow script): timestamp + counter.
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function useUploadHybridSnapshot() {
  return useMutation<void, Error, UploadSnapshotArgs>({
    mutationFn: async ({ attemptId, examId, institutionId, blob }) => {
      const path = `snapshots/${institutionId}/${examId}/${attemptId}/${snapshotKey()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("hybrid-answer-sheets")
        .upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (uploadError) throw uploadError;

      const { error: rowError } = await supabase
        .from("hybrid_proctoring_snapshots")
        .insert({
          attempt_id: attemptId,
          institution_id: institutionId,
          storage_path: path,
        });
      if (rowError) throw rowError;
    },
    // Snapshots are best-effort integrity evidence — never toast/raise to the
    // student mid-exam. Failures are swallowed by the caller.
  });
}

export interface HybridSnapshotSigned {
  id: string;
  captured_at: string;
  flagged: boolean;
  signed_url: string;
}

/** Teacher-side read: snapshots for an attempt with signed URLs. */
export function useHybridSnapshots(attemptId: string | undefined) {
  return useQuery({
    queryKey: ["hybrid-snapshots", attemptId],
    enabled: !!attemptId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<HybridSnapshotSigned[]> => {
      const { data, error } = await supabase
        .from("hybrid_proctoring_snapshots")
        .select("id, storage_path, captured_at, flagged")
        .eq("attempt_id", attemptId!)
        .order("captured_at", { ascending: true })
        .range(0, 199); // bounded read (§23 pagination)
      if (error) throw error;
      const rows = data ?? [];
      if (rows.length === 0) return [];
      const { data: signed, error: signedError } = await supabase.storage
        .from("hybrid-answer-sheets")
        .createSignedUrls(rows.map((r) => r.storage_path), 60 * 30);
      if (signedError) throw signedError;
      return rows.map((r, i) => ({
        id: r.id,
        captured_at: r.captured_at,
        flagged: r.flagged,
        signed_url: signed?.[i]?.signedUrl ?? "",
      }));
    },
  });
}