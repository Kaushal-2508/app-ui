import type { ReactNode } from "react";

/** One status column on a Kanban board. `status` is the value a drop writes. */
export interface BoardColumnDef<S extends string> {
  id: string;
  label: string;
  status: S;
}

/** One horizontal lane when a board is grouped (by assignee, type, ...). */
export interface BoardLane<T> {
  key: string;
  label: string;
  /** Rendered before the lane label, e.g. an avatar. */
  leading?: ReactNode;
  items: T[];
}

/** Payload dnd-kit carries on a draggable card. */
export interface BoardDragData<T> {
  item: T;
}

/** Payload dnd-kit carries on a droppable column body. */
export interface BoardDropData<S extends string> {
  status: S;
}
