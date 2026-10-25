import { useId } from "react";
import { Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { openExternal } from "@/lib/native";
import { toastInfo } from "@/lib/toast";
import { joinButtonState } from "@/lib/ptm";
import { cn } from "@/lib/utils";

interface Props {
  meetUri: string | null;
  slotStart: Date;
  slotEnd: Date;
  bufferMinutes: number;
  /** From useNow(), so the button flips live without a reload. */
  now: Date;
  /** Changes only the words: the family hears "Your turn at", the teacher
   *  sees the slot time and "Done". Default `family`. */
  role?: "family" | "teacher";
  size?: "sm" | "default";
  className?: string;
}

/**
 * The Join button of one booked online slot, for the family and the teacher
 * alike. One Meet room per slot (Google Meet caps a call at an hour, so the
 * teacher moves to the next room when one is done). Every room reads "On
 * hold" except the one whose turn it is: enabled from two minutes before the
 * slot until it ends plus the gap; otherwise disabled with the reason under
 * it (phones have no hover tooltips). Opens through openExternal, which inside
 * the app uses the system browser sheet instead of navigating the WebView away.
 */
export function JoinMeetButton({
  meetUri,
  slotStart,
  slotEnd,
  bufferMinutes,
  now,
  role = "family",
  size = "default",
  className,
}: Props) {
  const reasonId = useId();
  const state = joinButtonState({ slotStart, slotEnd, bufferMinutes, meetUri, now, role });

  const join = () => {
    if (!meetUri) return;
    if (!openExternal(meetUri)) toastInfo("Allow pop-ups for this site to join the meeting.");
  };

  return (
    <div className={cn("flex flex-col items-start gap-1", className)}>
      <Button
        type="button"
        size={size}
        variant={state.enabled ? "default" : "outline"}
        disabled={!state.enabled}
        onClick={join}
        aria-describedby={state.reason ? reasonId : undefined}
        className={cn(size === "sm" ? "h-8 text-xs" : "w-full sm:w-auto")}
      >
        <Video className={cn("mr-1.5", size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden="true" />
        {state.label}
      </Button>
      {state.reason && (
        <span id={reasonId} className="text-xs text-ink-500">
          {state.reason}
        </span>
      )}
    </div>
  );
}
