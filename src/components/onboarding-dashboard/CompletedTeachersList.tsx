import { ListRow, EmptyState } from "@/components/shared/surfaces";
import { Award, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { OnboardingDashboardData } from "@/hooks/useOnboardingDashboard";

interface Props {
  data: OnboardingDashboardData;
}

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function CompletedTeachersList({ data }: Props) {
  const completed = data.live
    .filter((r) => r.isJourneyCompleted)
    .sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""));

  return (
    <div className="surface-card frosted-shadow rounded-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Award className="h-5 w-5 text-brand-primary" />
        <p className="eyebrow">Fully onboarded ({completed.length})</p>
      </div>

      {completed.length === 0 ? (
        <EmptyState
          icon={<Award className="h-7 w-7" />}
          title="No one's reached 100% yet"
          description="They will appear here once they cross every milestone."
        />
      ) : (
        <div className="space-y-1">
          {completed.map((r) => (
            <ListRow
              key={r.userId}
              leading={
                <Avatar>
                  <AvatarFallback>{initials(r.fullName)}</AvatarFallback>
                </Avatar>
              }
              title={r.fullName ?? "N/A"}
              subtitle={r.email ?? r.role ?? ""}
              trailing={
                data.newlyCompleted.has(r.userId) ? (
                  <Badge className="gap-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-200">
                    <Sparkles className="h-3 w-3" /> New today
                  </Badge>
                ) : null
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
