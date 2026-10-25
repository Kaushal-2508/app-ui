import type { ReactNode } from "react";
import { Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Props {
  /** The metric's name, as the label beside the button shows it. */
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * The "i" beside a metric: tap or click for what the number counts. A
 * Popover rather than a Tooltip, because a tooltip never opens on a phone.
 */
export function MetricInfo({ label, children, className }: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`What ${label} means`}
          // 24px to look at, 40px to hit: the ::after widens the tap target
          // without pushing the header row apart.
          className={cn(
            "relative h-6 w-6 shrink-0 rounded-full text-ink-500 after:absolute after:-inset-2 after:content-[''] hover:bg-brand-primary/10 hover:text-brand-primary data-[state=open]:bg-brand-primary/10 data-[state=open]:text-brand-primary [&_svg]:size-3.5",
            className,
          )}
        >
          <Info aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        collisionPadding={16}
        className="w-72 max-w-[calc(100vw-32px)] space-y-1 rounded-xl p-3 text-left"
      >
        <p className="text-sm font-semibold text-ink-900">{label}</p>
        <p className="whitespace-normal text-xs font-normal leading-relaxed text-ink-600">{children}</p>
      </PopoverContent>
    </Popover>
  );
}
