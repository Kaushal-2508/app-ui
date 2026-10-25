// The dashboard action cards' query-key root, alone in an import-free module on purpose.
// The shared cache helpers that must refresh the cards (src/lib/substitutions.ts and
// src/lib/attendanceCache.ts) sit in the entry chunk; importing this key from
// src/lib/dashboardActions.ts put the cards' whole logic into every visitor's first download,
// /login included. scripts/check-banner-chunk.mjs keeps it out.
//
// Every query key of the cards starts with these two, so the writes that already invalidate
// ["staff-attendance"] (check-in, check-out, the admin override, the attendance pass, both
// staff-leave decisions) refresh the cards without knowing about them.
export const DASHBOARD_ACTIONS_KEY = ["staff-attendance", "my-actions"] as const;
