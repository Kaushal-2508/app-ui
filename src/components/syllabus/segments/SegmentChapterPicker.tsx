import { useMemo, useState } from "react";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { Checkbox } from "@/components/ui/checkbox";
import { ListChecks } from "lucide-react";
import type { SubjectChapter } from "@/hooks/useSyllabusSegments";

interface SegmentChapterPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partName: string;
  chapters: SubjectChapter[];
  initialSelectedIds: string[];
  saving: boolean;
  /** Parent runs the confirmation popup and the write. */
  onSave: (chapterIds: string[]) => void;
}

/**
 * Read the subject's chapter list (same list the syllabus tab shows) and let the
 * user tick which belong to a part. A chapter may be ticked in many parts. The
 * parent shows the "applies to all sections" confirmation before saving.
 *
 * The parent mounts this fresh per part (keyed), so the initial selection is
 * seeded once from props with no re-seeding effect.
 */
export function SegmentChapterPicker({
  open,
  onOpenChange,
  partName,
  chapters,
  initialSelectedIds,
  saving,
  onSave,
}: SegmentChapterPickerProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelectedIds),
  );

  const allChecked = useMemo(
    () => chapters.length > 0 && chapters.every((c) => selected.has(c.id)),
    [chapters, selected],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allChecked ? new Set() : new Set(chapters.map((c) => c.id)));
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Choose chapters"
      subtitle={partName}
      icon={<ListChecks className="h-4 w-4" />}
      primaryAction={{
        label: "Save chapters",
        onClick: () => onSave([...selected]),
        loading: saving,
      }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false) }}
    >
      {chapters.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-500">
          This subject has no chapters yet. Add chapters to the syllabus first,
          then you can group them into parts.
        </p>
      ) : (
        <div className="space-y-1">
          <label className="flex items-center gap-2.5 rounded-lg border border-surface-stroke bg-surface-base/60 px-3 py-2.5">
            <Checkbox checked={allChecked} onCheckedChange={toggleAll} />
            <span className="text-sm font-medium text-ink-800">
              Select all ({chapters.length})
            </span>
          </label>

          {chapters.map((chapter) => (
            <label
              key={chapter.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 hover:bg-surface-base/60"
            >
              <Checkbox
                checked={selected.has(chapter.id)}
                onCheckedChange={() => toggle(chapter.id)}
              />
              <span className="text-sm text-ink-800">
                {chapter.chapterNumber != null
                  ? `Ch ${chapter.chapterNumber}. ${chapter.name}`
                  : chapter.name}
              </span>
            </label>
          ))}

          <p className="px-1 pt-2 text-xs text-ink-500">
            {selected.size} of {chapters.length} chapters selected
          </p>
        </div>
      )}
    </MobileSheet>
  );
}
