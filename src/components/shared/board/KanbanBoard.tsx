import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

/**
 * A column is where the POINTER is, not where the card's rectangle happens to
 * overlap most. The default rectIntersection picked the column the dragged
 * card's box intersected, so a card held over one lane could register on a
 * neighbour it still overlapped, and a card whose box did not reach a lane
 * at all registered nothing. Pointer first; the rectangle only as a fallback
 * for keyboard drags, which have no pointer.
 */
const columnCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};
import { AlertCircle, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/surfaces";
import { translateError } from "@/lib/errorMessages";
import { cn } from "@/lib/utils";
import { BoardColumn } from "./BoardColumn";
import { BoardDraggable } from "./BoardDraggable";
import type { BoardColumnDef, BoardDragData, BoardDropData, BoardLane } from "./types";

export interface KanbanBoardProps<T, S extends string> {
  columns: BoardColumnDef<S>[];
  /** Every item on the board, before grouping. Empty means the empty state. */
  items: T[];
  getId: (item: T) => string;
  getStatus: (item: T) => S;
  /** False freezes a card in place (a cancelled task, a read-only surface). */
  canDrag?: (item: T) => boolean;
  /**
   * Card body. `isOverlay` is the floating copy that follows the pointer
   * during a drag; it must not carry interactive controls.
   */
  renderCard: (item: T, ctx: { isOverlay: boolean }) => ReactNode;
  onOpen: (item: T) => void;
  /**
   * A card was released over a column whose status differs from its own.
   * Same-column drops never reach this. The caller judges permission and
   * writes; the board only arranges.
   */
  onDrop: (item: T, target: S) => void;
  sortItems?: (a: T, b: T) => number;
  /** When set, the board renders one collapsible lane per entry. */
  lanes?: BoardLane<T>[];
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  errorTitle: string;
  errorFallback: string;
  /** Rendered when `items` is empty (and the query did not fail). */
  emptyState: ReactNode;
  /** Rendered when lanes are in use and none of them holds a card. */
  noMatchState?: ReactNode;
  columnAction?: (column: BoardColumnDef<S>) => ReactNode;
  footnote?: ReactNode;
  /**
   * Desktop only, ungrouped layout only. The page has locked its own height to
   * the viewport, so the board stretches into that space and the COLUMNS carry
   * the scroll. Without it the page scrolls and each column caps itself with a
   * `100dvh` guess. Lanes ignore this: they stack vertically and need the page
   * to scroll.
   */
  fillHeight?: boolean;
  className?: string;
}

const CLICK_SUPPRESS_MS = 150;

/**
 * Generic Kanban board: columns are statuses, cards are items, dragging a card
 * to another column asks the caller to write that status.
 *
 * Never mount a detail Sheet or Dialog from inside a card. A card lives in
 * exactly one status column, so a status change unmounts it, and a Radix
 * overlay torn down that way leaves `pointer-events: none` stuck on <body>.
 * The page owns the panel; the board only calls `onOpen`.
 */
export function KanbanBoard<T, S extends string>({
  columns,
  items,
  getId,
  getStatus,
  canDrag,
  renderCard,
  onOpen,
  onDrop,
  sortItems,
  lanes,
  isLoading,
  error,
  onRetry,
  errorTitle,
  errorFallback,
  emptyState,
  noMatchState,
  columnAction,
  footnote,
  fillHeight = false,
  className,
}: KanbanBoardProps<T, S>) {
  // Lanes stack down the page, so they can never be height-locked.
  const fills = fillHeight && !lanes;
  const [activeItem, setActiveItem] = useState<T | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const suppressClickRef = useRef(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const release = useCallback(() => {
    setActiveItem(null);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, CLICK_SUPPRESS_MS);
  }, []);

  const handleDragStart = (event: DragStartEvent) => {
    suppressClickRef.current = true;
    const data = event.active.data.current as BoardDragData<T> | undefined;
    setActiveItem(data?.item ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const data = event.active.data.current as BoardDragData<T> | undefined;
    const over = event.over?.data.current as BoardDropData<S> | undefined;
    release();
    if (!data?.item || !over?.status) return;
    if (getStatus(data.item) === over.status) return;
    onDrop(data.item, over.status);
  };

  const byStatus = useCallback(
    (source: T[], status: S) => {
      const bucket = source.filter((item) => getStatus(item) === status);
      return sortItems ? bucket.sort(sortItems) : bucket;
    },
    [getStatus, sortItems],
  );

  const renderItem = (item: T) => (
    <BoardDraggable
      id={getId(item)}
      item={item}
      disabled={canDrag ? !canDrag(item) : false}
      suppressClickRef={suppressClickRef}
      onOpen={() => onOpen(item)}
    >
      {renderCard(item, { isOverlay: false })}
    </BoardDraggable>
  );

  const ungroupedColumns = useMemo(
    () => columns.map((column) => ({ column, items: byStatus(items, column.status) })),
    [columns, items, byStatus],
  );

  if (isLoading) {
    return (
      <div className={cn("flex gap-3 overflow-x-auto pb-4", className)} aria-busy="true">
        {columns.map((column) => (
          <Skeleton key={column.id} className="h-72 w-[260px] shrink-0 rounded-2xl" />
        ))}
      </div>
    );
  }

  // Error BEFORE empty (CLAUDE.md §6): a failed list must never render as five
  // empty columns.
  if (error) {
    return (
      <EmptyState
        icon={<AlertCircle className="h-7 w-7" />}
        title={errorTitle}
        description={translateError(error, errorFallback).title}
        tone="rose"
        reason="error"
        action={onRetry ? { label: "Try again", onClick: onRetry } : undefined}
        className={className}
      />
    );
  }

  if (items.length === 0) {
    return <div className={className}>{emptyState}</div>;
  }

  // Literal class names only: Tailwind's JIT cannot see an interpolated
  // column count, so the two board widths in use are spelled out. Equal
  // tracks with no minimum, so the grouped layout fits one frame on desktop
  // too; below lg the wrapper enforces a floor and scrolls sideways.
  const gridClass = cn("grid gap-3", columns.length <= 4 ? "grid-cols-4" : "grid-cols-5");

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={columnCollision}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={release}
    >
      <div className={cn(fills && "md:flex md:min-h-0 md:flex-1 md:flex-col", className)}>
        {lanes ? (
          lanes.every((lane) => lane.items.length === 0) ? (
            noMatchState ?? emptyState
          ) : (
            <div className="overflow-x-auto pb-4 lg:-mx-6 xl:-mx-10">
              <div className="min-w-[1000px] space-y-3 lg:min-w-0">
                <div className={cn(gridClass, "px-1")}>
                  {columns.map((column) => (
                    <div key={column.id} className="flex items-center gap-2 px-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-ink-700">
                        {column.label}
                      </span>
                      <span className="rounded-full bg-surface-card px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink-700 shadow-card-sm">
                        {byStatus(items, column.status).length}
                      </span>
                    </div>
                  ))}
                </div>
                {lanes.map((lane) => {
                  const isCollapsed = collapsed.has(lane.key);
                  return (
                    <div key={lane.key} className="space-y-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-expanded={!isCollapsed}
                        onClick={() =>
                          setCollapsed((prev) => {
                            const next = new Set(prev);
                            if (next.has(lane.key)) next.delete(lane.key);
                            else next.add(lane.key);
                            return next;
                          })
                        }
                        className="h-9 gap-2 px-2 text-sm font-medium text-ink-700"
                      >
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 transition-transform",
                            isCollapsed && "-rotate-90",
                          )}
                        />
                        {lane.leading}
                        <span className="truncate">{lane.label}</span>
                        <span className="rounded-full bg-surface-card px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink-700 shadow-card-sm">
                          {lane.items.length}
                        </span>
                      </Button>
                      {!isCollapsed && (
                        <div className={gridClass}>
                          {columns.map((column) => (
                            <BoardColumn
                              key={column.id}
                              droppableId={`${lane.key}::${column.id}`}
                              status={column.status}
                              label={`${lane.label}: ${column.label}`}
                              items={byStatus(lane.items, column.status)}
                              getId={getId}
                              renderItem={renderItem}
                              showHeader={false}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )
        ) : (
          /* Phone: one column per swipe. sm+: every column shares the row
             equally with NO minimum width, so all five always sit in one
             frame; the row also reclaims PageShell's side padding at lg+ so
             the board gets the full page width the header does not need. */
          <div
            className={cn(
              "flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4 sm:gap-2 lg:-mx-6 lg:gap-3 xl:-mx-10",
              fills && "md:min-h-0 md:flex-1",
            )}
          >
            {ungroupedColumns.map(({ column, items: columnItems }) => (
              <BoardColumn
                key={column.id}
                droppableId={column.id}
                status={column.status}
                label={column.label}
                items={columnItems}
                getId={getId}
                renderItem={renderItem}
                scrollBody
                fillHeight={fills}
                action={columnAction?.(column)}
                className="w-[80vw] max-w-[300px] shrink-0 snap-start sm:w-auto sm:min-w-0 sm:max-w-none sm:flex-1"
              />
            ))}
          </div>
        )}
        {footnote && <div className={cn(fills && "md:shrink-0")}>{footnote}</div>}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeItem ? renderCard(activeItem, { isOverlay: true }) : null}
      </DragOverlay>
    </DndContext>
  );
}
