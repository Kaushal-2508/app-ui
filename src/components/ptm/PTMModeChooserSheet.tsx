import { CalendarPlus, ChevronRight, MapPin, Video, type LucideIcon } from "lucide-react";

import { MobileSheet } from "@/components/shared/sheets";
import { cn } from "@/lib/utils";
import type { PTMHat, PTMMode } from "@/lib/ptm";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hat: PTMHat;
  onPick: (mode: PTMMode) => void;
}

/**
 * The first question when pressing "Schedule PTM": a regular meeting at the
 * school, or an online one (the code calls it "residential"; the screen says
 * "Online PTM" since 2026-10-05). Shown only once the online migration is
 * live; before that the button opens the regular form directly, as it always
 * did.
 */
export function PTMModeChooserSheet({ open, onOpenChange, hat, onPick }: Props) {
  const onlineCopy =
    hat === "teacher"
      ? "On Google Meet. You pick the students; families book a slot with you."
      : "On Google Meet. You pick a class and its teachers; each teacher picks their students.";

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Schedule a PTM"
      subtitle="Which kind of meeting?"
      icon={<CalendarPlus className="h-5 w-5" />}
      placement="center"
      // The rows' hover tint must not square off the panel's rounded corners.
      className="overflow-hidden"
      // The two choices are rows of the panel itself, not cards inside it:
      // bordered cards in a bordered dialog read as boxes in a box
      // (2026-10-07). The body padding goes, each row pads itself to the
      // header's px-5 gutter, and a hairline separates the two.
      bodyClassName="p-0"
    >
      <div className="divide-y divide-surface-stroke">
        <Choice
          icon={MapPin}
          accent="teal"
          title="Regular PTM"
          copy="At the school. Choose the school, a wing or classes; families book a slot per class."
          onClick={() => onPick("in_person")}
        />
        <Choice icon={Video} accent="violet" title="Online PTM" copy={onlineCopy} onClick={() => onPick("online")} />
      </div>
    </MobileSheet>
  );
}

/**
 * One hue per row so the two kinds read apart at a glance, not just by their
 * words: the brand's own teal / lilac pair (the dashboards' `--dash-teal` and
 * `--dash-violet`). A solid tile carries the hue, a soft band of it washes the
 * whole row, and the chevron matches. Both tokens are defined for light and
 * dark, so the pairing holds in either theme.
 */
const ACCENTS = {
  teal: {
    band: "bg-brand-primary/[0.06] hover:bg-brand-primary/[0.12] active:bg-brand-primary/[0.16] focus-visible:bg-brand-primary/[0.12]",
    tile: "bg-brand-primary text-white",
    chevron: "text-brand-primary",
  },
  violet: {
    band: "bg-brand-secondary/[0.08] hover:bg-brand-secondary/[0.16] active:bg-brand-secondary/[0.22] focus-visible:bg-brand-secondary/[0.16]",
    tile: "bg-brand-secondary text-white",
    chevron: "text-brand-secondary",
  },
} as const;

function Choice({
  icon: Icon,
  accent,
  title,
  copy,
  onClick,
}: {
  icon: LucideIcon;
  accent: keyof typeof ACCENTS;
  title: string;
  copy: string;
  onClick: () => void;
}) {
  const a = ACCENTS[accent];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-4 px-5 py-4 text-left transition-colors duration-200 focus-visible:outline-none",
        a.band,
      )}
    >
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm", a.tile)}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink-900">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-600">{copy}</span>
      </span>
      <ChevronRight className={cn("h-4 w-4 shrink-0", a.chevron)} aria-hidden="true" />
    </button>
  );
}
