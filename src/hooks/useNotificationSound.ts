import { useCallback, useRef } from "react";

// notice_urgent is the row publish_notice writes for a priority='urgent'
// notice; ordinary notices arrive as notice_published and get the soft beep.
const URGENT_TYPES = ["task_overdue", "task_escalation", "proctoring_alert", "notice_urgent"];

export function useNotificationSound() {
  const audioCtxRef = useRef<AudioContext | null>(null);

  const getContext = useCallback(async () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    return ctx;
  }, []);

  const playSound = useCallback(async () => {
    try {
      const ctx = await getContext();
      const now = ctx.currentTime;
      
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.frequency.value = 880;
      gain1.gain.setValueAtTime(0.3, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.15);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.frequency.value = 1100;
      gain2.gain.setValueAtTime(0.3, now + 0.18);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.18);
      osc2.stop(now + 0.35);
    } catch (e) {
      console.warn("Failed to play notification sound:", e);
    }
  }, [getContext]);

  const vibrate = useCallback(() => {
    try {
      if ("vibrate" in navigator) {
        navigator.vibrate([200, 100, 200]);
      }
    } catch (e) {
      // Vibration not supported
    }
  }, []);

  const alertForNotification = useCallback(
    (type: string, soundEnabled: boolean) => {
      if (!soundEnabled) return;
      
      if (URGENT_TYPES.includes(type)) {
        playSound();
        vibrate();
      } else {
        // Softer single beep for non-urgent
        (async () => {
          try {
            const ctx = await getContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = 660;
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.12);
          } catch (e) {
            // ignore
          }
        })();
      }
    },
    [playSound, vibrate, getContext]
  );

  return { alertForNotification, playSound, vibrate };
}
