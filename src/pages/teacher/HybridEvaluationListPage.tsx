import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, FileCheck2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageShell, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/surfaces";
import { format } from "date-fns";
import { sortStudentRoster } from "@/lib/studentIdentity";

interface HybridAttemptListRow {
  id: string;
  status: string;
  submitted_at: string | null;
  upload_completed_at: string | null;
  evaluated_at: string | null;
  exam_id: string;
  student_id: string;
  exam_title: string;
  student_name: string;
  roll_number: string | null;
  admission_number: string | null;
  page_count: number;
}

/**
 * Hybrid evaluation list. Reached from "My Exams" when a teacher opens a
 * hybrid exam (scoped to that exam via ?examId=), or bare for the full
 * institution-wide pending queue.
 *
 * Lists hybrid attempts in pending_evaluation / upload_in_progress / evaluated
 * that the caller has RLS access to (teacher for the class, or institution admin).
 */
function useHybridPendingAttempts(examId?: string) {
  return useQuery({
    queryKey: ["hybrid-pending-attempts", examId ?? "all"],
    staleTime: 60_000,
    queryFn: async (): Promise<HybridAttemptListRow[]> => {
      // NOTE: profiles only has `full_name` (no first_name/last_name columns) —
      // selecting the latter errors the whole PostgREST query and silently
      // empties this list. Keep it to full_name.
      let q = supabase
        .from("hybrid_exam_attempts")
        .select(
          `
          id, status, submitted_at, upload_completed_at, evaluated_at,
          exam_id, student_id,
          exams ( title ),
          profiles!hybrid_exam_attempts_student_id_fkey ( full_name, roll_number, admission_number ),
          hybrid_answer_sheet_pages ( id )
        `,
        )
        .in("status", ["pending_evaluation", "upload_in_progress", "evaluated"]);
      if (examId) q = q.eq("exam_id", examId);
      const { data, error } = await q
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .range(0, 199);
      if (error) throw error;
      const rows = ((data ?? []) as unknown as Array<{
        id: string;
        status: string;
        submitted_at: string | null;
        upload_completed_at: string | null;
        evaluated_at: string | null;
        exam_id: string;
        student_id: string;
        exams: { title: string | null } | Array<{ title: string | null }>;
        profiles:
          | { full_name: string | null; roll_number: string | null; admission_number: string | null }
          | Array<{ full_name: string | null; roll_number: string | null; admission_number: string | null }>
          | null;
        hybrid_answer_sheet_pages: Array<{ id: string }> | null;
      }>).map((row) => {
        const examRow = Array.isArray(row.exams) ? row.exams[0] : row.exams;
        const profileRow = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        return {
          id: row.id,
          status: row.status,
          submitted_at: row.submitted_at,
          upload_completed_at: row.upload_completed_at,
          evaluated_at: row.evaluated_at,
          exam_id: row.exam_id,
          student_id: row.student_id,
          exam_title: examRow?.title ?? "Hybrid exam",
          student_name: profileRow?.full_name || "Student",
          roll_number: profileRow?.roll_number ?? null,
          admission_number: profileRow?.admission_number ?? null,
          page_count: row.hybrid_answer_sheet_pages?.length ?? 0,
        };
      });

      // One block per exam: roll order when every candidate is numbered,
      // alphabetical (ERP order) while roll allocation is still incomplete.
      return sortStudentRoster(rows, {
        getRoll: (r) => r.roll_number,
        getName: (r) => r.student_name,
        getGroupKey: (r) => r.exam_title,
      });
    },
  });
}

const STATUS_PILLS: Record<string, { label: string; className: string }> = {
  upload_in_progress: {
    label: "Uploading",
    className: "bg-amber-500/10 text-amber-700 border-amber-200",
  },
  pending_evaluation: {
    label: "Pending evaluation",
    className: "bg-primary/10 text-primary border-primary/30",
  },
  evaluated: {
    label: "Evaluated",
    className: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  },
};

export default function HybridEvaluationListPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const examId = searchParams.get("examId") ?? undefined;
  const query = useHybridPendingAttempts(examId);

  const scopedExamTitle = examId ? query.data?.[0]?.exam_title : undefined;

  return (
    <PageShell>
      {/* This page is only ever reached from My Exams (or a marking link), and
          PageHeader has no back affordance — without this there is no way back
          except the browser control. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mb-2 -ml-2 h-9 px-2 text-ink-600 hover:text-ink-900"
        onClick={() => {
          // Prefer history so the teacher lands back on the exact filtered list
          // they came from (My Exams keeps its filters in the query string).
          if (window.history.length > 1) navigate(-1);
          else navigate("/exams");
        }}
      >
        <ChevronLeft className="mr-1 h-4 w-4" />
        Back to exams
      </Button>
      <PageHeader
        icon={<FileCheck2 className="h-5 w-5" />}
        title="Hybrid evaluations"
        subtitle={
          scopedExamTitle
            ? `Mark uploaded answer sheets for ${scopedExamTitle}`
            : "Mark answer sheets your students have uploaded"
        }
      />

      {query.isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {!query.isLoading && (query.data?.length ?? 0) === 0 && (
        <EmptyState
          icon={<FileCheck2 className="h-7 w-7" />}
          title="Nothing to mark yet"
          description="Hybrid attempts appear here once your students have uploaded their answer sheets."
        />
      )}

      {!query.isLoading && query.data && query.data.length > 0 && (
        <div className="space-y-3">
          {query.data.map((row) => {
            const pill = STATUS_PILLS[row.status] ?? STATUS_PILLS.pending_evaluation;
            const isPending = row.status === "pending_evaluation";
            const isEvaluated = row.status === "evaluated";
            return (
              <Card key={row.id} className="surface-card frosted-shadow rounded-2xl border-0">
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink-900">
                      {row.student_name}
                      {/* Roll + admission so the marker can match the physical
                          sheet to the right student. Either may be unset. */}
                      {(row.roll_number || row.admission_number) && (
                        <span className="ml-2 text-xs font-normal text-ink-500">
                          {[
                            row.roll_number ? `Roll ${row.roll_number}` : null,
                            row.admission_number ? `Adm ${row.admission_number}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-ink-600">{row.exam_title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-500">
                      <span className={`rounded-full border px-2 py-0.5 font-medium ${pill.className}`}>
                        {pill.label}
                      </span>
                      <span>{row.page_count} page{row.page_count === 1 ? "" : "s"}</span>
                      {row.submitted_at && (
                        <span>
                          Submitted {format(new Date(row.submitted_at), "MMM d, h:mm a")}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={isEvaluated ? "outline" : "default"}
                    onClick={() => navigate(`/evaluations/hybrid/${row.id}`)}
                    disabled={!isPending && !isEvaluated}
                  >
                    {isEvaluated ? "Review" : isPending ? "Mark" : "Waiting"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
