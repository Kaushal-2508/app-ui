import { GraduationCap, ClipboardList, Shield, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ViewRole } from "@/contexts/ActiveRoleContext";

// Re-exported so existing importers keep working. The type itself is declared
// once, in ActiveRoleContext, so the two can never drift apart.
export type { ViewRole };

const VIEW_META: Record<ViewRole, { label: string; Icon: LucideIcon }> = {
  admin: { label: "Admin", Icon: Shield },
  teacher: { label: "Teacher", Icon: GraduationCap },
  coordinator: { label: "Coordinator", Icon: ClipboardList },
};

interface RoleSwitcherProps {
  activeRole: ViewRole;
  onRoleChange: (role: ViewRole) => void;
  /** The views this user may choose between. */
  roles: ViewRole[];
  /**
   * "panel": the original boxed strip with a "Switch view:" caption, for page
   * bodies. "compact": a segmented pill for the app bar, where it replaces the
   * inert role chip; labels collapse to icons below `sm` so the bar still fits
   * the search button, bell and avatar at 375px.
   */
  variant?: "panel" | "compact";
  className?: string;
}

export function RoleSwitcher({
  activeRole,
  onRoleChange,
  roles,
  variant = "panel",
  className,
}: RoleSwitcherProps) {
  if (roles.length < 2) return null;

  if (variant === "compact") {
    return (
      <div
        role="group"
        aria-label="Switch view"
        className={cn(
          "flex h-9 shrink-0 items-center gap-0.5 rounded-full border border-surface-stroke bg-surface-card p-0.5",
          className,
        )}
      >
        {roles.map((role) => {
          const { label, Icon } = VIEW_META[role];
          const active = activeRole === role;
          return (
            <button
              key={role}
              type="button"
              onClick={() => onRoleChange(role)}
              aria-pressed={active}
              aria-label={`${label} view`}
              title={`${label} view`}
              className={cn(
                "flex h-8 min-w-[36px] items-center justify-center gap-1.5 rounded-full px-2 text-xs font-medium transition-colors sm:px-3",
                active
                  ? "bg-brand-primary text-white"
                  : "text-ink-600 hover:bg-ink-400/10 hover:text-ink-900",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="hidden sm:inline">{label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-3 p-3 bg-muted/50 rounded-lg border", className)}>
      <span className="text-sm text-muted-foreground">Switch view:</span>
      <div className="flex flex-wrap gap-2">
        {roles.map((role) => {
          const { label, Icon } = VIEW_META[role];
          return (
            <button
              key={role}
              type="button"
              onClick={() => onRoleChange(role)}
              aria-pressed={activeRole === role}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                activeRole === role
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-accent text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
