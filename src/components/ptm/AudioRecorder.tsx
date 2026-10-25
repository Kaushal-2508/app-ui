import { useEffect, useRef, useState, type ReactNode } from "react";
import { AudioLines, Mic, MicOff, RotateCcw, Square, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { TONES, type Tone } from "@/components/shared/design-system";
import { AudioPlayer } from "./AudioPlayer";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/toast";
import {
  PTM_AUDIO_MAX_BYTES,
  PTM_AUDIO_MAX_SECONDS,
  formatDuration,
} from "@/lib/ptm";
import type { PTMAudioDraft } from "@/hooks/ptm";

interface Props {
  /** The new recording, not yet uploaded. */
  value: PTMAudioDraft | null;
  onChange: (next: PTMAudioDraft | null) => void;
  /** An already-saved recording, shown until the family removes or replaces it. */
  existingPath: string | null;
  existingDurationSeconds?: number | null;
  onRemoveExisting: () => void;
  disabled?: boolean;
  /** Told when recording starts and stops, so the form can hold its submit
   *  until the note in progress is finished. */
  onRecordingChange?: (recording: boolean) => void;
}

/** The last stretch before the cap, when the timer turns to a warning. */
const CAP_WARNING_SECONDS = 15;

function IconDisc({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
        TONES[tone].bg,
        TONES[tone].fg,
      )}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

/** In order of preference; the first the browser can record wins. Safari on
 *  iPhone only offers audio/mp4. */
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  // Let the browser choose; the blob's own type is read back on stop.
  return "";
}

function recordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

/**
 * Record a voice note in the browser. Duration comes from our own timer,
 * because Safari's mp4 blobs often report none. Stops itself at the cap,
 * refuses a blob over the size limit, and releases the microphone the
 * moment recording stops or the component unmounts.
 */
