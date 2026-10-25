// src/components/syllabus/ChapterReorderHandle.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import { cn } from "@/lib/utils";

const HOLD_MS = 2000;
const MOVE_TOLERANCE = 8;

interface Props {
  chapterName: string;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  setActivatorNodeRef: (el: HTMLElement | null) => void;
}

export function ChapterReorderHandle({ chapterName, attributes, listeners, setActivatorNodeRef }: Props) {
  const [count, setCount] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<{ t: number; x: number; y: number } | null>(null);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startRef.current = null;
    setCount(null);
    setProgress(0);
  }, []);

  const tick = useCallback(
    (now: number) => {
      const s = startRef.current;
      if (!s) return;
      const elapsed = now - s.t;
      const p = Math.min(elapsed / HOLD_MS, 1);
      setProgress(p);
      setCount(Math.max(1, Math.ceil((HOLD_MS - elapsed) / 1000)));
      if (p >= 1) { stop(); return; }
      rafRef.current = requestAnimationFrame(tick);
    },
    [stop],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      (listeners?.onPointerDown as ((event: React.PointerEvent<HTMLButtonElement>) => void) | undefined)?.(e);
      startRef.current = { t: performance.now(), x: e.clientX, y: e.clientY };
      setCount(3);
      setProgress(0);
      rafRef.current = requestAnimationFrame(tick);
    },
    [listeners, tick],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const s = startRef.current;
      if (!s) return;
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE) stop();
    },
    [stop],
  );

  const R = 16;
  const CIRC = 2 * Math.PI * R;

  return (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Hold 2 seconds, then drag to reorder ${chapterName}`}
      className={cn(
        "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
        "bg-muted text-muted-foreground cursor-grab touch-none select-none",
        "transition-colors hover:bg-brand-primary/10 hover:text-brand-primary",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
      )}
    >
      <GripVertical className="h-5 w-5" />
      {count !== null && (
        <span className="absolute inset-0 flex items-center justify-center motion-reduce:hidden">
          <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r={R} fill="none" stroke="hsl(var(--brand-primary))"
              strokeOpacity={0.2} strokeWidth={3} />
            <circle cx="20" cy="20" r={R} fill="none" stroke="hsl(var(--brand-primary))"
              strokeWidth={3} strokeLinecap="round"
              strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - progress)} />
          </svg>
        </span>
      )}
      {count !== null && (
        <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-brand-primary">
          {count}
        </span>
      )}
    </button>
  );
}
