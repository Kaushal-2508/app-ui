import { useEffect, useRef } from "react";
import { logHybridEvent } from "@/hooks/useHybridAttempt";
import { onAppStateChange } from "@/lib/native";
import {
  getFullscreenElement,
  onFullscreenChange,
  isFullscreenSupported,
} from "@/lib/fullscreen";

interface UseHybridIntegrityLoggerArgs {
  enabled: boolean;
  attemptId: string | undefined;
  institutionId: string | undefined;
  studentId: string | undefined;
  /** Fired (in addition to logging) when the student leaves fullscreen or hides the tab. */
  onViolation?: (type: "tab_switch" | "fullscreen_exit") => void;
}

/**
 * Wires three cosmetic integrity signals into hybrid_exam_attempt_logs:
 *   - visibilitychange  (tab hidden / restored)
 *   - fullscreen_exited (left fullscreen)
 *   - paste_attempt     (paste keystroke or paste event)
 *
 * No auto-fail. Phase 1/2 just records.
 */
export function useHybridIntegrityLogger({
  enabled,
  attemptId,
  institutionId,
  studentId,
  onViolation,
}: UseHybridIntegrityLoggerArgs) {
  const onViolationRef = useRef(onViolation);
  onViolationRef.current = onViolation;

  useEffect(() => {
    if (!enabled || !attemptId || !institutionId) return;

    const log = (eventType: string, payload?: Record<string, unknown>) => {
      logHybridEvent({
        attemptId,
        institutionId,
        eventType,
        actorId: studentId,
        payload,
      }).catch(() => {});
    };

    // Via the native adapter so the app shell can substitute the OS app-state
    // event; only the visibility source counts, focus changes are not a
    // tab switch here (same as before, when only visibilitychange was bound).
    const offAppState = onAppStateChange((active, source) => {
      if (source === "focus") return;
      log("visibility_change", {
        hidden: !active,
        visibilityState: document.visibilityState,
      });
      if (!active) onViolationRef.current?.("tab_switch");
    });

    const offFullscreen = isFullscreenSupported()
      ? onFullscreenChange(() => {
          if (!getFullscreenElement()) {
            log("fullscreen_exited");
            onViolationRef.current?.("fullscreen_exit");
          }
        })
      : () => {};

    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      log("paste_attempt", { target: (e.target as HTMLElement)?.tagName });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        log("paste_keystroke_blocked");
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      log("right_click_blocked");
    };

    document.addEventListener("paste", onPaste, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("contextmenu", onContextMenu, true);

    return () => {
      offAppState();
      document.removeEventListener("paste", onPaste, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      offFullscreen();
    };
  }, [enabled, attemptId, institutionId, studentId]);
}
