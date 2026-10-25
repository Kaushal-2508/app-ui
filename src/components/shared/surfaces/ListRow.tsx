import * as React from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export interface ListRowProps {
  /** 40×40 leading slot — avatar (rounded-full), icon disc (rounded-xl), or anything 40px square. */
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Compact trailing slot. Pass a chevron (default), amount text, status pill, etc. */
  trailing?: React.ReactNode;
  /** Optional inline action row beneath title/subtitle (e.g. "Mark as Done", "Pay Now"). */
  inlineAction?: React.ReactNode;
  /** Whole-row click handler — wraps the row in a button for keyboard / a11y. */
  onClick?: () => void;
  /** Render as a list element when used inside a `<ul>` parent. */
  as?: "div" | "li";
  className?: string;
}

export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  inlineAction,
  onClick,
  as: Wrapper = "div",
  className,
}: ListRowProps) {
  const content = (
    <div className="flex items-center gap-3">
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="truncate text-[15px] leading-[22px] font-medium text-ink-900">{title}</div>
        {subtitle && (
          <div className="truncate text-[13px] leading-[18px] text-ink-500">{subtitle}</div>
        )}
      </div>
      {trailing !== undefined ? (
        <div className="shrink-0">{trailing}</div>
      ) : (
        onClick && <ChevronRight className="h-5 w-5 shrink-0 text-ink-400" />
      )}
    </div>
  );

  const inner = (
    <>
      {content}
      {inlineAction && (
        <div
          className="mt-3 flex items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          {inlineAction}
        </div>
      )}
    </>
  );

  const baseClasses = cn(
    "surface-card frosted-shadow rounded-2xl p-4",
    onClick && "cursor-pointer transition-transform active:scale-[0.99] hover:shadow-md",
    className,
  );

  if (onClick) {
    return (
      <Wrapper className={baseClasses}>
        <button
          type="button"
          onClick={onClick}
          className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40 rounded-2xl"
        >
          {inner}
        </button>
      </Wrapper>
    );
  }

  return <Wrapper className={baseClasses}>{inner}</Wrapper>;
}
