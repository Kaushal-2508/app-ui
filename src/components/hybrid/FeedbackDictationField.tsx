import { useCallback, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useSpeechDictation } from "@/hooks/useSpeechDictation";
import { cn } from "@/lib/utils";

/**
 * Per-question teacher feedback with voice typing.
 *
 * Owns the live interim transcript in LOCAL state so that dictation (which
 * fires several times a second) re-renders only this field, never the whole
 * question list and paper viewer behind it. Only committed phrases are pushed
 * up through `onChange`, which the page then autosaves on its existing debounce.
 */

interface FeedbackDictationFieldProps {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
}

/** Join two fragments with exactly one space, never gluing words together. */
function appendPhrase(existing: string, phrase: string): string {
  if (!phrase) return existing;
  if (!existing) return phrase;
  return /\s$/.test(existing) ? existing + phrase : `${existing} ${phrase}`;
}

export function FeedbackDictationField({
  id,
  value,
  onChange,
  disabled = false,
  placeholder,
  rows = 3,
}: FeedbackDictationFieldProps) {
  const [interim, setInterim] = useState("");

  // The recognition callbacks are attached once, so they must not close over
  // a render-time `value`.
  const valueRef = useRef(value);
  valueRef.current = value;

  const handleFinalSegment = useCallback(
    (segment: string) => {
      const next = appendPhrase(valueRef.current, segment);
      valueRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  const { isSupported, isListening, toggle } = useSpeechDictation({
    onFinalSegment: handleFinalSegment,
    onInterim: setInterim,
  });

  // Interim words are a preview only: shown appended, never written upward.
  const displayValue = interim ? appendPhrase(value, interim) : value;

  const showMic = isSupported && !disabled;

  return (
    // main.tsx suppresses the service-worker auto-reload only for
    // form[data-dirty="true"], so a deploy landing mid-sentence cannot discard
    // what the teacher is dictating.
    <form
      data-dirty={isListening ? "true" : undefined}
      onSubmit={(e) => e.preventDefault()}
    >
      <div className="mt-4 flex items-center justify-between gap-2">
        <label
          htmlFor={id}
          className="block text-sm font-semibold text-foreground"
        >
          Feedback{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>

        {showMic && (
          <button
            type="button"
            onClick={toggle}
            aria-pressed={isListening}
            aria-label={
              isListening ? "Stop voice typing" : "Start voice typing"
            }
            title={
              isListening
                ? "Listening. Tap to stop."
                : "Voice typing. Your browser's speech service converts what you say into text."
            }
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
              isListening
                ? "border-destructive bg-destructive/10 text-destructive"
                : "border-border bg-card text-brand-primary hover:border-brand-primary/50",
            )}
          >
            {isListening ? (
              <>
                <Square className="h-3.5 w-3.5 fill-current" />
                <span className="sr-only">Listening</span>
              </>
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      <Textarea
        id={id}
        value={displayValue}
        onChange={(e) => {
          // Typing while the mic is live: the typed text wins, and the next
          // committed phrase appends to it (valueRef is the anchor).
          setInterim("");
          valueRef.current = e.target.value;
          onChange(e.target.value);
        }}
        rows={rows}
        disabled={disabled}
        className="mt-1.5"
        placeholder={placeholder}
      />

      {isListening && (
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-destructive"
          />
          Listening. Tap to stop. Your browser's speech service processes the
          audio; SALCI does not store it.
        </p>
      )}
    </form>
  );
}