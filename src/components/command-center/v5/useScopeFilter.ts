import * as React from "react";

import { useDash5FilterOptions } from "@/hooks/dashboard/useDash5";

import { useWingLock } from "./useWingLock";

/**
 * A wing picker and a class picker that belong together: choosing a wing narrows
 * the classes to that wing, and clearing the wing widens them again. Selecting a
 * wing also drops a class that is no longer inside it, so the two can never
 * describe a scope that has nothing in it.
 *
 * Under a WingLockProvider (the coordinator console) the wing is fixed: `wingId`
 * is always the locked wing, `chooseWing` is inert, and `wingLocked` tells the
 * card not to draw a picker whose only two options mean the same thing. The
 * class picker still works, because a coordinator narrows within their wing.
 */
export function useScopeFilter() {
  const locked = useWingLock();
  const opts = useDash5FilterOptions();
  const [ownWing, setOwnWing] = React.useState<string | null>(null);
  const [classId, setClassId] = React.useState<string | null>(null);

  const wingId = locked ?? ownWing;

  const wingOptions = React.useMemo(
    () => (opts.data?.wings ?? []).map((w) => ({ value: w.id, label: w.name })),
    [opts.data],
  );

  const classOptions = React.useMemo(
    () => (opts.data?.classes ?? [])
      .filter((c) => !wingId || c.wing_id === wingId)
      .map((c) => ({ value: c.id, label: c.label })),
    [opts.data, wingId],
  );

  const subjectOptions = React.useMemo(
    () => (opts.data?.subjects ?? []).map((s) => ({ value: s.id, label: s.name })),
    [opts.data],
  );

  const chooseWing = React.useCallback((id: string | null) => {
    // Inert while locked. A card that still renders a picker (none do) would
    // otherwise be able to unpin itself from the page's wing.
    if (locked) return;
    setOwnWing(id);
    setClassId((current) => {
      if (!current || !id) return current;
      const cls = opts.data?.classes.find((c) => c.id === current);
      return cls && cls.wing_id === id ? current : null;
    });
  }, [locked, opts.data]);

  return {
    wingId,
    wingLocked: locked !== null,
    classId,
    setClassId,
    chooseWing,
    wingOptions,
    classOptions,
    subjectOptions,
  };
}
