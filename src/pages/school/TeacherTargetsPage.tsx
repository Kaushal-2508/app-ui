import { useMemo, useState } from "react";
import { AlertTriangle, Plus, Target } from "lucide-react";
import { PageShell, PageHeader, MobileFab } from "@/components/shared/page";
import { EmptyState, StatTile, StatTileGrid } from "@/components/shared/surfaces";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { useTargetsOverview, useStopTarget, type TeacherTargetRow } from "@/hooks/useTeacherTargets";
import { CreateTargetSheet } from "@/components/targets/CreateTargetSheet";
import { SplitPoolSheet } from "@/components/targets/SplitPoolSheet";
import { TargetProgressCard } from "@/components/targets/TargetProgressCard";

/**
 * Admin and coordinator surface for Teacher Targets: create wing pools or
 * direct per-teacher targets, split a pool across teachers, stop a target,
 * and see progress and closed history. Full build for Task 11 (Task 9 shipped
 * a routing placeholder).
 */
export default function TeacherTargetsPage() {
  const { user } = useAuth();
  const { institutionId } = useEffectiveInstitution();
  const { data, isLoading, error, refetch } = useTargetsOverview();
  const stopTarget = useStopTarget();

  const [createOpen, setCreateOpen] = useState(false);
  const [splitPool, setSplitPool] = useState<TeacherTargetRow | null>(null);
  const [toStop, setToStop] = useState<TeacherTargetRow | null>(null);

  const targets = useMemo(() => data?.targets ?? [], [data]);
  const isAdmin = !!data?.is_admin;

  // Split children (scope='teacher', parent_target_id set) are folded into
  // their parent pool's own allocated/teacher_count summary, so they render
  // as part of the pool card, not as a second row each. They're still needed
  // here to prefill SplitPoolSheet so an untouched teacher isn't dropped.
  const pools = useMemo(() => targets.filter((t) => t.scope === "wing"), [targets]);
  const directTargets = useMemo(
    () => targets.filter((t) => t.scope === "teacher" && !t.parent_target_id),
    [targets],
  );
  const visibleTargets = useMemo(() => [...pools, ...directTargets], [pools, directTargets]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, TeacherTargetRow[]>();
    targets.forEach((t) => {
      if (t.scope !== "teacher" || !t.parent_target_id) return;
      const list = map.get(t.parent_target_id) ?? [];
      list.push(t);
      map.set(t.parent_target_id, list);
    });
    return map;
  }, [targets]);

  const activeCount = visibleTargets.filter((t) => t.status === "active").length;
  const teachersCovered = useMemo(() => {
    const ids = new Set<string>();
    directTargets.forEach((t) => ids.add(t.owner_id));
    targets.forEach((t) => {
      if (t.scope === "teacher" && t.parent_target_id) ids.add(t.owner_id);
    });
    return ids.size;
  }, [targets, directTargets]);
  const needsSplitCount = pools.filter(
    (p) => p.status === "active" && (p.allocated ?? 0) < p.target_value,
  ).length;

  const handleConfirmStop = () => {
    if (!toStop) return;
    stopTarget.mutate(toStop.id, { onSuccess: () => setToStop(null) });
  };

  if (isLoading) {
    return <PageSkeleton />;
  }

  return (
    <PageShell
      fab={
        isAdmin ? (
          <MobileFab
            label="Set a target"
            icon={<Plus className="h-6 w-6" />}
            onClick={() => setCreateOpen(true)}
            hideWhen={!error && visibleTargets.length === 0}
          />
        ) : undefined
      }
    >
      <PageHeader
        icon={<Target className="h-5 w-5" />}
        title="Teacher Targets"
        subtitle={
          isAdmin
            ? "Set exam and homework targets for teachers, by wing or individually"
            : "Track and share out the targets assigned to your wing"
        }
        primaryAction={
          isAdmin
            ? { label: "Set a target", icon: <Plus className="h-4 w-4" />, onClick: () => setCreateOpen(true) }
            : undefined
        }
      />

      {/* Error state renders BEFORE the empty state, and covers the stat
          tiles too: a failed fetch must never be mistaken for "no targets". */}
      {error ? (
        <EmptyState
          icon={<AlertTriangle className="h-6 w-6" />}
          title="Couldn't load targets"
          description="Something went wrong fetching targets. Try again in a moment."
          action={{ label: "Retry", onClick: () => refetch() }}
        />
      ) : visibleTargets.length === 0 ? (
        <EmptyState
          icon={<Target className="h-6 w-6" />}
          title="No targets yet"
          description={
            isAdmin
              ? "Set a target for a wing or for individual teachers to get started."
              : "You don't have any wing targets yet. An admin sets these up."
          }
          action={isAdmin ? { label: "Set a target", onClick: () => setCreateOpen(true) } : undefined}
        />
      ) : (
        <>
          <StatTileGrid cols={2} mdCols={3} className="mt-2">
            <StatTile label="Active targets" value={activeCount} tone="teal" icon={<Target className="h-5 w-5" />} />
            <StatTile label="Teachers covered" value={teachersCovered} tone="sky" />
            <StatTile label="Pools needing a split" value={needsSplitCount} tone="peach" />
          </StatTileGrid>

          <div className="mt-4 space-y-3">
            {visibleTargets.map((t) => (
              <TargetProgressCard
                key={t.id}
                target={t}
                isAdmin={isAdmin}
                currentUserId={user?.id}
                onSplit={() => setSplitPool(t)}
                onStop={() => setToStop(t)}
              />
            ))}
          </div>
        </>
      )}

      {isAdmin && (
        <CreateTargetSheet open={createOpen} onOpenChange={setCreateOpen} institutionId={institutionId} />
      )}

      {splitPool && (
        <SplitPoolSheet
          open={!!splitPool}
          onOpenChange={(v) => {
            if (!v) setSplitPool(null);
          }}
          pool={splitPool}
          existingChildren={childrenByParent.get(splitPool.id) ?? []}
        />
      )}

      <AlertDialog open={!!toStop} onOpenChange={(v) => !v && setToStop(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop this target?</AlertDialogTitle>
            <AlertDialogDescription>
              {toStop?.scope === "wing"
                ? `This stops the pool for ${toStop?.wing_name ?? "this wing"} and every teacher share split from it. Closed periods already measured are kept.`
                : `This stops the target for ${toStop?.owner_name ?? "this teacher"}. Closed periods already measured are kept.`}
              {" "}This cannot be undone from here, but nothing is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmStop}
              disabled={stopTarget.isPending}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              Stop target
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

function PageSkeleton() {
  return (
    <PageShell>
      <div className="space-y-6 py-4">
        <div className="flex items-start gap-4">
          <Skeleton className="h-12 w-12 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
    </PageShell>
  );
}
