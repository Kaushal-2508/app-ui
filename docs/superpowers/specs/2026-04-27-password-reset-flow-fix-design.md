# Password Reset Flow Fix — Design

**Date:** 2026-04-27
**Owner:** tushar@salci.in
**Status:** Approved (verbal, in-conversation)

## Problem

1. Password reset emails go out, but the link inside lands on the **Lovable preview** origin instead of `salci.org/reset-password`. Users can't actually reset their passwords.
2. The Settings → Change Password dialog asks for the **current password** before allowing a change. Product wants a 2-field flow (New + Confirm) only.
3. The Supabase reset-password email is unstyled while the welcome email (`send-welcome-email` edge function) is fully designed — visually inconsistent and unprofessional.
4. The welcome email itself drifted from the SALCI brand color (`#249ca2` teal per [.claude/rules/design-rules.md](../../../.claude/rules/design-rules.md)) and is using a generic blue (`#2563eb`).

## Root cause of the redirect bug

The frontend code in [src/pages/ForgotPassword.tsx:109-111](../../../src/pages/ForgotPassword.tsx#L109-L111) already passes `redirectTo: ${window.location.origin}/reset-password` correctly. The bug was in the Supabase Auth dashboard config:

- **Site URL** was the Lovable preview origin.
- **Allowed Redirect URLs** whitelist did not include `salci.org`, so when Supabase generates the email it falls back to Site URL.

No code change is needed for the redirect itself — only dashboard config.

## Solution

Four parts. Part 1 is dashboard config (no code), Parts 2–4 are code edits.

### Part 1 — Supabase dashboard (operator action, completed)

| Setting | Value |
|---|---|
| Site URL | `https://www.salci.org/` |
| Allowed Redirect URLs | `https://www.salci.org/**`, `https://salci.org/**`, `http://localhost:5173/**`, `http://localhost:8080/**` |
| Email template (Reset Password) | Replace with branded teal HTML using `{{ .ConfirmationURL }}`, single CTA button, plain-text fallback link, "didn't request this?" security note, footer |

The `{{ .ConfirmationURL }}` Go-template variable already resolves to `<SUPABASE_URL>/auth/v1/verify?token=…&redirect_to=<the redirectTo we pass>`, so the existing call in `ForgotPassword.tsx` doesn't need to change.

### Part 2 — Settings password change UX simplification

**File:** [src/pages/SettingsPage.tsx](../../../src/pages/SettingsPage.tsx)

- Remove the `currentPassword` field from the Zod schema, the form state, the dialog markup, and the error map.
- Remove the `signInWithPassword(...)` re-authentication block in `handlePasswordChange` — the user must already be logged in to be on Settings, so an active session is sufficient authorization.
- Add an eye-toggle (`showConfirmPassword` state) to the Confirm Password input so it matches the New Password input.
- Replace the existing `toast({ variant: "destructive", ... })` failure path with `toastError(err, { fallback: "Couldn't update password.", context: "changePassword" })` per [CLAUDE.md §19](../../../.claude/CLAUDE.md). Drive-by cleanup since we're touching the file.

**End-state flow:** open dialog → enter new password (min 8) and confirm → submit → `supabase.auth.updateUser({ password })` → success toast, dialog closes, fields cleared.

### Part 3 — Welcome email: switch to brand teal

**File:** [supabase/functions/send-welcome-email/index.ts](../../../supabase/functions/send-welcome-email/index.ts)

Color-only swap inside the inline HTML in `generateEmailHtml`. No copy, layout, or sending-logic changes.

| Element | Old (blue) | New (teal) |
|---|---|---|
| Header gradient | `#2563eb → #1d4ed8` | `#249ca2 → #1c7a7e` |
| Credentials box bg | `#f0f9ff → #e0f2fe` | `#ecfeff → #cffafe` |
| Credentials box left border | `#2563eb` | `#249ca2` |
| "Your Login Credentials" heading | `#1e40af` | `#0f5e62` |
| Role pill bg / text | `#dbeafe` / `#1e40af` | `#cffafe` / `#0f5e62` |
| CTA button gradient | `#2563eb → #1d4ed8` | `#249ca2 → #1c7a7e` |
| CTA button shadow | `rgba(37, 99, 235, 0.3)` | `rgba(36, 156, 162, 0.3)` |

**Deploy step:** `npx supabase@latest functions deploy send-welcome-email --project-ref gyymkgohcijeksmrzuyw` (no global Supabase CLI per [CLAUDE.md §8](../../../.claude/CLAUDE.md)).

### Part 4 — `/reset-password` page consistency

**File:** [src/pages/ResetPassword.tsx](../../../src/pages/ResetPassword.tsx)

The page itself works correctly post-config-fix — handles PKCE code exchange, legacy hash recovery token, and existing session. The only drive-by alignment is bumping the Zod min from 6 to 8 chars to match Settings (currently a 6/8 inconsistency between the two reset surfaces).

## Out of scope

- Forgot-password page UI (already on-brand and clean)
- Password strength meter
- "Your password was changed" confirmation email (feature creep — not requested)
- Lovable redirect-URL cleanup in the Supabase dashboard (operator's call)
- Other edge function emails (`send-fee-reminder`, etc.) — color sweep can happen separately

## Risk and trade-offs

- **Removing current-password verification:** Anyone with an active stolen session can change the password without knowing the current one. Mitigation: Supabase still requires an authenticated session; this matches the UX of Notion/Linear/Slack. Product accepted the trade-off.
- **`localhost:5173/**` and `localhost:8080/**` in the redirect whitelist:** Convenient for local dev testing of the reset flow. Acceptable risk — these origins can't be hit in production.

## Verification plan

1. Send a fresh forgot-password email. Confirm it has the new teal design, the CTA button works, and the link lands on `https://www.salci.org/reset-password?code=…`.
2. Complete the reset flow end-to-end. Confirm the new password works on next login.
3. Open Settings → Change Password. Confirm only New + Confirm fields are present, both have eye toggles, and submitting updates the password.
4. Create a new user (admin flow) and confirm the welcome email renders in teal.
