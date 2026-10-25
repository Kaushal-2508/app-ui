import { useState } from "react";
import { toast } from "sonner";
import { ScrollText } from "lucide-react";

import { WidgetCard } from "@/components/command-center/WidgetCard";
import { MobileSheet } from "@/components/shared/sheets";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useRecheckQueue,
  useRecheckStats,
  useResolveRecheck,
} from "@/hooks/dashboard/useCoordinatorDashboardData";
import type { RecheckQueueRow } from "@/hooks/dashboard/coordinatorTypes";

const SLA_DAYS = 5;
const PAGE_SIZE = 8;

/**
 * Recheck approval — a coordinator-only duty per the PRD, so it gets a section
 * rather than a summary tile.
 *
 * The resolve path goes through `dash_scoped_resolve_recheck`, one transaction
 * guarded on `status = 'pending'`. A double submit returns `already_resolved`
 * instead of overwriting the first decision, and `isPending` gates the buttons
 * as the first line of defence.
 *
 * Semantics match the existing institution-wide recheck screen exactly: the
 * decision and new marks are recorded against the request, and `final_results`
 * is not rewritten. Giving the same action two different meanings depending on
 * which screen you opened would be worse than either behaviour.
 */
export function RecheckQueueWidget() {
  const stats = useRecheckStats();
  const queue = useRecheckQueue("pending", PAGE_SIZE, 0);
  const resolve = useResolveRecheck();

  const [active, setActive] = useState<RecheckQueueRow | null>(null);
  const [marks, setMarks] = useState("");
  const [notes, setNotes] = useState("");

  const rows = queue.data?.rows ?? [];
  const total = queue.data?.total ?? 0;
  const pending = stats.data?.pending ?? 0;

  const openSheet = (r: RecheckQueueRow) => {
    setActive(r);
    setMarks(r.new_marks != null ? String(r.new_marks) : "");
    setNotes("");
  };

  const submit = (approve: boolean) => {
    if (!active || resolve.isPending) return;
    const parsed = marks.trim() === "" ? null : Number(marks);
    if (approve && parsed != null && Number.isNaN(parsed)) {
      toast.error("Enter the new marks as a number, or leave the field blank.");
      return;
    }
    resolve.mutate(
      { id: active.id, approve, newMarks: approve ? parsed : null, notes: notes.trim() || null },
      {
        onSuccess: (res) => {
          setActive(null);
          if (res.result === "already_resolved") {
            toast.info("That request had already been resolved.");
          } else {
            toast.success(approve ? "Recheck approved" : "Recheck rejected");
          }
        },
      },
    );
  };

  return (
    <>
      <WidgetCard
        title="Recheck requests"
        caption="Students asking for a re-mark in your wing, oldest first. Approving or rejecting one is a coordinator-only action."
        isLoading={queue.isLoading || stats.isLoading}
        isError={queue.isError || stats.isError}
        onRetry={() => {
          void queue.refetch();
          void stats.refetch();
        }}
        isEmpty={!queue.isLoading && !queue.isError && rows.length === 0}
        emptyTitle="No recheck requests waiting"
        emptyDescription="Nothing in your wing is pending a re-mark. Requests appear here the moment a student raises one."
        className="scroll-mt-24"
      >
        <div id="dash-rechecks">
          <dl className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[
              { label: "Pending", value: pending, danger: pending > 0 },
              { label: "Approved (30d)", value: stats.data?.completed_30d ?? 0 },
              { label: "Rejected (30d)", value: stats.data?.rejected_30d ?? 0 },
              {
                label: "Avg. turnaround",
                value:
                  stats.data?.avg_resolution_days != null
                    ? `${stats.data.avg_resolution_days}d`
                    : "n/a",
              },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-[hsl(var(--surface-stroke))] bg-[hsl(var(--ink-400)/0.04)] px-3 py-2.5"
              >
                <dt className="text-[11.5px] font-medium text-ink-500">{s.label}</dt>
                <dd
                  className={cn(
                    "mt-1 text-[20px] font-bold tabular-nums leading-none",
                    s.danger ? "text-rose-600" : "text-ink-900",
                  )}
                >
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>

          <ul className="divide-y divide-[hsl(var(--surface-stroke))]">
            {rows.map((r) => {
              const overdue = r.days_pending > SLA_DAYS;
              return (
                <li key={r.id} className="flex items-start gap-3 py-3 first:pt-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink-900">
                      {r.student_name ?? "Unknown student"}
                      <span className="ml-1.5 font-normal text-ink-500">{r.class_name}</span>
                    </p>
                    <p className="truncate text-[11.5px] text-ink-500">
                      {r.exam_title}
                      {r.question_order != null && ` · Q${r.question_order}`}
                      {r.previous_marks != null && ` · previously ${r.previous_marks}`}
                    </p>
                    <span
                      className={cn(
                        "mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                        overdue
                          ? "bg-rose-500/10 text-rose-600"
                          : "bg-[hsl(var(--ink-400)/0.09)] text-ink-600",
                      )}
                    >
                      {r.days_pending} day{r.days_pending === 1 ? "" : "s"} pending
                      {overdue && ` · past the ${SLA_DAYS}-day mark`}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => openSheet(r)}
                  >
                    Resolve
                  </Button>
                </li>
              );
            })}
          </ul>

          {total > rows.length && (
            <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-ink-500">
              <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
              Showing the {rows.length} oldest of {total} pending requests.
            </p>
          )}
        </div>
      </WidgetCard>

      <MobileSheet
        open={active != null}
        onOpenChange={(o) => {
          if (!o) setActive(null);
        }}
        title="Resolve recheck request"
        subtitle={
          active
            ? `${active.student_name ?? "Student"} · ${active.class_name} · ${active.days_pending} day${active.days_pending === 1 ? "" : "s"} pending`
            : undefined
        }
      >
        {active && (
          <div className="space-y-4">
            <div>
              <p className="text-[11.5px] font-semibold text-ink-500">Exam</p>
              <p className="mt-1 rounded-xl bg-[hsl(var(--ink-400)/0.06)] px-3 py-2.5 text-[13px] text-ink-700">
                {active.exam_title}
                {active.question_order != null && ` · Q${active.question_order}`}
              </p>
            </div>

            {active.question_text && (
              <div>
                <p className="text-[11.5px] font-semibold text-ink-500">Question</p>
                <p className="mt-1 rounded-xl bg-[hsl(var(--ink-400)/0.06)] px-3 py-2.5 text-[13px] text-ink-700">
                  {active.question_text}
                </p>
              </div>
            )}

            <div>
              <p className="text-[11.5px] font-semibold text-ink-500">
                Why the student asked for a recheck
              </p>
              <p className="mt-1 rounded-xl bg-[hsl(var(--ink-400)/0.06)] px-3 py-2.5 text-[13px] text-ink-700">
                {active.reason?.trim() || "No reason given."}
              </p>
            </div>

            <div>
              <label
                htmlFor="recheck-marks"
                className="mb-1.5 block text-[11.5px] font-semibold text-ink-500"
              >
                New marks (only if approving)
              </label>
              <Input
                id="recheck-marks"
                inputMode="decimal"
                placeholder={
                  active.previous_marks != null
                    ? `Previously ${active.previous_marks}`
                    : "e.g. 8"
                }
                value={marks}
                onChange={(e) => setMarks(e.target.value)}
              />
            </div>

            <div>
              <label
                htmlFor="recheck-notes"
                className="mb-1.5 block text-[11.5px] font-semibold text-ink-500"
              >
                Resolution notes
              </label>
              <Textarea
                id="recheck-notes"
                rows={3}
                placeholder="Visible to the teacher, and to the student once resolved."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <p className="rounded-xl bg-[hsl(var(--ink-400)/0.06)] px-3 py-2.5 text-[11.5px] leading-[16px] text-ink-600">
              Recording a decision here updates the request itself. It does not rewrite the
              published result, which is the same behaviour as the Recheck Requests page.
            </p>

            <div className="flex justify-end gap-2.5 pt-1">
              <Button
                variant="outline"
                disabled={resolve.isPending}
                onClick={() => submit(false)}
              >
                Reject
              </Button>
              <Button disabled={resolve.isPending} onClick={() => submit(true)}>
                {resolve.isPending ? "Saving…" : "Approve"}
              </Button>
            </div>
          </div>
        )}
      </MobileSheet>
    </>
  );
}
