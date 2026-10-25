import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";

/**
 * Browser speech-to-text (Web Speech API) for dictating into a text field.
 *
 * A web page CANNOT trigger the OS dictation (the phone keyboard's mic button
 * or Windows+H) — there is no API for it. This hook uses the browser's own
 * recognition engine, which on Android Chrome and iOS Safari is backed by the
 * same service the keyboard mic uses, so the result is equivalent.
 *
 * PRIVACY: Chrome streams the captured audio to a Google speech service (Safari
 * to Apple's) — that is inherent to the platform, not something SALCI adds. We
 * never record, upload or store audio ourselves. Surface this to the user.
 *
 * The caller owns the text. This hook only emits:
 *   onFinalSegment(text) — a phrase the engine has committed. Append it. Fires
 *                          exactly once per phrase, even if the browser
 *                          re-delivers it (see `committedRef`).
 *   onInterim(text)      — the live, not-yet-final words. REPLACE the preview
 *                          with this; never append. Empty string clears it.
 */

// ── Types ───────────────────────────────────────────────────────────────────
// TypeScript 5.8's lib.dom.d.ts ships only PART of this API: it has
// SpeechRecognitionResultList / SpeechRecognitionResult / *Alternative, but NOT
// SpeechRecognition, SpeechRecognitionEvent or SpeechRecognitionErrorEvent.
// Declare only the missing three — redeclaring the others is a compile error
// ("all declarations must have identical modifiers"). These stay module-local
// rather than in a .d.ts because tsconfig sets skipLibCheck, which would leave
// a .d.ts silently unchecked.

type SpeechErrorCode =
  | "aborted"
  | "audio-capture"
  | "bad-grammar"
  | "language-not-supported"
  | "network"
  | "no-speech"
  | "not-allowed"
  | "service-not-allowed";

