import { SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CHAPTER_STATUS_STYLE as STYLE, type ChapterTagStatus } from "./chapterStatusStyle";

/** The status pill beside a chapter's name. Renders nothing when the status is not known yet. */
export function ChapterStatusTag({ status, className }: { status: ChapterTagStatus | null | undefined; className?: string }) {
  if (!status) return null;
  const s = STYLE[status];
  const Icon = s.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold leading-4",
        s.pill,
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {s.label}
    </span>
  );
}

/**
 * A chapter row inside a chapter picker (shadcn Select): the whole row tinted
 * by status, the name, and the pill. Every chapter picker uses this, so the
 * list looks the same on every screen and for every class.
 */
export function ChapterSelectItem({
  value,
  label,
  status,
  disabled,
}: {
  value: string;
  label: string;
  /** Unknown (still loading) renders a plain row with no pill, never a guess. */
  status: ChapterTagStatus | null | undefined;
  disabled?: boolean;
}) {
  return (
    <SelectItem
      value={value}
      disabled={disabled}
      className={cn("my-0.5 rounded-md", status ? STYLE[status].row : undefined)}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0">{label}</span>
        <ChapterStatusTag status={status} />
      </span>
    </SelectItem>
  );
}
