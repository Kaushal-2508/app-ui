import type { Tone } from "@/components/shared/surfaces";
import { cn } from "@/lib/utils";

// Written out in full so Tailwind keeps every class (index.css "Clay tiles").
export const CLAY_TONE: Record<Tone, string> = {
  teal: "clay-tone-teal",
  violet: "clay-tone-violet",
  peach: "clay-tone-peach",
  mint: "clay-tone-mint",
  sky: "clay-tone-sky",
  rose: "clay-tone-rose",
};

/** Class names for the shadcn Buttons on an action card (`variant="ghost"`; index.css
 *  "Dashboard action cards" restyles them): the white pill for the main action, glass for
 *  the rest. */
const ACTION_BUTTON = "h-8 whitespace-nowrap px-4 text-[13px] lg:h-9 lg:text-sm xl:h-10 xl:px-5";
export const ACTION_PRIMARY = cn("action-primary", ACTION_BUTTON);
export const ACTION_SECONDARY = cn("action-ghost", ACTION_BUTTON);
