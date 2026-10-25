import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  useDash5AssignContext,
  useDash5CreateTask,
  type Dash5AssignContext,
} from "@/hooks/dashboard/useDash5";

import {
  AssignRow, DrawerNote, DrawerSection, MiniStats, PriorityPill,
  type MiniStat,
} from "./Drawer";
import { V5Error, V5Loading } from "./primitives";

/**
 * The assign body shared by every drawer that ends in "and now do something
 * about it": a wing from the performance tree, a class, one subject in one
 * class, and the coverage bars.
 *
 * The reference draws three separate assign panels that differ only in which
 * row opened them. They are one component here, scoped by the ids passed in,
 * because three copies of a write path is how two of them end up out of date.
 */

export interface AssignScope {
  wingId?: string | null;
  classId?: string | null;
  subjectId?: string | null;
}

export function AssignPanel({
  scope, onAssigned, showStats = true,
}: {
  scope: AssignScope;
  onAssigned?: () => void;
  /**
   * Off when the drawer above already shows its own figures. The student
   * drawer embeds this panel under its own mini-stats, and a second row of
   * three numbers about a different scope reads as a contradiction.
   */
  showStats?: boolean;
}) {
  const q = useDash5AssignContext(scope);

  if (q.isLoading) return <V5Loading label="Working out who owns this…" />;
  if (q.error) {
    return (
      <V5Error
        label="Couldn't load this scope. The task list is fine, this panel is not."
        onRetry={() => void q.refetch()}
      />
    );
  }
  if (!q.data) return <V5Error label="Nothing came back for this scope." />;
  return <AssignBody ctx={q.data} onAssigned={onAssigned} showStats={showStats} />;
}

function AssignBody({
  ctx, onAssigned, showStats,
}: { ctx: Dash5AssignContext; onAssigned?: () => void; showStats: boolean }) {
  const { institutionId } = useEffectiveInstitution();
  const create = useDash5CreateTask(institutionId);
  const [done, setDone] = React.useState<Record<string, "working" | "done">>({});
  const [title, setTitle] = React.useState("");
  const [detail, setDetail] = React.useState("");
  const [priority, setPriority] = React.useState(2);
  const [customState, setCustomState] = React.useState<"idle" | "working" | "done">("idle");

  const target = ctx.target;
  const who = target.name ?? "nobody";

  const stats: MiniStat[] = ctx.stats.map((s) => ({
    label: s.label,
    value: s.value == null ? "N/A" : `${s.value}${s.unit}`,
    tone:
      s.value == null
        ? undefined
        : s.label === "Coverage" && s.value < ctx.pace_pct - 3
          ? "hsl(var(--dash-critical))"
          : s.label === "Attendance" && s.value < 75
            ? "hsl(var(--dash-critical))"
            : s.label === "Average score" && s.value < 50
              ? "hsl(var(--dash-critical))"
              : undefined,
  }));

  function assign(key: string, t: { title: string; detail: string; priority: number; task_type: string; due_days: number }) {
    if (!target.id) {
      toast.error("There is nobody to assign this to yet.");
      return;
    }
    setDone((d) => ({ ...d, [key]: "working" }));
    create.mutate(
      { ...t, assignee_id: target.id },
      {
        onSuccess: () => {
          setDone((d) => ({ ...d, [key]: "done" }));
          toast.success(`Assigned to ${who}`);
          onAssigned?.();
        },
        onError: (e: Error) => {
          setDone((d) => {
            const next = { ...d };
            delete next[key];
            return next;
          });
          toastError(e, { fallback: "Couldn't create that task.", context: "dash5Assign" });
        },
      },
    );
  }

  function assignCustom() {
    if (!title.trim()) {
      toast.error("Give the task a title first.");
      return;
    }
    if (!target.id) {
      toast.error("There is nobody to assign this to yet.");
      return;
    }
    setCustomState("working");
    create.mutate(
      {
        title: title.trim(),
        detail:
          detail.trim() ||
          `Raised from the ${ctx.label} view of the school dashboard on ${new Date().toLocaleDateString()}.`,
        assignee_id: target.id,
        priority,
        task_type: "academic_content",
        due_days: 7,
      },
      {
        onSuccess: () => {
          setCustomState("done");
          setTitle("");
          setDetail("");
          toast.success(`Assigned to ${who}`);
          onAssigned?.();
        },
        onError: (e: Error) => {
          setCustomState("idle");
          toastError(e, { fallback: "Couldn't create that task.", context: "dash5AssignCustom" });
        },
      },
    );
  }

  return (
    <>
      {showStats && <MiniStats items={stats} />}

      <DrawerSection title={`Suggested for ${ctx.label}`}>
        {ctx.suggestions.length === 0 ? (
          <DrawerNote>
            Nothing here is behind. Coverage, papers, attendance and homework are all
            where they should be for {ctx.full_label}, so there is no task worth
            raising. You can still write your own below.
          </DrawerNote>
        ) : (
          <div className="flex flex-col">
            {ctx.suggestions.map((s) => (
              <AssignRow
                key={s.title}
                priority={s.priority}
                title={s.title}
                detail={s.detail}
                state={done[s.title] ?? "idle"}
                disabled={!target.id}
                onAssign={() => assign(s.title, s)}
              />
            ))}
          </div>
        )}
      </DrawerSection>

      <DrawerSection title="Or write your own">
        <div className="flex flex-col gap-2.5">
          <Input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (customState === "done") setCustomState("idle");
            }}
            placeholder={`What should ${who} do?`}
            maxLength={160}
          />
          <Textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="Any detail that would not be obvious from the title. Optional."
            rows={3}
            maxLength={600}
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11.5px] font-semibold text-ink-500">Priority</span>
            {[1, 2, 3].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={cn(
                  "rounded-full transition-opacity duration-200",
                  priority === p ? "opacity-100" : "opacity-45 hover:opacity-75",
                )}
                aria-pressed={priority === p}
              >
                <PriorityPill priority={p} />
              </button>
            ))}
            <Button
              type="button"
              onClick={assignCustom}
              disabled={customState !== "idle" || !target.id}
              className="ml-auto bg-brand-primary text-white hover:bg-brand-primary/90"
            >
              {customState === "done"
                ? "Assigned"
                : customState === "working"
                  ? "Working…"
                  : "Assign"}
            </Button>
          </div>
        </div>
      </DrawerSection>

      <div className="mt-[22px]">
        {target.id ? (
          <DrawerNote tone={target.exact ? "brand" : "warning"}>
            {target.exact ? (
              <>
                The task goes to <b>{who}</b>, the {(target.role ?? "owner").toLowerCase()} for{" "}
                {ctx.full_label}, and appears in their SALCI task list with these figures
                attached.
              </>
            ) : (
              <>
                Nobody is assigned to {ctx.full_label} directly, so this would go to{" "}
                <b>{who}</b> as the {(target.role ?? "nearest owner").toLowerCase()} above it.
                Assigning a teacher to it first would put the work with the person doing it.
              </>
            )}
          </DrawerNote>
        ) : (
          <DrawerNote tone="critical">
            There is nobody to send this to. {ctx.full_label} has no teacher, no
            coordinator above it and no active school admin on record, so every button
            here is disabled until somebody is assigned.
          </DrawerNote>
        )}
      </div>
    </>
  );
}
