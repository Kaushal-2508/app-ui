import type { KeyboardEvent, MutableRefObject, ReactNode } from "react";
import { useDraggable } from "@dnd-kit/core";

import { cn } from "@/lib/utils";
import type { BoardDragData } from "./types";

interface BoardDraggableProps<T> {
  id: string;
  item: T;
  disabled: boolean;
  /**
   * Set by the board for the duration of a drag plus a short tail, because the
   * browser fires a click right after a drop and that click must not open the
   * detail panel.
   */
  suppressClickRef: MutableRefObject<boolean>;
  onOpen: () => void;
  children: ReactNode;
}

/**
 * The draggable shell around a card. Purely mechanical: dnd-kit wiring and
 * the click-vs-drag disambiguation. Card content is supplied by the caller;
 * the moving copy is the board's DragOverlay, not this element.
 */
export function BoardDraggable<T>({
  id,
  item,
  disabled,
  suppressClickRef,
  onOpen,
  children,
}: BoardDraggableProps<T>) {
  const data: BoardDragData<T> = { item };
  // No `transform` here on purpose. The board renders the moving copy in a
  // DragOverlay, so the source card must stay put as a faded placeholder.
  // Translating it as well pushed it out of its column, which widened the
  // column's scroll box, and dnd-kit's auto-scroller then scrolled that box
  // sideways: every other card in the column slid left and clipped, leaving
  // only the avatars visible (reproduced on the Done column, 2026-09-16).
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data,
    disabled,
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  };

  // A frozen card is still a button that opens the item. dnd-kit's disabled
  // attributes mark it aria-disabled, which assistive tech (and Playwright)
  // read as "cannot be activated", so a read-only card wires its own role.
  const a11y = disabled
    ? { role: "button", tabIndex: 0 }
    : { ...attributes, ...listeners };

  return (
    <div
      ref={setNodeRef}
      {...a11y}
      className={cn(
        "touch-manipulation rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
      onClick={() => {
        if (suppressClickRef.current) return;
        onOpen();
      }}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
}
