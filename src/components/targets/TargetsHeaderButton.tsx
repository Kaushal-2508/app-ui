import { Target } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

/**
 * Sits in PageHeader's `extras` slot, to the left of the primary CTA on every
 * breakpoint. The label collapses to an icon-only button under `sm`, the way
 * ScopeSwitcher (ExamsPage) already does: the action cluster has no
 * flex-wrap and PageShell sets overflow-x-hidden, so anything that overflows
 * at 375px is CLIPPED and silently unreachable rather than scrollable.
 *
 * bg-[hsl(var(--surface-card)/0.85)] is deliberate and matches ScopeSwitcher (ExamsPage.tsx) and the
 * HomeworkPage filter triggers. The token bg-surface-card would make this
 * button flip in dark mode while its immediate neighbours did not.
 */
export function TargetsHeaderButton({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => navigate(to)}
      title="Targets"
      className="h-10 shrink-0 gap-1.5 rounded-full border-surface-stroke bg-[hsl(var(--surface-card)/0.85)] px-3 text-sm font-medium text-ink-700 backdrop-blur-sm hover:bg-ink-400/5 sm:px-4"
    >
      <Target className="h-4 w-4" />
      <span className="hidden sm:inline">Targets</span>
    </Button>
  );
}
