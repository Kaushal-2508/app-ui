import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  Calculator,
  FlaskConical,
  Globe,
  Languages,
  Music,
  Palette,
  Dumbbell,
  Code,
  ChevronRight,
  Pencil,
  Trash2,
  MoreHorizontal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { motion } from "framer-motion";
import { SourceBadge, SourceType } from "@/components/shared/SourceBadge";
import { TONES, type Tone } from "@/components/shared/design-system";

/** A tone per subject family, the same mapping as the tree view, so a column
 *  of subjects is not a column of grey discs (Naman, 2026-10-07). */
const getSubjectTone = (name: string, category: string | null): Tone => {
  const n = name.toLowerCase();
  const c = (category || "").toLowerCase();
  if (n.includes("math") || n.includes("algebra") || n.includes("geometry")) return "teal";
  if (n.includes("science") || n.includes("physics") || n.includes("chemistry") || n.includes("biology") || n.includes("evs")) return "mint";
  if (n.includes("english") || n.includes("hindi") || n.includes("punjabi") || c === "language") return "violet";
  if (n.includes("social") || n.includes("history") || n.includes("geography") || n.includes("civics") || n.includes("gk")) return "sky";
  if (n.includes("art") || n.includes("craft") || n.includes("drawing")) return "peach";
  if (n.includes("music") || n.includes("dance")) return "rose";
  if (n.includes("computer") || n.includes("programming") || n.includes("coding") || n.includes("robot")) return "sky";
  return "teal";
};
const TONE_BAR: Record<Tone, string> = {
  teal: "bg-brand-primary",
  violet: "bg-brand-secondary",
  peach: "bg-brand-accent",
  mint: "bg-emerald-500",
  sky: "bg-sky-500",
  rose: "bg-rose-500",
};

interface SubjectCardProps {
  id: string;
  name: string | null;
  name_hindi?: string | null;
  code: string | null;
  category: string | null;
  topicCount?: number;
  isSelected?: boolean;
  isGlobal?: boolean;
  isActive?: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
}

const getSubjectIcon = (name: string, category: string | null) => {
  const lowerName = name.toLowerCase();
  const lowerCategory = (category || "").toLowerCase();

  if (lowerName.includes("math") || lowerName.includes("algebra") || lowerName.includes("geometry")) {
    return Calculator;
  }
  if (lowerName.includes("science") || lowerName.includes("physics") || lowerName.includes("chemistry") || lowerName.includes("biology")) {
    return FlaskConical;
  }
  if (lowerName.includes("english") || lowerName.includes("hindi") || lowerCategory === "language") {
    return Languages;
  }
  if (lowerName.includes("social") || lowerName.includes("history") || lowerName.includes("geography") || lowerName.includes("civics")) {
    return Globe;
  }
  if (lowerName.includes("art") || lowerName.includes("craft") || lowerName.includes("drawing")) {
    return Palette;
  }
  if (lowerName.includes("music") || lowerName.includes("dance")) {
    return Music;
  }
  if (lowerName.includes("physical") || lowerName.includes("sports") || lowerName.includes("yoga")) {
    return Dumbbell;
  }
  if (lowerName.includes("computer") || lowerName.includes("programming") || lowerName.includes("coding")) {
    return Code;
  }
  return BookOpen;
};

const getCategoryColor = (category: string | null) => {
  switch (category?.toLowerCase()) {
    case "core":
      return "bg-blue-500/10 text-blue-600 border-blue-200";
    case "elective":
      return "bg-purple-500/10 text-purple-600 border-purple-200";
    case "language":
      return "bg-green-500/10 text-green-600 border-green-200";
    case "vocational":
      return "bg-orange-500/10 text-orange-600 border-orange-200";
    default:
      return "bg-muted text-muted-foreground";
  }
};

export const SubjectCard = forwardRef<HTMLDivElement, SubjectCardProps>(function SubjectCard({
  name,
  name_hindi,
  code,
  category,
  topicCount = 0,
  isSelected,
  isGlobal,
  isActive = true,
  onSelect,
  onDelete,
  onEdit,
}, ref) {
  const Icon = getSubjectIcon(name || name_hindi || '', category);
  const displayName = name || name_hindi || 'Unnamed';
  const toneKey = getSubjectTone(displayName, category);
  const tone = TONES[toneKey];

  // Determine source type for badge
  const sourceType: SourceType = !isActive ? "archived" : (isGlobal ? "global" : "institute");

  // One compact row (Naman, 2026-10-07: "fix the ui" on three-line cards):
  // the family's colour as a bar on the left and in the icon disc, the name /
  // code / source as one aligned cluster, the chapter count as a pill, and
  // Edit / Delete behind one always-visible menu rather than hover-only
  // buttons that reserved blank width before the chevron.
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "group relative flex items-center gap-3 overflow-hidden rounded-xl border py-2.5 pl-4 pr-3 cursor-pointer transition-colors duration-200",
        isSelected
          ? "border-brand-primary/50 bg-brand-primary/[0.06]"
          : "border-[hsl(var(--surface-stroke))] bg-[hsl(var(--surface-card))] hover:bg-brand-primary/[0.04]",
      )}
      onClick={onSelect}
    >
      <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-1", TONE_BAR[toneKey])} />
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", tone.bg, tone.fg)}>
        <Icon className="h-4 w-4" />
      </div>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="truncate text-sm font-semibold text-ink-900">{displayName}</span>
        {name && name_hindi && <span className="truncate text-xs text-ink-500">{name_hindi}</span>}
        {code && (
          <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-ink-500">{code}</span>
        )}
        <SourceBadge source={sourceType} size="sm" showIcon={false} />
        {category && (
          <Badge variant="outline" className={cn("h-5 px-1.5 text-[11px]", getCategoryColor(category))}>
            {category}
          </Badge>
        )}
      </div>

      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-ink-600">
        {topicCount} {topicCount === 1 ? "chapter" : "chapters"}
      </span>

      <div className="flex shrink-0 items-center">
        {(onEdit || onDelete) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-ink-500 hover:text-ink-900"
                aria-label={`Actions for ${displayName}`}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              {onEdit && (
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit subject
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  {isGlobal ? "Remove from class" : "Delete subject"}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <ChevronRight className={cn("h-4 w-4", isSelected ? "text-brand-primary" : "text-ink-400")} />
      </div>
    </motion.div>
  );
});
