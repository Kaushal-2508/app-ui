// =============================================================
// Feature guides: short in-context walkthroughs of ONE feature, shown the
// first time a user reaches it (e.g. Auto assign on Update Roll Number).
//
// Deliberately separate from the portal's onboarding / welcome tour
// (GuidedTourProvider, profiles.onboarding_completed, mark_onboarding_complete):
//   * different store: this file only, never the onboarding flag, so finishing,
//     skipping or restarting either one never touches the other;
//   * different timing: a guide never starts while the onboarding tour runs
//     (useFeatureTip checks useTour().isTourActive);
//   * one record per guide, so each feature's guide is seen independently.
//
// Seen = once per user per device (localStorage). Keys are
// `salci_feature_tip:<tipId>:<userId>`; no bulk localStorage sweep in the app
// (logout's sb-*-auth-token purge, the query cache) matches that prefix. To show
// a guide to everyone again, bump the version inside its tipId.
// =============================================================

const keyFor = (tipId: string, userId: string) => `salci_feature_tip:${tipId}:${userId}`;

/** A storage error counts as "seen", so blocked storage never replays a guide on every visit. */
export function hasSeenFeatureTip(tipId: string, userId: string): boolean {
  try {
    return window.localStorage.getItem(keyFor(tipId, userId)) === "1";
  } catch {
    return true;
  }
}

export function markFeatureTipSeen(tipId: string, userId: string): void {
  try {
    window.localStorage.setItem(keyFor(tipId, userId), "1");
  } catch {
    // Private mode or blocked storage: the guide may show again next visit.
  }
}
