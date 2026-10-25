import { useMemo, useState } from "react";
import { Flag, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/surfaces";
import { useDashboardFlags } from "@/hooks/dashboard/useDashboardData";
import { useEvaluateFlagsOnOpen } from "@/hooks/dashboard/useFlagActions";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import type { Flag as FlagItem } from "@/hooks/dashboard/types";

import { FlagCard } from "./FlagCard";
import { CATEGORY_ORDER, categoryLabel, SEVERITY_ORDER } from "./flagLifecycle";

/**
 * Group flags by category in canonical order (Attendance → Exams → Adoption,
 * then any unexpected category), and within each group sort by severity
 * (critical → warning → info) then newest first. The RPC already sorts; this
 * keeps it stable + deterministic across the grouped render. Only non-empty
 * groups are returned.
 */
function groupFlags(flags: FlagItem[]): [string, FlagItem[]][] {
  const groups = new Map<string, FlagItem[]>();
  for (const f of flags) {
    const list = groups.get(f.category);
    if (list) list.push(f);
    else groups.set(f.category, [f]);
  }

  const orderIndex = (c: string) => {
    const i = (CATEGORY_ORDER as readonly string[]).indexOf(c);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };

  return Array.from(groups.entries())
    .sort((a, b) => orderIndex(a[0]) - orderIndex(b[0]))
    .map(([category, items]) => {
      const sorted = [...items].sort((a, b) => {
        const sev = (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
        if (sev !== 0) return sev;
        return b.first_detected_at.localeCompare(a.first_detected_at);
      });
      return [category, sorted] as [string, FlagItem[]];
    });
}

/** Show this many flags per category before the "Load more" button. */
const FLAGS_PER_GROUP = 4;

/**
 * One category group — shows the first FLAGS_PER_GROUP flags, with a "Load more"
 * button that reveals the rest (and collapses back). Each group manages its own
 * expanded state so a long Attendance list doesn't force the others open.
 */
function FlagGroup({
  category,
  items,
  institutionId,
}: {
  category: string;
  items: FlagItem[];
  institutionId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, FLAGS_PER_GROUP);
  const hidden = items.length - FLAGS_PER_GROUP;

  return (
    <div className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
      <p className="eyebrow mb-3">
        {categoryLabel(category)}
        <span className="ml-2 text-ink-400">{items.length}</span>
      </p>
      <div className="space-y-2">
        {visible.map((f) => (
          <FlagCard key={f.id} flag={f} institutionId={institutionId} />
        ))}
      </div>
      {hidden > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 w-full text-brand-primary hover:text-brand-primary"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : `Load more (${hidden})`}
          <ChevronDown className={`ml-1 h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </Button>
      )}
    </div>
  );
}

/**
 * Flags feed — the principal's "what needs attention" list. Fires the on-open
 * evaluator kick (§24 pattern, throttled per institution per hour), consumes
 * the live `dash_get_flags` set, groups it by category, and renders each flag
 * as a `FlagCard` with its lifecycle status + task actions. Loading → skeleton;
 * empty → a calm EmptyState.
 */
export function FlagsFeed() {
  const { institutionId } = useEffectiveInstitution();
  useEvaluateFlagsOnOpen(institutionId);

  const { data, isLoading } = useDashboardFlags();
  const grouped = useMemo(() => groupFlags(data ?? []), [data]);

  return (
    <section id="dash-flags">
      {isLoading ? (
        <div className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : grouped.length === 0 ? (
        <div className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
          <EmptyState
            icon={<Flag className="h-7 w-7" />}
            title="Nothing needs your attention right now"
            description="Flags will appear here as your school uses SALCI: low attendance, overdue results, classes without a teacher, and more."
          />
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([category, items]) => (
            <FlagGroup key={category} category={category} items={items} institutionId={institutionId} />
          ))}
        </div>
      )}
    </section>
  );
}