export function AudioRecorder({
  value,
  onChange,
  existingPath,
  existingDurationSeconds,
  onRemoveExisting,
  disabled,
  onRecordingChange,
}: Props) {
  const [supported] = useState(recordingSupported);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  // One start at a time: a double tap during the async getUserMedia gap would
  // open two streams and leak the first, which nothing would ever stop.
  const busyRef = useRef(false);
  // The sheet can close while the permission prompt is still up.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const releaseMic = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // The preview URL follows the draft: revoke the old one when it changes.
  useEffect(() => {
    if (!value) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(value.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  // Unmount mid-recording (the sheet closed): drop the handler first so the
  // stop does not hand a draft to a form that is going away, then free the mic.
  useEffect(() => {
    const recorderBox = recorderRef;
    const streamBox = streamRef;
    const timerBox = timerRef;
    return () => {
      const recorder = recorderBox.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      streamBox.current?.getTracks().forEach((t) => t.stop());
      if (timerBox.current !== null) window.clearInterval(timerBox.current);
    };
  }, []);

  const start = async () => {
    if (!supported || disabled || busyRef.current) return;
    busyRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        busyRef.current = false;
        const seconds = Math.round((Date.now() - startedAtRef.current) / 1000);
        const type = recorder.mimeType || chunksRef.current[0]?.type || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        releaseMic();
        setRecording(false);
        if (blob.size === 0 || seconds < 1) {
          toastError(new Error("Nothing was recorded"), {
            fallback: "Nothing was recorded. Try again and speak for at least a second.",
            context: "ptmAudioRecord",
          });
          return;
        }
        if (blob.size > PTM_AUDIO_MAX_BYTES) {
          toastError(new Error("Recording too large"), {
            fallback: "That recording is too large. Keep it under two minutes.",
            context: "ptmAudioRecord",
          });
          return;
        }
        onChange({ blob, mimeType: type, durationSeconds: Math.min(seconds, PTM_AUDIO_MAX_SECONDS) });
      };

      startedAtRef.current = Date.now();
      setElapsed(0);
      recorder.start();
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        const seconds = Math.round((Date.now() - startedAtRef.current) / 1000);
        setElapsed(seconds);
        if (seconds >= PTM_AUDIO_MAX_SECONDS && recorder.state === "recording") {
          recorder.stop();
        }
      }, 250);
    } catch (e) {
      busyRef.current = false;
      releaseMic();
      toastError(e, {
        fallback: "Couldn't use the microphone. Check the browser's permission for this site.",
        context: "ptmAudioRecord",
      });
    }
  };

  const stop = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") recorder.stop();
  };

  useEffect(() => {
    onRecordingChange?.(recording);
  }, [recording, onRecordingChange]);

  if (!supported) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-surface-stroke bg-muted/40 p-3 text-sm text-ink-600">
        <MicOff className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" aria-hidden="true" />
        <p>Voice notes don't work in this browser. You can still write a message.</p>
      </div>
    );
  }

  if (recording) {
    const left = PTM_AUDIO_MAX_SECONDS - elapsed;
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-3">
        <IconDisc tone="rose">
          <span className="absolute inset-0 animate-pulse rounded-full bg-destructive/15 motion-reduce:animate-none" />
          <Mic className="relative h-5 w-5" />
        </IconDisc>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            {/* Announced once; the timer itself is not live, or a screen
                reader would read it four times a second. */}
            <p className="text-sm font-semibold text-ink-900" role="status">
              Recording
            </p>
            <p
              className={cn(
                "text-xs tabular-nums",
                left <= CAP_WARNING_SECONDS ? "font-semibold text-signal-warn" : "text-ink-600",
              )}
            >
              {formatDuration(elapsed)} / {formatDuration(PTM_AUDIO_MAX_SECONDS)}
            </p>
          </div>
          <Progress
            value={Math.min(100, (elapsed / PTM_AUDIO_MAX_SECONDS) * 100)}
            aria-label="Recording time used"
            className="h-1 bg-destructive/15 [&>div]:bg-destructive"
          />
        </div>
        <Button type="button" size="sm" variant="outline" onClick={stop} className="shrink-0 rounded-full px-3">
          <Square className="fill-current" aria-hidden="true" />
          Stop
        </Button>
      </div>
    );
  }

  if (value && previewUrl) {
    return (
      <div className="space-y-3 rounded-2xl border border-surface-stroke bg-muted/40 p-3">
        <div className="flex items-center gap-3">
          <IconDisc tone="teal">
            <AudioLines className="h-5 w-5" />
          </IconDisc>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900">Voice note ready</p>
            <p className="text-xs text-ink-500">
              {formatDuration(value.durationSeconds)} · sends with your feedback
            </p>
          </div>
        </div>
        {/* The native controls follow color-scheme, so they flip with the theme. */}
        <audio controls src={previewUrl} className="h-10 w-full dark:[color-scheme:dark]" />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={start} disabled={disabled}>
            <RotateCcw aria-hidden="true" />
            Record again
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 aria-hidden="true" />
            Remove
          </Button>
        </div>
      </div>
    );
  }

  if (existingPath) {
    return (
      <div className="space-y-3 rounded-2xl border border-surface-stroke bg-muted/40 p-3">
        <div className="flex items-center gap-3">
          <IconDisc tone="teal">
            <AudioLines className="h-5 w-5" />
          </IconDisc>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900">Your saved voice note</p>
            <p className="text-xs text-ink-500">Stays with your feedback unless you replace it.</p>
          </div>
        </div>
        <AudioPlayer
          path={existingPath}
          durationSeconds={existingDurationSeconds}
          label="Play"
          className="h-10 w-full bg-transparent dark:[color-scheme:dark]"
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={start} disabled={disabled}>
            <Mic aria-hidden="true" />
            Record a new one
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onRemoveExisting}
            disabled={disabled}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 aria-hidden="true" />
            Remove
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={start}
      disabled={disabled}
      // The base Button forces 16px icons; the mic sits in a 40px disc.
      className="h-auto w-full justify-start gap-3 whitespace-normal rounded-2xl border-dashed border-ink-400/50 bg-transparent p-3 text-left hover:border-brand-primary/60 hover:bg-brand-primary/5 [&_svg]:size-5"
    >
      <IconDisc tone="teal">
        <Mic className="h-5 w-5" />
      </IconDisc>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink-900">Record a voice note</span>
        <span className="block text-xs font-normal text-ink-500">
          Prefer to talk? Say it in your own words, up to two minutes.
        </span>
      </span>
    </Button>
  );
}
