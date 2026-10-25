import * as React from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isNativePlatform } from "@/lib/native";
import { cn } from "@/lib/utils";

export interface MobileFabMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

export interface MobileFabProps {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  /**
   * When true, the FAB is hidden (translated off-screen + faded). Used by
   * pages that want to hide the FAB whenever an inline empty-state CTA is
   * already in viewport.
   */
  hideWhen?: boolean;
  /**
   * When provided, the FAB renders as a DropdownMenu trigger that opens
   * upward with these items. `onClick` is ignored in this mode.
   */
  menuItems?: MobileFabMenuItem[];
}

/**
 * Floating Action Button. Mobile + tablet only — hidden at lg+ breakpoint
 * because desktop uses the inline header CTA from PageHeader.
 *
 * Inside the native shell it renders nothing: PageHeader's primary action is
 * visible at every width there, so the FAB only duplicated it and floated
 * over card text on eight screens (2026-09-18 phone audit). The web keeps it.
 *
 * Auto-hide rule: any element with [data-sticky-bottom] inside the page
 * triggers the FAB to slide out when it intersects the bottom of the viewport,
 * preventing visual collision with sticky toolbars / tab strips / inline CTAs.
 *
 * Forwards its ref to the button, so it can be a Radix `asChild` trigger
 * (CreateTaskDialog and friends) without a "function components cannot be
 * given refs" warning.
 */
export const MobileFab = React.forwardRef<HTMLButtonElement, MobileFabProps>(function MobileFab(
  { label, icon, onClick, hideWhen = false, menuItems, ...rest },
  ref,
) {
  const [autoHidden, setAutoHidden] = React.useState(false);

  React.useEffect(() => {
    const sentinels = document.querySelectorAll<HTMLElement>("[data-sticky-bottom]");
    if (sentinels.length === 0) {
      setAutoHidden(false);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        // Hide FAB when ANY sentinel is intersecting near the bottom edge.
        const anyVisible = entries.some((entry) => entry.isIntersecting);
        setAutoHidden(anyVisible);
      },
      {
        // Top of root margin pulled in 60% so we only react when the sentinel
        // is in the LOWER 40% of the viewport (where the FAB sits).
        rootMargin: "-60% 0px 0px 0px",
        threshold: 0,
      },
    );

    sentinels.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  if (isNativePlatform()) return null;

  const hidden = hideWhen || autoHidden;

  const fabClassName = cn(
    "fixed z-40 lg:hidden",
    // Above the phone tab bar when it is showing (--bottom-nav-height is set by
    // MobileBottomNav, unset otherwise), else clear of the home indicator.
    "right-6 bottom-[max(calc(var(--bottom-nav-height,0px)_+_16px),max(env(safe-area-inset-bottom),24px))]",
    "inline-flex h-14 w-14 items-center justify-center rounded-full",
    "bg-brand-primary text-white",
    "shadow-[0_8px_24px_rgba(36,156,162,0.35)]",
    "transition-[transform,opacity] duration-200 ease-out",
    "active:scale-[0.94]",
    hidden && "translate-y-24 opacity-0 pointer-events-none",
  );

  if (menuItems) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            ref={ref}
            type="button"
            aria-label={label}
            title={label}
            className={fabClassName}
            {...rest}
          >
            <span className="sr-only">{label}</span>
            <span aria-hidden>{icon}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="top"
          sideOffset={12}
          className="w-56"
        >
          {menuItems.map((item) => (
            <DropdownMenuItem
              key={item.label}
              onSelect={item.onClick}
              disabled={item.disabled}
              className={cn(item.destructive && "text-rose-600 focus:text-rose-700")}
            >
              {item.icon && <span className="mr-2">{item.icon}</span>}
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={fabClassName}
      {...rest}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden>{icon}</span>
    </button>
  );
});
