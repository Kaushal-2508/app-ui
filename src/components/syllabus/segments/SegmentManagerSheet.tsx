import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Plus, Trash2, Layers, Check, X } from "lucide-react";
import { toast } from "sonner";

import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/toast";
import { logActivityEvent } from "@/lib/activityLog";
import {
  useClassGroupId,
  useSegmentMutations,
  useSubjectChapters,
  useSyllabusSegments,
  type SyllabusSegment,
} from "@/hooks/useSyllabusSegments";
import { SegmentChapterPicker } from "./SegmentChapterPicker";

interface SegmentManagerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Section id from the syllabus tab (classes.id); resolved to its class_group. */
  classId: string;
  subjectId: string;
  subjectName: string;
  className: string;
  institutionId: string | null;
  canManage: boolean;
}

interface ConfirmState {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  run: () => Promise<void>;
}

export function SegmentManagerSheet({
  open,
  onOpenChange,
  classId,
  subjectId,
  subjectName,
  className,
  institutionId,
  canManage,
}: SegmentManagerSheetProps) {
  const { data: classGroupId = null } = useClassGroupId(open ? classId : null);
  const {
    data: segments = [],
    isLoading,
    isError,
  } = useSyllabusSegments(open ? classGroupId : null, open ? subjectId : null);
  const { data: chapters = [] } = useSubjectChapters(
    open ? subjectId : null,
    institutionId,
  );
  const { create, rename, remove, reorder, setChapters } = useSegmentMutations(
    classGroupId,
    subjectId,
  );

  const [order, setOrder] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [pickerSegmentId, setPickerSegmentId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const serverOrderKey = segments.map((s) => s.id).join(",");
  // Keep the local drag order in sync whenever the server list changes.
  // Reconstruct the id list from serverOrderKey (the sole dependency) so the
  // effect needs nothing else.
  useEffect(() => {
    setOrder(serverOrderKey ? serverOrderKey.split(",") : []);
  }, [serverOrderKey]);

  const byId = useMemo(() => {
    const map = new Map<string, SyllabusSegment>();
    for (const s of segments) map.set(s.id, s);
    return map;
  }, [segments]);

  const orderedSegments = order
    .map((id) => byId.get(id))
    .filter((s): s is SyllabusSegment => !!s);

  const orderDirty = order.join(",") !== serverOrderKey;
  const dragEnabled =
    canManage && segments.length > 1 && editingId === null && !confirmBusy;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const applyAllCopy = (prefix: string) =>
    `${prefix} This applies to all sections of ${className} for ${subjectName}.`;

  const ask = (state: ConfirmState) => setConfirm(state);

  const runConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      await confirm.run();
    } finally {
      setConfirmBusy(false);
      setConfirm(null);
    }
  };

  const pickerSegment = segments.find((s) => s.id === pickerSegmentId) ?? null;

  // --- actions (each opens the confirmation popup first) ---
  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    ask({
      title: "Add this part?",
      description: applyAllCopy(`Add the part "${name}".`),
      confirmLabel: "Add part",
      run: async () => {
        try {
          await create.mutateAsync(name);
          setNewName("");
          toast.success("Part added.");
        } catch (err) {
          toastError(err, {
            fallback: "Could not add the part.",
            context: "createSegment",
          });
        }
      },
    });
  };

  const handleRename = () => {
    const name = editingName.trim();
    const id = editingId;
    if (!name || !id) return;
    ask({
      title: "Rename this part?",
      description: applyAllCopy(`Rename this part to "${name}".`),
      confirmLabel: "Rename",
      run: async () => {
        try {
          await rename.mutateAsync({ segmentId: id, name });
          setEditingId(null);
          setEditingName("");
          toast.success("Part renamed.");
        } catch (err) {
          toastError(err, {
            fallback: "Could not rename the part.",
            context: "renameSegment",
          });
        }
      },
    });
  };

  const handleDelete = (segment: SyllabusSegment) => {
    ask({
      title: "Delete this part?",
      description: applyAllCopy(
        `Delete the part "${segment.name}". This removes only the grouping, not any chapter or the syllabus.`,
      ),
      confirmLabel: "Delete part",
      destructive: true,
      run: async () => {
        try {
          await remove.mutateAsync(segment.id);
          toast.success("Part deleted.");
          void logActivityEvent({
            action: "segment_deleted",
            entityType: "Syllabus part",
            entityId: segment.id,
            entityName: segment.name,
            metadata: institutionId
              ? { institution_id: institutionId, subject_id: subjectId }
              : {},
          });
        } catch (err) {
          toastError(err, {
            fallback: "Could not delete the part.",
            context: "deleteSegment",
          });
        }
      },
    });
  };

  const handleSaveOrder = () => {
    const idsToSave = [...order];
    ask({
      title: "Save the new order?",
      description: applyAllCopy("Change the order of the parts."),
      confirmLabel: "Save order",
      run: async () => {
        try {
          await reorder.mutateAsync(idsToSave);
          toast.success("Order saved.");
        } catch (err) {
          toastError(err, {
            fallback: "Could not save the order.",
            context: "reorderSegments",
          });
        }
      },
    });
  };

  const handleSaveChapters = (chapterIds: string[]) => {
    const id = pickerSegmentId;
    const name = pickerSegment?.name ?? "this part";
    if (!id) return;
    ask({
      title: "Save chapters for this part?",
      description: applyAllCopy(`Update the chapters in "${name}".`),
      confirmLabel: "Save chapters",
      run: async () => {
        try {
          await setChapters.mutateAsync({ segmentId: id, chapterIds });
          setPickerSegmentId(null);
          toast.success("Chapters updated.");
        } catch (err) {
          toastError(err, {
            fallback: "Could not update the chapters.",
            context: "setSegmentChapters",
          });
        }
      },
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  return (
    <>
      <MobileSheet
        open={open}
        onOpenChange={onOpenChange}
        title="Syllabus parts"
        subtitle={`${subjectName}, ${className}`}
        icon={<Layers className="h-4 w-4" />}
        primaryAction={
          orderDirty && canManage
            ? {
                label: "Save order",
                onClick: handleSaveOrder,
                loading: reorder.isPending,
              }
            : undefined
        }
        secondaryAction={
          orderDirty && canManage
            ? {
                label: "Reset order",
                onClick: () => setOrder(segments.map((s) => s.id)),
              }
            : undefined
        }
      >
        {canManage && (
          <div className="mb-4 flex items-center gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              placeholder="New part name, for example PA1"
              maxLength={80}
            />
            <Button
              onClick={handleAdd}
              disabled={!newName.trim() || create.isPending}
              className="shrink-0"
            >
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <p className="py-8 text-center text-sm text-destructive">
            Something went wrong loading the parts. Please try again.
          </p>
        ) : segments.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm font-medium text-ink-800">No parts yet</p>
            <p className="mt-1 text-sm text-ink-500">
              {canManage
                ? "Add a part above, such as PA1 or Term 1, then choose which chapters belong to it."
                : "The syllabus for this subject has not been split into parts."}
            </p>
          </div>
        ) : (
          <>
            {canManage && segments.length > 1 && (
              <p className="mb-2 text-xs text-ink-500">
                Drag to reorder. Changes apply to all sections.
              </p>
            )}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={order}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-2">
                  {orderedSegments.map((segment) => (
                    <SortablePartRow
                      key={segment.id}
                      segment={segment}
                      chapterCount={segment.chapterIds.length}
                      canManage={canManage}
                      dragEnabled={dragEnabled}
                      isEditing={editingId === segment.id}
                      editingName={editingName}
                      onEditNameChange={setEditingName}
                      onStartEdit={() => {
                        setEditingId(segment.id);
                        setEditingName(segment.name);
                      }}
                      onCancelEdit={() => {
                        setEditingId(null);
                        setEditingName("");
                      }}
                      onSubmitEdit={handleRename}
                      onDelete={() => handleDelete(segment)}
                      onOpenChapters={() => setPickerSegmentId(segment.id)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          </>
        )}
      </MobileSheet>

      {pickerSegmentId && pickerSegment && (
        <SegmentChapterPicker
          key={pickerSegmentId}
          open
          onOpenChange={(o) => {
            if (!o) setPickerSegmentId(null);
          }}
          partName={pickerSegment.name}
          chapters={chapters}
          initialSelectedIds={pickerSegment.chapterIds}
          saving={setChapters.isPending}
          onSave={handleSaveChapters}
        />
      )}

      <AlertDialog
        open={!!confirm}
        onOpenChange={(o) => {
          if (!o && !confirmBusy) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmBusy}
              className={cn(
                confirm?.destructive &&
                  "bg-destructive text-destructive-foreground hover:bg-destructive/90",
              )}
              onClick={(e) => {
                e.preventDefault();
                void runConfirm();
              }}
            >
              {confirmBusy ? "Working…" : confirm?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface SortablePartRowProps {
  segment: SyllabusSegment;
  chapterCount: number;
  canManage: boolean;
  dragEnabled: boolean;
  isEditing: boolean;
  editingName: string;
  onEditNameChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSubmitEdit: () => void;
  onDelete: () => void;
  onOpenChapters: () => void;
}

function SortablePartRow({
  segment,
  chapterCount,
  canManage,
  dragEnabled,
  isEditing,
  editingName,
  onEditNameChange,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onDelete,
  onOpenChapters,
}: SortablePartRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: segment.id, disabled: !dragEnabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "surface-card rounded-xl border border-surface-stroke p-3",
        isDragging && "opacity-70 shadow-card-lg",
      )}
    >
      <div className="flex items-center gap-2">
        {canManage && (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
            className={cn(
              "shrink-0 rounded-md p-1 text-ink-400",
              dragEnabled
                ? "cursor-grab hover:bg-ink-400/10 active:cursor-grabbing"
                : "cursor-not-allowed opacity-40",
            )}
            disabled={!dragEnabled}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}

        {isEditing ? (
          <div className="flex flex-1 items-center gap-2">
            <Input
              autoFocus
              value={editingName}
              maxLength={80}
              onChange={(e) => onEditNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSubmitEdit();
                if (e.key === "Escape") onCancelEdit();
              }}
              className="h-9"
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0"
              onClick={onSubmitEdit}
              disabled={!editingName.trim()}
              aria-label="Save name"
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0"
              onClick={onCancelEdit}
              aria-label="Cancel"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink-900">
                {segment.name}
              </p>
              <p className="text-xs text-ink-500">
                {chapterCount === 1 ? "1 chapter" : `${chapterCount} chapters`}
              </p>
            </div>

            {canManage ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={onOpenChapters}
                >
                  Chapters
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={onStartEdit}
                  aria-label="Rename part"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={onDelete}
                  aria-label="Delete part"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}
