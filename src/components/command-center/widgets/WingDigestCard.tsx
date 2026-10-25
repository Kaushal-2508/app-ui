import { AlertTriangle, Info, Sparkles, TriangleAlert } from "lucide-react";

import { EmptyState } from "@/components/shared/surfaces";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useWingDigest } from "@/hooks/dashboard/useCoordinatorDashboardData";
import type { DigestItem } from "@/hooks/dashboard/coordinatorTypes";

const SEVERITY: Record<
  DigestItem["severity"],
  { icon: typeof Info; dot: string; text: string }
> = {
  critical: { icon: TriangleAlert, dot: "bg-rose-500", text: "text-rose-600" },
  warning: { icon: AlertTriangle, dot: "bg-amber-500", text: "text-amber-600" },
  info: { icon: Info, dot: "bg-brand-primary", text: "text-brand-primary" },
};

/**
 * The wing digest: the one block worth reading before opening anything else.
 *
 * Composed server-side by `dash_scoped_digest`, which calls the same scoped RPCs
 * that back the cards below it. That is deliberate — deriving the digest
 * separately is how a summary ends up contradicting the chart underneath it.
 *
 * Each line deep-links to the section that can act on it, so the digest is a
 * table of contents for the page rather than a dead-end summary.
 */
export function WingDigestCard() {
  const { data, isLoading, isError } = useWingDigest();

  const scrollTo = (href: string | null) => {
    if (!href) return;
    const id = href.split("#")[1];
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section
      id="dash-digest"
      className="surface-card frosted-shadow rounded-card scroll-mt-24 p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-primary/10">
          <Sparkles className="h-[18px] w-[18px] text-brand-primary" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink-900">This week in your wing</h3>
          <p className="mt-0.5 text-[13px] text-ink-500">
            Read this first. Every line is computed from the sections below and links straight to
            the one that can fix it.
          </p>
        </div>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        ) : isError ? (
          <EmptyState
            size="sm"
            reason="error"
            tone="rose"
            icon={<TriangleAlert className="h-7 w-7" />}
            title="Couldn't build this week's digest"
            description="The rest of the page is unaffected. Reload to try again."
          />
        ) : !data || data.length === 0 ? (
          <EmptyState
            size="sm"
            reason="noData"
            tone="mint"
            icon={<Sparkles className="h-7 w-7" />}
            title="Nothing needs your attention"
            description="No adoption gaps, overdue tasks or pending rechecks in your wing right now."
          />
        ) : (
          <ul className="space-y-2.5">
            {data.map((item) => {
              const s = SEVERITY[item.severity] ?? SEVERITY.info;
              const Icon = s.icon;
              return (
                <li key={item.code}>
                  <button
                    type="button"
                    onClick={() => scrollTo(item.link_url)}
                    disabled={!item.link_url}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                      item.link_url
                        ? "hover:bg-[hsl(var(--ink-400)/0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
                        : "cursor-default",
                    )}
                  >
                    <Icon
                      className={cn("mt-0.5 h-[15px] w-[15px] shrink-0", s.text)}
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-semibold text-ink-900">
                        {item.headline}
                      </span>
                      {item.detail && (
                        <span className="mt-0.5 block text-[12.5px] leading-[18px] text-ink-500">
                          {item.detail}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
