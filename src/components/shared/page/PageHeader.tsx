import * as React from "react";
import { ChevronDown, MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { usePageShellNested } from "./PageShell";

export interface PageHeaderAction {
  label: string;
  onClick?: () => void;
  icon?: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  /**
   * When provided, the action renders as a DropdownMenu trigger and these
   * items become the menu rows. `onClick` is ignored in this mode.
   * On a secondary action the inline (lg+) menu also opens on mouse hover,
   * and inside the <lg kebab the items appear as a group under this label.
   */
  menuItems?: PageHeaderAction[];
}

/** Outlined pill used for inline secondary actions. Exported so a self-managing
 *  control placed in `extras` (a dialog with its own trigger) can match them. */
export const SECONDARY_PILL =
  "h-10 rounded-full border-surface-stroke bg-surface-card px-4 text-sm font-medium text-ink-700 shadow-card-sm transition-[colors,box-shadow] hover:bg-ink-400/5 hover:text-ink-900 hover:shadow-card";

/**
 * An inline secondary action with menuItems. A mouse opens it by hovering
 * and it stays open while the pointer is on the button or the menu, closing
 * shortly after it leaves both (the delay bridges the gap between them).
 * Click, tap, Enter and Space still open it, so touch and keyboard users are
 * not locked out. modal={false} so the page behind keeps its pointer events,
 * which hover needs to notice the pointer leaving.
 */
function HoverMenuAction({ action }: { action: PageHeaderAction }) {
  const [open, setOpen] = React.useState(false);
  const closeTimer = React.useRef<number | null>(null);
  // Set when the pointer leaving closed the menu, so focus is not pulled back
  // onto the trigger (a stray focus ring after a mere hover).
  const closedByHover = React.useRef(false);
  const openRef = React.useRef(open);
  openRef.current = open;

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const onPointerEnter = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || action.disabled) return;
    cancelClose();
    closedByHover.current = false;
    setOpen(true);
  };
  const onPointerLeave = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      if (openRef.current) closedByHover.current = true;
      setOpen(false);
    }, 150);
  };
  React.useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(next) => {
        cancelClose();
        if (next) closedByHover.current = false;
        setOpen(next);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={action.disabled}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
          onPointerDown={(e) => {
            // Hover already opened it; a click must not toggle it shut.
            if (e.pointerType === "mouse" && open) e.preventDefault();
          }}
          className={cn(SECONDARY_PILL, action.destructive && "text-rose-600 hover:text-rose-700")}
        >
          {action.icon && <span className="mr-1">{action.icon}</span>}
          {action.label}
          <ChevronDown className="ml-1 h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56"
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onCloseAutoFocus={(e) => {
          if (closedByHover.current) {
            e.preventDefault();
            closedByHover.current = false;
          }
        }}
      >
        {(action.menuItems ?? []).map((item) => (
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

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  primaryAction?: PageHeaderAction;
  secondaryActions?: PageHeaderAction[];
  className?: string;
  /**
   * When true, secondary actions are always rendered inside the kebab dropdown
   * (no inline display at lg+). Useful when a page has 4+ secondary actions
   * that would otherwise crowd the header row.
   */
  collapseSecondary?: boolean;
  /**
   * Visible label for the collapsed secondary-actions menu trigger. When set,
   * the anonymous "⋯" kebab becomes a labelled outline button (e.g. "Bulk
   * Actions") so users can tell what the menu holds before opening it. Unset
   * keeps the icon-only kebab.
   */
  secondaryMenuLabel?: string;
  /**
   * Arbitrary ReactNode rendered in the action cluster, to the left of the
   * primary CTA on every breakpoint. Use for self-managing controls (e.g. a
   * filter chip with its own popover) that don't fit the `PageHeaderAction`
   * shape. Stays visible on mobile so users don't have to open the kebab to
   * reach it.
   */
  extras?: React.ReactNode;
  /**
   * `compact` shrinks the title and roughly halves the block's vertical
   * padding. Opt in for a working surface where the content below is the point
   * and the title is only a label: on a laptop the default header plus a
   * filter row can take a third of the screen before the first row of data.
   * Pages that do not ask for it render exactly as before.
   */
  density?: "default" | "compact";
}

/**
 * Standard page title block. Sits directly under the top app bar on the
 * gradient (no card wrapper). Uses a CSS-only responsive split for actions:
 *
 * - lg+ (≥1024px): all actions inline (primary CTA + ghost-button secondaries)
 * - <lg: primary CTA + kebab dropdown for ALL secondary actions
 *
 * The kebab uses shadcn DropdownMenu. Destructive items render in rose-600;
 * callers should also pass a leading icon for accessibility (color alone
 * is a WCAG 1.4.1 fail).
 */
export function PageHeader({
  title,
  subtitle,
  icon,
  primaryAction,
  secondaryActions = [],
  className,
  collapseSecondary = false,
  secondaryMenuLabel,
  extras,
  density = "default",
}: PageHeaderProps) {
  // A tab sub-page (Students under Manage Users) renders its own PageHeader
  // under the host's. Two full title blocks were ~400px of headings before
  // the first control on a phone (2026-09-18 audit), so the nested one is a
  // section heading: compact, no icon, subtitle only from md up. Its actions
  // stay, they are the page's controls.
  const nested = usePageShellNested();
  const compact = density === "compact" || nested;
  return (
    <header
      className={cn(
        // native-page-header: inert on the web; the native shell tightens the
        // vertical padding through index.css.
        "flex flex-col gap-3 md:flex-row md:items-start md:gap-6 native-page-header",
        compact ? "py-3 sm:py-4 lg:py-5" : "py-4 sm:py-6 lg:py-8",
        nested && "pt-1 sm:pt-2",
        className,
      )}
    >
      <div className="flex flex-1 items-start gap-3 lg:gap-4 min-w-0">
        {icon && !nested && (
          <span
            className={cn(
              "mt-0.5 inline-flex shrink-0 items-center justify-center rounded-2xl bg-brand-primary/10 text-brand-primary",
              compact ? "h-10 w-10" : "h-10 w-10 lg:h-12 lg:w-12",
            )}
          >
            {icon}
          </span>
        )}
        <div className="flex-1 min-w-0">
          {/* line-clamp-2, not truncate: at 26px on a 375px phone a title as
              ordinary as "Create homework & assignment" was ellipsized to
              "Create homework ...", so the page could not tell you what it
              was. Two lines then clamp, so it still cannot grow unbounded.
              Titles that already fit render identically. */}
          <h1
            className={cn(
              "line-clamp-2 break-words font-bold text-ink-900 tracking-tight",
              compact
                ? "text-[22px] leading-[28px] sm:text-[24px] sm:leading-[30px] lg:text-[28px] lg:leading-[34px]"
                : "text-[26px] leading-[32px] sm:text-[32px] sm:leading-[40px] lg:text-[40px] lg:leading-[48px] xl:text-[44px] xl:leading-[52px]",
            )}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              className={cn(
                "line-clamp-2 text-sm text-ink-600",
                compact
                  ? "mt-1"
                  : "mt-1.5 lg:mt-2 sm:text-[15px] sm:leading-[22px] lg:text-base lg:leading-[24px]",
                nested && "hidden md:block",
              )}
            >
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {(primaryAction || secondaryActions.length > 0 || extras) && (
        <ActionCluster
          primaryAction={primaryAction}
          secondaryActions={secondaryActions}
          collapseSecondary={collapseSecondary}
          secondaryMenuLabel={secondaryMenuLabel}
          extras={extras}
        />
      )}
    </header>
  );
}

function ActionCluster({
  primaryAction,
  secondaryActions,
  collapseSecondary,
  secondaryMenuLabel,
  extras,
}: {
  primaryAction?: PageHeaderAction;
  secondaryActions: PageHeaderAction[];
  collapseSecondary: boolean;
  secondaryMenuLabel?: string;
  extras?: React.ReactNode;
}) {
  // CSS-only responsive split: same array rendered twice, with one branch
  // hidden per breakpoint. SSR-safe; no JS viewport detection.
  return (
    <div className="flex shrink-0 items-center gap-2">
      {/* Extras slot — visible on every breakpoint, leftmost in the cluster.
          Use for self-managing controls (e.g. filter chip with popover) that
          don't fit the PageHeaderAction shape. */}
      {extras}

      {/* Inline secondary actions (lg+ only, suppressed when collapseSecondary) */}
      {secondaryActions.length > 0 && !collapseSecondary && (
        <div className="hidden lg:flex items-center gap-2">
          {secondaryActions.map((action) =>
            action.menuItems ? (
              <HoverMenuAction key={action.label} action={action} />
            ) : (
              // Outlined pills, not bare ghost text: next to a solid primary
              // the ghost labels read as stray words on the backdrop rather
              // than as things you can press (Tasks header, 2026-09-15).
              <Button
                key={action.label}
                variant="outline"
                size="sm"
                onClick={action.onClick}
                disabled={action.disabled}
                className={cn(SECONDARY_PILL, action.destructive && "text-rose-600 hover:text-rose-700")}
              >
                {action.icon && <span className="mr-1">{action.icon}</span>}
                {action.label}
              </Button>
            ),
          )}
        </div>
      )}

      {/* Primary CTA — always visible */}
      {primaryAction && (
        primaryAction.menuItems ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={primaryAction.disabled}
                className="bg-brand-primary text-white hover:bg-brand-primary/90 active:scale-[0.98]"
              >
                {primaryAction.icon && <span className="mr-2">{primaryAction.icon}</span>}
                {primaryAction.label}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {primaryAction.menuItems.map((item) => (
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
        ) : (
          <Button
            onClick={primaryAction.onClick}
            disabled={primaryAction.disabled}
            className="bg-brand-primary text-white hover:bg-brand-primary/90 active:scale-[0.98]"
          >
            {primaryAction.icon && <span className="mr-2">{primaryAction.icon}</span>}
            {primaryAction.label}
          </Button>
        )
      )}

      {/* Kebab — visible on <lg, or always when collapseSecondary is set.
          With secondaryMenuLabel it is a labelled outline button instead. */}
      {secondaryActions.length > 0 && (
        <div className={cn(!collapseSecondary && "lg:hidden")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {secondaryMenuLabel ? (
                <Button variant="outline">
                  {secondaryMenuLabel}
                  <ChevronDown className="ml-2 h-4 w-4" aria-hidden />
                </Button>
              ) : (
                <Button variant="ghost" size="icon" aria-label="More actions">
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {secondaryActions.map((action, idx) =>
                action.menuItems ? (
                  // No hover on a phone: a menu action becomes a labelled
                  // group of rows, fenced off from its neighbours.
                  <React.Fragment key={action.label}>
                    {idx > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel className="text-xs font-medium text-ink-500">
                      {action.label}
                    </DropdownMenuLabel>
                    {action.menuItems.map((item) => (
                      <DropdownMenuItem
                        key={item.label}
                        onSelect={item.onClick}
                        disabled={action.disabled || item.disabled}
                        className={cn(item.destructive && "text-rose-600 focus:text-rose-700")}
                      >
                        {item.icon && <span className="mr-2">{item.icon}</span>}
                        {item.label}
                      </DropdownMenuItem>
                    ))}
                    {idx < secondaryActions.length - 1 && <DropdownMenuSeparator />}
                  </React.Fragment>
                ) : (
                  <DropdownMenuItem
                    key={action.label}
                    onSelect={action.onClick}
                    disabled={action.disabled}
                    className={cn(action.destructive && "text-rose-600 focus:text-rose-700")}
                  >
                    {action.icon && <span className="mr-2">{action.icon}</span>}
                    {action.label}
                  </DropdownMenuItem>
                ),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
