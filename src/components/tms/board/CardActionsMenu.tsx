import { useState, type MouseEvent, type PointerEvent } from "react";
import { ArrowRightLeft, Ban, Check, Link2, MoreHorizontal, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  TaskCancelDialog,
  TaskDeleteDialog,
  useTaskManageMode,
} from "@/components/tms/TaskManageActions";
import { useCurrentUser, type Task, type TaskStatus } from "@/hooks/useTasks";
import { useSupportInstitutionId } from "@/hooks/useSupportRequest";
import { allowedMoves, BOARD_COLUMNS, taskDeepLink } from "@/lib/taskBoard";
import { toastError, toastSuccess } from "@/lib/toast";

interface CardActionsMenuProps {
  task: Task;
  /** Routes through the board's move pipeline (refusal check, confirm, write). */
  onRequestMove?: (task: Task, target: TaskStatus) => void;
}

// dnd-kit starts a drag on pointerdown and the card opens on click, so every
// interactive surface in this menu swallows both before they reach the card.
const stop = (e: MouseEvent | PointerEvent) => e.stopPropagation();

export function CardActionsMenu({ task, onRequestMove }: CardActionsMenuProps) {
  const { data: currentUser } = useCurrentUser();
  const { data: supportInstitutionId } = useSupportInstitutionId();
  const manageMode = useTaskManageMode(task);
  const [confirm, setConfirm] = useState<"delete" | "cancel" | null>(null);

  const isSupportTask = Boolean(
    supportInstitutionId && task.institution_id === supportInstitutionId,
  );
  const moves = onRequestMove
    ? allowedMoves(task, { userId: currentUser?.id, canApprove: false, isSupportTask })
    : [];

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(taskDeepLink(task.id));
      toastSuccess("Link copied");
    } catch (err) {
      toastError(err, { fallback: "Couldn't copy the link.", context: "taskBoardCopyLink" });
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="More actions"
            className="h-7 w-7 rounded-md text-muted-foreground hover:text-ink-900"
            onPointerDown={stop}
            onClick={stop}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onPointerDown={stop} onClick={stop} className="w-52">
          {moves.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowRightLeft className="mr-2 h-4 w-4" />
                Change status
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent onPointerDown={stop} onClick={stop}>
                {BOARD_COLUMNS.map((column) => {
                  const isCurrent = column.status === task.status;
                  const allowed = moves.some((m) => m.status === column.status);
                  if (!isCurrent && !allowed) return null;
                  return (
                    <DropdownMenuItem
                      key={column.id}
                      disabled={isCurrent}
                      onSelect={() => onRequestMove?.(task, column.status)}
                    >
                      <span className="mr-2 inline-flex h-4 w-4 items-center justify-center">
                        {isCurrent && <Check className="h-4 w-4" aria-hidden />}
                      </span>
                      {column.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          <DropdownMenuItem onSelect={() => void copyLink()}>
            <Link2 className="mr-2 h-4 w-4" />
            Copy link
          </DropdownMenuItem>

          {manageMode && (
            <>
              <DropdownMenuSeparator />
              {manageMode === "delete" ? (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setConfirm("delete")}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => setConfirm("cancel")}>
                  <Ban className="mr-2 h-4 w-4" />
                  Cancel this task
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Confirms live outside the menu: a menu item unmounts on select, so a
          dialog nested inside it would vanish with it. They reuse the exact
          copy and mutations TaskManageActions shows on the card view. */}
      <TaskDeleteDialog
        task={task}
        open={confirm === "delete"}
        onOpenChange={(open) => !open && setConfirm(null)}
      />
      <TaskCancelDialog
        task={task}
        open={confirm === "cancel"}
        onOpenChange={(open) => !open && setConfirm(null)}
      />
    </>
  );
}
