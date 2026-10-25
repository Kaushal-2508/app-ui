import * as React from "react";

import { useDash5FilterOptions } from "@/hooks/dashboard/useDash5";

import { useWingLock } from "./useWingLock";

export interface Drill {
  wingId: string | null;
  wingName: string | null;
  classId: string | null;
  classLabel: string | null;
}

/**
 * The wing -> class -> subject drill state, shared by the four cards that use
 * it, so they agree about where the top is.
 *
 * On the admin dashboard the top is "All wings" and the table opens there. On
 * the coordinator console there is exactly one wing, so opening at wing level
 * would show a single row whose only purpose is to be clicked. The reference is
 * explicit about this: "The admin's top level was wings. A coordinator has
 * exactly one, so the table opens one level down and the wing row becomes the
 * footer total."
 *
 * So under a WingLockProvider the drill STARTS inside the wing and cannot climb
 * out of it: the root crumb is the wing's own name, not a link, and "up one
 * level" appears only once you are a level deeper than that.
 */
export function useWingDrill() {
  const locked = useWingLock();
  const opts = useDash5FilterOptions();
  // A coordinator's filter options contain exactly their wing, so this is the
  // name without a second round trip.
  const lockedName = React.useMemo(
    () => (locked ? opts.data?.wings.find((w) => w.id === locked)?.name ?? null : null),
    [locked, opts.data],
  );

  const [drill, setDrill] = React.useState<Drill>(() => ({
    wingId: locked, wingName: null, classId: null, classLabel: null,
  }));

  // The lock is known before its name is: the options query has to land first.
  // Fill the name in when it does, without disturbing a drill already in
  // progress.
  React.useEffect(() => {
    if (!locked || !lockedName) return;
    setDrill((d) => (d.wingId === locked && d.wingName !== lockedName
      ? { ...d, wingName: lockedName } : d));
  }, [locked, lockedName]);

  /** Back to the top this page HAS, which is the wing when one is locked. */
  const reset = React.useCallback(() => {
    setDrill({ wingId: locked, wingName: lockedName, classId: null, classLabel: null });
  }, [locked, lockedName]);

  /** Drop one level, stopping at the wing when one is locked. */
  const up = React.useCallback(() => {
    setDrill((d) => (d.classId
      ? { ...d, classId: null, classLabel: null }
      : { wingId: locked, wingName: lockedName, classId: null, classLabel: null }));
  }, [locked, lockedName]);

  /** False at the top, so the button is not rendered rather than rendered inert. */
  const canGoUp = locked ? !!drill.classId : !!drill.wingId;

  /** The first crumb: "All wings" for a principal, the wing itself otherwise. */
  const rootLabel = locked ? (lockedName ?? "Your wing") : "All wings";

  return { drill, setDrill, reset, up, canGoUp, rootLabel, locked };
}