interface SpeechRecognitionResultEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionFailureEvent extends Event {
  readonly error: SpeechErrorCode;
  readonly message: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionFailureEvent) => void) | null;
  onend: ((event: Event) => void) | null;
  onstart: ((event: Event) => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

type SpeechCapableWindow = Window &
  typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as SpeechCapableWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Safari ignores `continuous`; it also needs the prefixed constructor. */
function isAppleWebKit(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isAppleDevice = /iPad|iPhone|iPod/.test(ua) || /Macintosh/.test(ua);
  return isAppleDevice && /Safari/.test(ua) && !/Chrome|CriOS|Chromium|Edg/.test(ua);
}

/**
 * The mic is an exclusive resource and this UI renders a button per question.
 * A module-level registry guarantees that starting one session tears down any
 * other — component refs cannot see each other.
 *
 * Keyed by a stable per-hook token so a hook can only ever clear ITS OWN
 * registration: comparing functions would fail once a re-render produced a new
 * `finish`, letting a stale teardown deregister whichever field is now live.
 */
let activeSession: { token: object; release: () => void } | null = null;

// Restart guards. Chrome ends a session on ~8s of silence and caps it around
// 60s even with continuous=true, so sustained dictation REQUIRES restarting.
// These bounds stop that from becoming a runaway mic.
const RESTART_DELAY_MS = 250;
const MAX_RESTARTS = 20;
/** Two consecutive sessions that heard nothing = the user walked away. */
const MAX_SILENT_SESSIONS = 2;

const FRIENDLY_ERROR: Partial<Record<SpeechErrorCode, string>> = {
  "not-allowed":
    "Microphone access is blocked. Allow it in your browser settings to dictate.",
  "service-not-allowed":
    "Microphone access is blocked. Allow it in your browser settings to dictate.",
  "audio-capture": "No microphone was found on this device.",
  network: "Voice typing needs an internet connection.",
  "language-not-supported": "Voice typing is not available for this language.",
};

export interface UseSpeechDictationOptions {
  /** BCP-47 tag. Defaults to Indian English. */
  lang?: string;
  onFinalSegment: (segment: string) => void;
  onInterim: (text: string) => void;
}

export interface UseSpeechDictation {
  /** False on Firefox, insecure origins, and iOS standalone PWAs. */
  isSupported: boolean;
  isListening: boolean;
  start: () => void;
  /** Graceful: flushes the phrase in flight. */
  stop: () => void;
  toggle: () => void;
}

export function useSpeechDictation({
  lang = "en-IN",
  onFinalSegment,
  onInterim,
}: UseSpeechDictationOptions): UseSpeechDictation {
  const [isListening, setIsListening] = useState(false);

  // Handlers are attached once per recognition instance, so they would close
  // over the first render's props forever. Mirror them into refs.
  const onFinalRef = useRef(onFinalSegment);
  onFinalRef.current = onFinalSegment;
  const onInterimRef = useRef(onInterim);
  onInterimRef.current = onInterim;

  /** Stable identity for this hook instance in the module-level registry. */
  const sessionTokenRef = useRef<object>({});
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  /** The user still wants to dictate — drives the restart-on-end loop. */
  const wantsToListenRef = useRef(false);
  const disposedRef = useRef(false);
  /** Result indices already emitted as final, for THIS session only. */
  const committedRef = useRef<Set<number>>(new Set());
  const restartCountRef = useRef(0);
  const silentSessionsRef = useRef(0);
  const heardSomethingRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Escalation timer: force-finish if a stop() never produces an onend. */
  const stopWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isSupported] = useState(() => {
    if (getRecognitionCtor() === null) return false;
    // The API silently no-ops on http:// origins.
    if (typeof window !== "undefined" && !window.isSecureContext) return false;
    // Recognition is broken inside an iOS home-screen (standalone) web app.
    if (
      isAppleWebKit() &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(display-mode: standalone)").matches
    ) {
      return false;
    }
    return true;
  });

  /** Detach handlers BEFORE aborting, or `onend` resurrects the session. */
  const teardown = useCallback((instance: SpeechRecognitionInstance | null) => {
    if (!instance) return;
    instance.onresult = null;
    instance.onerror = null;
    instance.onend = null;
    instance.onstart = null;
    try {
      // abort(), not stop(): stop() flushes one last result, which would land
      // after unmount and write into a field the teacher already left.
      instance.abort();
    } catch {
      // Already dead — nothing to do.
    }
  }, []);

  const finish = useCallback(() => {
    wantsToListenRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (stopWatchdogRef.current) {
      clearTimeout(stopWatchdogRef.current);
      stopWatchdogRef.current = null;
    }
    const instance = recognitionRef.current;
    recognitionRef.current = null;
    teardown(instance);
    committedRef.current.clear();
    onInterimRef.current("");
    if (!disposedRef.current) setIsListening(false);
    if (activeSession?.token === sessionTokenRef.current) activeSession = null;
  }, [teardown]);

  const beginSession = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = lang;
    // Safari ignores this and ends early anyway; the restart loop covers it.
    recognition.continuous = !isAppleWebKit();
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    committedRef.current.clear();
    heardSomethingRef.current = false;

    recognition.onresult = (event) => {
      if (disposedRef.current) return;
      heardSomethingRef.current = true;

      let interim = "";
      // Iterate the whole list rather than from event.resultIndex: WebKit is
      // inconsistent about resultIndex, and the committed-set makes re-reading
      // free. Never use `+=` on the field — that is what duplicates text.
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (!transcript) continue;

        if (result.isFinal) {
          if (!committedRef.current.has(i)) {
            committedRef.current.add(i);
            const cleaned = transcript.trim();
            if (cleaned) onFinalRef.current(cleaned);
          }
        } else {
          interim += transcript;
        }
      }
      onInterimRef.current(interim.trim());
    };

    recognition.onerror = (event) => {
      if (disposedRef.current) return;
      const code = event.error;
      // Our own teardown produces this; restarting would undo the teardown.
      if (code === "aborted") return;
      // Normal when the teacher pauses — onend decides whether to continue.
      if (code === "no-speech") return;

      const message = FRIENDLY_ERROR[code];
      if (message) {
        // Permission/hardware problems are terminal: never restart into them,
        // or the permission prompt loops until the tab is killed.
        wantsToListenRef.current = false;
        toastError(new Error(message), {
          fallback: message,
          context: "speechDictation",
        });
      }
    };

    recognition.onend = () => {
      if (disposedRef.current) return;

      // A new session restarts result indices at 0 — the old set must go or
      // every new phrase looks "already committed" and is silently dropped.
      committedRef.current.clear();
      onInterimRef.current("");

      silentSessionsRef.current = heardSomethingRef.current
        ? 0
        : silentSessionsRef.current + 1;

      const mayRestart =
        wantsToListenRef.current &&
        restartCountRef.current < MAX_RESTARTS &&
        silentSessionsRef.current < MAX_SILENT_SESSIONS;

      if (mayRestart) {
        restartCountRef.current += 1;
        // This instance is dead. Drop it NOW: during the restart gap `stop()`
        // would otherwise call .stop() on a spent recognizer, which is a silent
        // no-op that never fires onend, stranding the UI in "Listening".
        recognitionRef.current = null;
        restartTimerRef.current = setTimeout(() => {
          restartTimerRef.current = null;
          if (disposedRef.current || !wantsToListenRef.current) return;
          try {
            beginSession();
          } catch {
            finish();
          }
        }, RESTART_DELAY_MS);
        return;
      }

      // True when the engine gave up on its own (silence or restart budget)
      // rather than the teacher tapping stop. finish() clears the flag, so
      // read it first.
      const endedWithoutUserAction = wantsToListenRef.current;
      finish();
      if (endedWithoutUserAction) {
        // Otherwise this is indistinguishable from a deliberate stop, and the
        // teacher keeps talking to a mic that is already off.
        toast("Voice typing stopped. Tap the mic to continue.");
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      if (!disposedRef.current) setIsListening(true);
    } catch {
      // start() on an already-running instance throws synchronously.
      teardown(recognition);
      finish();
    }
  }, [lang, teardown, finish]);

  const start = useCallback(() => {
    if (!isSupported || disposedRef.current) return;
    if (wantsToListenRef.current) return;

    // Only one mic across the whole page.
    if (activeSession && activeSession.token !== sessionTokenRef.current) {
      activeSession.release();
    }

    wantsToListenRef.current = true;
    restartCountRef.current = 0;
    silentSessionsRef.current = 0;
    activeSession = { token: sessionTokenRef.current, release: finish };
    beginSession();
  }, [isSupported, beginSession, finish]);

  const stop = useCallback(() => {
    wantsToListenRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    const instance = recognitionRef.current;
    if (!instance) {
      finish();
      return;
    }
    try {
      // stop() (not abort()) so the phrase in flight still lands — aborting
      // here reads to the user as "it ate my last words".
      instance.stop();
      // Safety net: if the engine swallows the stop and never fires onend,
      // release the UI anyway rather than leaving a permanent "Listening".
      if (stopWatchdogRef.current) clearTimeout(stopWatchdogRef.current);
      stopWatchdogRef.current = setTimeout(() => {
        stopWatchdogRef.current = null;
        if (!disposedRef.current) finish();
      }, 1500);
    } catch {
      finish();
    }
  }, [finish]);

  const toggle = useCallback(() => {
    if (wantsToListenRef.current) stop();
    else start();
  }, [start, stop]);

  useEffect(() => {
    disposedRef.current = false;
    // Captured at setup: the token is created once and never reassigned, but
    // reading a ref inside cleanup is flagged by react-hooks/exhaustive-deps.
    const token = sessionTokenRef.current;
    return () => {
      // Flags first, then detach, then abort — any other order lets onend
      // restart a session that outlives the component and holds the mic.
      disposedRef.current = true;
      wantsToListenRef.current = false;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (stopWatchdogRef.current) clearTimeout(stopWatchdogRef.current);
      const instance = recognitionRef.current;
      recognitionRef.current = null;
      teardown(instance);
      if (activeSession?.token === token) activeSession = null;
    };
  }, [teardown]);

  return { isSupported, isListening, start, stop, toggle };
}
