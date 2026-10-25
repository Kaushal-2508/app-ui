import { Video } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PTM_MODE_LABEL, type PTMMode } from "@/lib/ptm";

/**
 * "Online" next to the status chip. Renders nothing for an in-person PTM,
 * so every card and header can place it unconditionally and the in-person
 * surfaces look exactly as they did.
 */
export function PTMModeBadge({ mode, className }: { mode: PTMMode; className?: string }) {
  if (mode !== "online") return null;
  return (
    <Badge
      variant="secondary"
      className={cn(
        "shrink-0 gap-1 bg-brand-primary/10 font-medium text-teal-700 ring-1 ring-inset ring-brand-primary/20 dark:text-teal-300",
        className,
      )}
    >
      <Video className="h-3 w-3" aria-hidden="true" />
      {PTM_MODE_LABEL.online}
    </Badge>
  );
}
