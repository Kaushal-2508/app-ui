import { useCallback, useEffect, useRef, useState } from "react";
import {
  insertAtCursor,
  insertLatexAtCursor,
  isEligibleEditable,
  type EditableEl,
} from "./insert-at-cursor";
import { symbolToLatex } from "./symbol-latex";
import { SymbolPickerPopover } from "./SymbolPickerPopover";
import { useRecordSymbolUsage } from "@/hooks/useSymbolUsage";

const HOLD_THRESHOLD_MS = 400;
export const SYMBOL_PICKER_OPEN_EVENT = "salci:symbol-picker-open";

/**
 * Mounts a window-level keyboard listener that opens a math/symbol picker
 * when the user holds the Space bar inside an editable input/textarea.
 *
 * Hold logic:
 *  - keydown(Space) on an eligible target → start a 400 ms timer; suppress
 *    the actual space character so it doesn't pollute the input while we
 *    wait to see if it's a hold.
 *  - keyup before the timer fires → it was a quick tap; clear the timer
 *    and insert a single space at the caret manually.
 *  - timer fires → it was a hold; open the picker positioned near the
 *    input. No space is inserted.
 *
 * Inputs can opt out via `data-no-symbol-picker="true"`. Password / number /
 * other special input types are excluded by default in `isEligibleEditable`.
 */
export function SymbolPickerProvider() {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<EditableEl | null>(null);
  const recordSymbolUsage = useRecordSymbolUsage();

  const openRef = useRef(open);
  const holdTimer = useRef<number | null>(null);
  const pendingSpaceRef = useRef<EditableEl | null>(null);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    const isSpace = (e: KeyboardEvent) =>
      e.key === " " || e.code === "Space";

    const clearHold = () => {
      if (holdTimer.current !== null) {
        window.clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
      pendingSpaceRef.current = null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isSpace(e)) return;
      if (openRef.current) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!isEligibleEditable(e.target)) return;

      // Suppress the native space insertion while the hold timer runs.
      e.preventDefault();

      // Repeated keydowns from holding the key — already armed.
      if (e.repeat) return;

      const editable = e.target;
      pendingSpaceRef.current = editable;

      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null;
        pendingSpaceRef.current = null;
        setTarget(editable);
        setOpen(true);
      }, HOLD_THRESHOLD_MS);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!isSpace(e)) return;
      const wasPendingFor = pendingSpaceRef.current;
      const wasHolding = holdTimer.current !== null;
      clearHold();
      if (wasHolding && wasPendingFor) {
        // Quick tap — restore the suppressed space.
        insertAtCursor(wasPendingFor, " ");
      }
    };

    // Window-level focus changes shouldn't strand the timer.
    const onBlur = () => clearHold();

    // Imperative open trigger for taps on the MathSymbolHint button (mobile
    // soft keyboards don't reliably fire keydown for space, and iOS hijacks
    // long-press on space for cursor-move; the hint button is the
    // mobile-friendly fallback).
    const onOpenRequest = (e: Event) => {
      const ce = e as CustomEvent<{ target?: HTMLElement | null }>;
      const requested = ce.detail?.target;
      if (!requested || !isEligibleEditable(requested)) return;
      try {
        requested.focus();
      } catch {
        /* noop */
      }
      setTarget(requested);
      setOpen(true);
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener(SYMBOL_PICKER_OPEN_EVENT, onOpenRequest);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener(SYMBOL_PICKER_OPEN_EVENT, onOpenRequest);
      clearHold();
    };
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    if (target) {
      requestAnimationFrame(() => {
        try {
          target.focus();
        } catch {
          /* noop */
        }
      });
    }
  }, [target]);

  const handleInsert = useCallback(
    (symbol: string) => {
      if (!target) return;
      try {
        target.focus();
      } catch {
        /* noop */
      }
      // Fields that explicitly opt in (the equation builder) receive LaTeX so
      // the glyph renders as real math; everywhere else inserts the raw glyph.
      const latex =
        target.dataset.mathInput === "true" ? symbolToLatex(symbol) : undefined;
      if (latex !== undefined) {
        insertLatexAtCursor(target, latex);
      } else {
        insertAtCursor(target, symbol);
      }
      // Fire-and-forget telemetry. The RPC is teacher-only at the DB layer
      // and swallows its own errors, so this never blocks insertion.
      recordSymbolUsage(symbol);
    },
    [target, recordSymbolUsage]
  );

  return (
    <SymbolPickerPopover
      open={open}
      onClose={handleClose}
      target={target}
      onInsert={handleInsert}
    />
  );
}
