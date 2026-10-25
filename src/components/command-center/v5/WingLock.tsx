import * as React from "react";

import { WingLockContext } from "./useWingLock";

/**
 * Pins every v5 card on the page to one wing.
 *
 * The coordinator console reuses the admin dashboard's cards verbatim. It can,
 * because the server already refuses to answer a coordinator about another
 * wing: dash5_scope_wing clamps every request to dash5_caller_wing(), and
 * dash5_filter_options returns only the wing they hold. So correctness does not
 * depend on this at all, and nothing here is a security boundary.
 *
 * What it fixes is the UI. Without it every card would still draw a wing
 * picker offering "All wings" and exactly one wing, both meaning the same
 * thing. The wing is stated once in the page header instead, and the pickers
 * that would repeat it are not rendered.
 *
 * Absent (the admin dashboard) the value is null and every card behaves as it
 * always has.
 */
export function WingLockProvider({
  wingId,
  children,
}: {
  wingId: string | null;
  children: React.ReactNode;
}) {
  return <WingLockContext.Provider value={wingId}>{children}</WingLockContext.Provider>;
}
