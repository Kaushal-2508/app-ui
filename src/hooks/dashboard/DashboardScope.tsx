import { createContext, useContext } from "react";

/**
 * Dashboard scope discriminator.
 * - `"institution"` — the admin Command Center: every `dash_*` RPC runs over the
 *   whole institution. This is the DEFAULT, so any surface that renders the
 *   command-center components WITHOUT a provider (e.g. `CommandCenterV5Page`)
 *   keeps the existing institution-wide behaviour unchanged.
 * - `"scoped"` — a COORDINATOR view: the parallel `dash_scoped_*` RPCs resolve
 *   the caller's wing server-side, so no institution or wing params are passed
 *   from the client.
 * - `"teacher"` — a TEACHER view. `dash_scoped_*` resolves a teacher to their
 *   class_ids ONLY (`dash_resolve_scoped_classes()` never reads
 *   `class_assignments.subject_id`), so a one-subject teacher was shown every
 *   subject taught in their classes by every colleague. Where a subject-aware
 *   `dash_teacher_*` RPC exists, this scope routes to it; otherwise it falls
 *   back to the coordinator-grade `dash_scoped_*` RPC.
 *
 * IMPORTANT: never branch on `scope === "scoped"`. A teacher would fall through
 * to the institution-wide `dash_*` branch, which is a far worse leak than the
 * one this scope exists to fix. Branch on `isScopedDashboard(scope)` instead.
 */
export type DashboardScope = "institution" | "scoped" | "teacher";

/**
 * True for every non-admin scope. Use this for the scoped-vs-institution
 * decision so adding a future scope can never silently widen a query.
 */
export function isScopedDashboard(scope: DashboardScope): boolean {
  return scope !== "institution";
}

const Ctx = createContext<DashboardScope>("institution");

export function DashboardScopeProvider({
  scope,
  children,
}: {
  scope: DashboardScope;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={scope}>{children}</Ctx.Provider>;
}

export function useDashboardScope(): DashboardScope {
  return useContext(Ctx);
}
