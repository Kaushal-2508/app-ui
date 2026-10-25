import { Badge } from "@/components/ui/badge";
import { cn, formatClassName } from "@/lib/utils";
import type { PTMScopeType } from "@/lib/ptm";
import type { PTMClassRef } from "@/hooks/ptm";

interface Props {
  scopeType: PTMScopeType;
  wingName?: string | null;
  classes: PTMClassRef[];
  /** How many class chips to show before collapsing into "+N more". */
  max?: number;
  /** An online PTM has no classes until its teachers pick students; say
   *  that instead of "Whole school", which would be false. */
  emptyLabel?: string;
}

// Tinted pills: the tint carries the colour, the text stays on the ink scale
// so it reads at small sizes in both themes.
const CHIP = "font-medium text-ink-700";
const SCHOOL_CHIP = "border-sky-500/20 bg-sky-500/10";
const WING_CHIP = "border-violet-500/20 bg-violet-500/10";
const CLASS_CHIP = "border-brand-primary/20 bg-brand-primary/10";
const MORE_CHIP = "border-surface-stroke bg-muted/60 text-ink-500";

/** Who the PTM is for, as chips: the whole school, a wing, or its classes. */
export function PTMScopeChips({ scopeType, wingName, classes, max = 3, emptyLabel }: Props) {
  if (classes.length === 0 && emptyLabel) {
    return (
      <Badge variant="outline" className={cn(CHIP, MORE_CHIP)}>
        {emptyLabel}
      </Badge>
    );
  }
  if (scopeType === "school" || classes.length === 0) {
    return (
      <Badge variant="outline" className={cn(CHIP, SCHOOL_CHIP)}>
        Whole school
      </Badge>
    );
  }
  if (scopeType === "wing") {
    return (
      <span className="flex flex-wrap gap-1">
        <Badge variant="outline" className={cn(CHIP, WING_CHIP)}>
          {wingName ? `${wingName} wing` : "One wing"}
        </Badge>
        <Badge variant="outline" className={cn(CHIP, MORE_CHIP)}>
          {classes.length === 1 ? "1 class" : `${classes.length} classes`}
        </Badge>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1">
      {classes.slice(0, max).map((c) => (
        <Badge key={c.id} variant="outline" className={cn(CHIP, CLASS_CHIP)}>
          {formatClassName(c.name, c.section)}
        </Badge>
      ))}
      {classes.length > max && (
        <Badge variant="outline" className={cn(CHIP, MORE_CHIP)}>
          +{classes.length - max} more
        </Badge>
      )}
    </span>
  );
}
