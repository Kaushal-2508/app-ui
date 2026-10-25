import * as React from "react";

/**
 * The wing every v5 card on the page is pinned to, or null when the page spans
 * the whole school.
 *
 * Split from WingLock.tsx so neither module mixes a component with a hook: Fast
 * Refresh drops the state of every card in a file that exports both, which is
 * the same reason useChartTip sits apart from ChartTip.
 */
export const WingLockContext = React.createContext<string | null>(null);

export function useWingLock(): string | null {
  return React.useContext(WingLockContext);
}
