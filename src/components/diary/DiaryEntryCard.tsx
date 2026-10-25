import { useState } from "react";
import { CalendarClock, MoreHorizontal, Trash2, User, Users } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TONES } from "@/components/shared/design-system";
import { MetaLine, NoticeChip, NoticeMetaChip } from "@/components/notices/NoticeBits";
import { formatNoticeDate } from "@/components/notices/noticeMeta";
import { useDeleteDiaryEntry, type DiaryEntry } from "@/hooks/diary";
import { cn } from "@/lib/utils";

import { diaryKindMeta, dueLabel } from "./diaryMeta";

/**
 * One diary entry. Shows the whole body: diary entries are a few sentences,
 * and a family reading "Was due 3 Sep" should not have to open anything to
 * see what was due. The kind lives in the tinted disc and a small chip; the
 * meta line says who it is for and who wrote it.
 */
export function DiaryEntryCard({ entry }: { entry: DiaryEntry }) {
  const kind = diaryKindMeta(entry.kind);
  const Icon = kind.icon;
  const tone = TONES[kind.tone];
  const due = entry.kind === "homework" ? dueLabel(entry.due_date) : null;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const remove = useDeleteDiaryEntry();

  return (
    <li className="surface-card frosted-shadow rounded-card relative px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3 sm:gap-4">
        <span
          aria-hidden
          title={kind.label}
          className={cn(
            "mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            tone.bg,
            tone.fg,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="min-w-0 text-[16px] leading-[24px] font-semibold text-ink-900 break-words">
              {entry.title}
            </h3>
            <div className="flex shrink-0 items-center gap-1 pt-[3px]">
              <span className="text-[12px] leading-[18px] tabular-nums text-ink-500">
                {formatNoticeDate(entry.created_at)}
              </span>
              {entry.can_manage && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Entry actions"
                      className="-mr-2 -mt-1.5 h-8 w-8 rounded-full text-ink-500"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      onSelect={() => setConfirmOpen(true)}
                      className="text-rose-600 focus:text-rose-700"
                    >
                      <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                      Remove entry
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          <MetaLine
            className="mt-0.5"
            parts={[
              <span key="for" className="inline-flex items-center gap-1">
                {entry.student_id ? (
                  <User className="h-3 w-3 text-ink-400" aria-hidden />
                ) : (
                  <Users className="h-3 w-3 text-ink-400" aria-hidden />
                )}
                {entry.student_name ?? entry.class_label}
              </span>,
              entry.student_id ? entry.class_label : null,
              entry.author_name ? `by ${entry.author_name}` : null,
            ]}
          />

          <p className="mt-2 whitespace-pre-wrap break-words text-[14px] leading-[21px] text-ink-700">
            {entry.body}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <NoticeChip tone={kind.tone} icon={<Icon />}>
              {kind.label}
            </NoticeChip>
            {due && (
              <NoticeMetaChip
                icon={<CalendarClock />}
                className={cn(due.overdue && "border-rose-500/40 text-rose-600 dark:text-rose-400")}
              >
                {due.label}
              </NoticeMetaChip>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this diary entry?</AlertDialogTitle>
            <AlertDialogDescription>
              "{entry.title}" will disappear from the diary for{" "}
              {entry.student_name ?? entry.class_label}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                remove.mutate(entry.id, { onSuccess: () => setConfirmOpen(false) });
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {remove.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

export function DiaryEntrySkeleton() {
  return (
    <li className="surface-card frosted-shadow rounded-card px-4 py-4 sm:px-5" aria-hidden>
      <div className="flex items-start gap-3 sm:gap-4">
        <span className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-ink-400/15" />
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="h-4 w-1/2 animate-pulse rounded bg-ink-400/15" />
            <span className="h-3 w-12 animate-pulse rounded bg-ink-400/15" />
          </div>
          <span className="block h-3 w-1/3 animate-pulse rounded bg-ink-400/10" />
          <span className="block h-3 w-11/12 animate-pulse rounded bg-ink-400/10" />
          <span className="block h-3 w-2/3 animate-pulse rounded bg-ink-400/10" />
        </div>
      </div>
    </li>
  );
}
