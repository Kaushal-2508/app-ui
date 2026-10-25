# SALCI native app (Android + iOS) via Capacitor: design for review

**Status: ADOPTED 2026-09-17.** Tushar's decision: ship with Capacitor now, a React Native
rewrite may follow later (see [2026-09-17-native-app-stack-comparison.md](2026-09-17-native-app-stack-comparison.md)).
Working notes and the current build steps: `docs/mobile/README.md`. Phase 0 shipped as
`4c1f2fb6`; the shell lives outside the repo until root files are approved (question 8).

**Original status:** proposal, 2026-09-16. Written by Naman's session for Tushar's review.
Implementation was to start only after (a) Tushar approved this document and (b) STOP-block
Tasks 11 to 20 in `docs/superpowers/plans/2026-09-07-naman-work-queue.md` were cleared
(`.claude/CLAUDE.md` §28); both happened on 2026-09-16/17.

**Owner split:** Phases 0 to 2 are frontend work Naman can do on `naman-erp`. Items marked
**NEEDS DB** / **NEEDS EDGE FN** are Tushar's. Items marked **[ROOT]** touch files outside
`src/`, `docs/`, `public/` and need Tushar's explicit OK (question 8).

## 1. Goal and approach

Ship the salci.org school portal as a store-installable Android and iOS app, for every role,
with the same features as the website. **Capacitor** wraps the existing Vite build; there is
no second frontend. React Native was considered and rejected: it cannot reuse the 132 React
pages, would be a multi-month second codebase, and would need its own repo.

Both stores accept Capacitor apps. The one bar to design for is Apple guideline 4.2
("minimum functionality"): the app must use the device (push, camera, share sheet, safe areas,
back handling, offline state) and must not behave like a website in a shell. Those items are
built in from Phase 1, not retrofitted.

Note: this repo builds salci.org only. salci.sale lives in `harmony-ops`, so it is out of scope.

## 2. What the exploration found (2026-09-16, verified file:line)

- **Backend needs no CORS change.** All 63 edge functions return `Access-Control-Allow-Origin: *`;
  nothing gates on Origin, Referer or User-Agent. Storage buckets are platform-CORS.
- **Auth is password-only.** No OAuth, no magic links. Olympiad students use the same session
  store. Email links are built by `buildAppUrl()` in `src/lib/appUrl.ts`, which honours
  `VITE_PUBLIC_URL` and otherwise falls back to `window.location.origin`.
  `src/pages/ResetPassword.tsx:30-82` reads `?code=` (PKCE) or `#access_token` off the URL.
- **`window.location.origin` is `capacitor://localhost` inside the app.** Raw uses that would
  mint broken links: `src/hooks/useHybridAttempt.ts:465` (hybrid phone-pairing QR, a functional
  outage), `src/components/olympiad/school/OlympiadTeacherCredentials.tsx:22`,
  `src/components/olympiad/teacher/OlympiadStudentCredentials.tsx:30`, `src/lib/taskBoard.ts:186`,
  `src/hooks/useSupportTickets.ts:185` (server validates against `SUPPORT_APP_ORIGINS`, silently
  falls back to salci.org).
- **Downloads and print are no-ops in a WebView**, about 35 sites: 9 html2pdf `.save()` calls,
  jsPDF in `src/components/student/DownloadReportButton.tsx`, 4 `XLSX.writeFile`, 2 exceljs
  exports, 22 `URL.createObjectURL` + `a.download` sites (incl. `src/components/shared/DataTable.tsx:231`),
  7 `window.print()` popups (`src/lib/exportTextPdf.ts`, `src/components/exam/paper/printExamPaper.ts`,
  FeeReceiptViewer, SalarySlipViewer, TimetablePrintViewV2, OlympiadFlyer, ReceiptGenerator).
- **External windows:** about 13 `window.open(url, "_blank")`, about 10 `target="_blank"` anchors,
  Razorpay `checkout.js` iframe adapter in `src/lib/olympiad/payment/razorpayAdapter.ts`.
- **Camera:** `getUserMedia` in `src/components/offline-scan/CameraCapture.tsx:39-66`,
  `HybridCameraGate.tsx`, `src/hooks/useProctoring.ts:231`, `FaceEnrollment.tsx`,
  `FaceAttendance.tsx`, `OfflineScanFlow.tsx`; `MediaRecorder` audio in
  `src/components/tms/TaskComments.tsx:95-111`. All need OS permission declarations.
- **Exam integrity:** fullscreen is already disabled on Apple (`src/lib/fullscreen.ts`).
  `src/pages/student/ExamAttemptPage.tsx` uses `visibilitychange`/`blur` (L433-471, will
  false-positive on the notification shade or a phone call), `beforeunload` (L225-236, never
  fires in a WebView), a `popstate` sentinel (L203-218), and `navigator.keyboard.lock`
  (desktop Chromium only).
- **Layout:** `index.html:5` lacks `viewport-fit=cover`; 8 bottom safe-area sites, zero top
  inset; no `visualViewport` handling; 45 `min-h-screen`/`100vh` vs 20 `dvh`. The app bar is
  `h-[61px] sticky top-0` with the `--app-bar-height` token in `src/components/layout/AppLayout.tsx`.
- **Service worker:** `src/main.tsx:27-77` registers `/sw.js` in PROD and reloads on
  `controllerchange`. Meaningless in a bundled app and unsupported in WKWebView.
- **Push is Web-Push-shaped:** `push_subscriptions(endpoint, p256dh, auth_key)`, the
  `send-web-push` edge function, and the toggle in `src/pages/SettingsPage.tsx:180-460`.
  Native FCM/APNs tokens do not fit. The in-app `notifications` table and `NotificationPanel`
  work unchanged. `src/components/PushManager.tsx` is dead code.
- **Session:** the `safeStorage` localStorage shim in `src/integrations/supabase/client.ts:13-36`
  is the single storage seam. `signOut` purges `sb-*-auth-token` keys and the avatar Cache API;
  logout hard-redirects via `window.location.replace("/login")` (documented invariant, keep it).
- **Docs contradict each other:** `ExpansionPlanDocument.tsx:196` and
  `ERPRoadmapDocument.tsx:242-248,358` say React Native; `BuilderGuideDocument.tsx:1065` says
  Capacitor phase 2.

## 3. Architecture decisions

| Topic | Decision | Why |
|---|---|---|
| Capacitor major | 7.x, core and every plugin on the same major. Take 8 only if all plugins are on 8 at scaffold time. | Android SDK 35 (Play minimum), Xcode 16, iOS privacy manifest. Mixed majors are the most common build failure. |
| Router | Keep `BrowserRouter`, no basename. | Capacitor's local server falls back to `index.html`, so the logout redirect and ResetPassword URL parsing keep working. Same URLs as the web enable App Links. |
| Web scheme | Capacitor defaults: `capacitor://localhost` on iOS, `https://localhost` on Android. Freeze at v1. | Storage is origin-keyed. Changing the scheme later logs every user out. |
| Session storage | Keep localStorage through `safeStorage`. Move to `@capacitor/preferences` only if eviction is observed in the field. | In a native container WebView storage is not subject to Safari ITP eviction. Keeps the `getUser` patch, the key purge and the avatar cache intact. The seam already exists for a later swap. |
| Service worker | Wrap `src/main.tsx:28-77` in `if (!isNativePlatform())`. | Web unchanged. |
| Updates | Store releases for v1, plus `public/app-version.json` `{ "minNativeBuild": N }` read at launch; below minimum shows a full-screen "Update SALCI" with a store link. Live updates (Capgo) are optional later. | Frontend-only guard against a bundled frontend drifting from edge functions or RPC signatures. |
| Deep links | Universal Links / App Links on `www.salci.org` and `salci.org`. `VITE_PUBLIC_URL=https://www.salci.org` for web AND native builds. No custom URL scheme. | One URL space. Email links open the app when installed and the site otherwise. No `capacitor://` URL ever leaves the device. |
| Payments | Olympiad payment deferred to the web (in-app browser) on iOS by default. | Apple 3.1.1 exposure. Question 3. |
| Adapter rule | No `@capacitor/*` import outside `src/lib/native/`. Plugins are lazily `await import()`ed inside native branches. | Web bundle stays lean. One place to reason about native behaviour. |

### 3.1 Adapter layer `src/lib/native/`

Every module exports today's web behaviour by default and branches on `isNativePlatform()`.

| Module | API | Native body |
|---|---|---|
| `platform.ts` | `isNativePlatform()`, `nativePlatform()` | Phase 0: probe `window.Capacitor?.isNativePlatform?.()` with no dependency. Phase 1: `@capacitor/core`. |
| `download.ts` | `saveBlob(blob, filename)` | `@capacitor/filesystem` writes to `Directory.Cache` as base64, then `@capacitor/share`. Errors go through `toastError`. |
| `print.ts` | `printHtml(html, filename)` | lazy html2pdf, then `saveBlob` |
| `openExternal.ts` | `openExternal(url)`, `installLinkInterceptor()` | `@capacitor/browser`; the interceptor catches `a[target=_blank]` and off-origin hrefs so anchors need no edits |
| `camera.ts` | `ensureCameraPermission()`, `ensureMicPermission()` | `@capacitor/camera` check/request before `getUserMedia` |
| `appState.ts` | `onAppStateChange(cb)` | `@capacitor/app` `appStateChange` (web: `visibilitychange` + `blur`/`focus`) |
| `backButton.ts` | `useAndroidBackButton(handler?)` | `@capacitor/app` `backButton`; default `navigate(-1)`, or `exitApp()` at a root route |
| `deepLinks.ts` | `useDeepLinks()` | `appUrlOpen` + `getLaunchUrl()`; for salci.org hosts, `navigate(path + search + hash)` |
| `push.ts` | `registerPushForUser`, `unregisterPushForCurrentDevice`, `onPushTap` | `@capacitor/push-notifications` (Phase 3) |
| `shell.ts` | `initNativeShell()` | status bar style, splash hide, keyboard config |
| `network.ts` | `useIsOnline()` | `@capacitor/network` |
| `haptics.ts` | `hapticLight()`, `hapticSuccess()` | `@capacitor/haptics` |

Plugins: `@capacitor/{core,cli,android,ios,app,browser,filesystem,share,camera,keyboard,status-bar,splash-screen,network,haptics}`; `@capacitor/push-notifications` in Phase 3; `@capacitor/assets` as a dev dependency. Optional: `@capacitor-community/privacy-screen` during exams.

### 3.2 Password-reset deep link flow

1. `src/pages/ForgotPassword.tsx:110-112` already sends `redirectTo: buildAppUrl("/reset-password")`. With `VITE_PUBLIC_URL` set this is `https://www.salci.org/reset-password`.
2. The OS recognises the verified App Link and opens the app. `deepLinks.ts` navigates to `/reset-password?code=...`. `ResetPassword.tsx` runs unchanged.
3. Files: `public/.well-known/assetlinks.json` (needs the Play App Signing SHA-256), `public/.well-known/apple-app-site-association` (no extension; needs the Team ID). **[ROOT]** `vercel.json` header `Content-Type: application/json` for the AASA path. Android `intent-filter android:autoVerify="true"` for `/reset-password`, `/tasks`, `/support`, `/notifications` (or `/*`, question 6). iOS Associated Domains entitlement `applinks:www.salci.org`, `applinks:salci.org`.
4. Known limit: a PKCE `?code=` can only be exchanged by the client that stored the verifier. A reset requested in the app and opened on the same phone works. Requested on a laptop and tapped on the phone falls through to the invalid-session branch. Improve that copy: "Open this link on the device where you requested the reset."

## 4. Phases

Each phase is independently pushable. Web behaviour is byte-identical until Phase 1.

### Phase 0: web hardening (frontend-only, no Capacitor dependency, fits §28 fully)

1. Create `src/lib/native/` with web bodies only: `platform.ts`, `download.ts`, `print.ts`, `openExternal.ts`, `appState.ts`, `network.ts`.
2. Download funnel, three commits by area: the 22 blob+anchor sites to `saveBlob`; html2pdf `.save()` to `.outputPdf("blob")` then `saveBlob`; jsPDF `.output("blob")`; `XLSX.write(wb, { type: "array" })` to a Blob; exceljs `writeBuffer()` to a Blob; the 7 print sites to `printHtml`.
3. External-link funnel: the 13 `window.open(url, "_blank")` sites to `openExternal`.
4. Origin funnel through `buildAppUrl()` / `getAppUrl()`: `useHybridAttempt.ts:465`, `OlympiadTeacherCredentials.tsx:22`, `OlympiadStudentCredentials.tsx:30`, `taskBoard.ts:186`, `useSupportTickets.ts:185`. Tushar confirms `VITE_PUBLIC_URL` is set in Vercel (question 7); the fallback keeps the web safe either way.
5. Layout. `index.html`: `viewport-fit=cover`, `theme-color`, `apple-touch-icon` **[ROOT, trivial]**. `src/index.css`: `overscroll-behavior-y: none`, `-webkit-tap-highlight-color: transparent`, `-webkit-text-size-adjust: 100%`, and `.pt-safe` / `.pb-safe` utilities. `AppLayout.tsx` app bar gets `pt-[env(safe-area-inset-top)]` and `--app-bar-height: calc(61px + env(safe-area-inset-top))`; check the `PageShell.tsx:73` min-height math and the hide-on-scroll transform. Public pages (Login, ForgotPassword, ResetPassword) get `pt-safe`. Migrate the 45 `min-h-screen` / `100vh` sites to `dvh`, one page group per commit.
6. Exam-integrity listeners in `ExamAttemptPage.tsx:433-471`, `OlympiadExamAttemptPage.tsx:102-120`, `useHybridIntegrityLogger.ts`, `useProctoring.ts:380-408` subscribe through `onAppStateChange`. `OlympiadExamAttemptPage.tsx:41` uses `useIsOnline()`.
7. Delete dead `src/components/PushManager.tsx`. Correct the React Native claims in `ExpansionPlanDocument.tsx` and `ERPRoadmapDocument.tsx`.
8. `docs/mobile/README.md`: build commands, the adapter rule, and a pointer to this spec.

### Phase 1: Capacitor scaffold and shell **[ROOT files throughout]**

- `package.json`: dependencies and scripts (`build:native` = `VITE_PUBLIC_URL=https://www.salci.org vite build && npx cap sync`, `cap:android`, `cap:ios`). `capacitor.config.ts`: `appId`, `appName: "SALCI"`, `webDir: "dist"`, `ios.contentInset: "never"`, `SplashScreen.launchAutoHide: false`, `Keyboard.resize: "native"`. `android/`, `ios/`, `resources/icon.png` + `resources/splash.png` generated with `npx @capacitor/assets generate`. Pick ONE lockfile (bun.lock, bun.lockb and package-lock.json all exist today). `.gitignore` the native build dirs.
- `src/main.tsx`: SW block gated on `!isNativePlatform()`. `platform.ts` switches to `@capacitor/core`. Native bodies for `shell.ts`, `backButton.ts`, `network.ts`.
- `src/components/native/NativeBootstrap.tsx`, mounted once inside `BrowserRouter` in `App.tsx`: hides the splash after first paint, sets the status bar style from the theme, mounts the back-button hook, the deep-link hook (Phase 2), `ForceUpdateScreen` (reads `public/app-version.json`) and `OfflineBanner` (shadcn `Alert` under the app bar). The `salci-update-ready` toast in `App.tsx:197-209` becomes a no-op on native.
- iOS `Info.plist`: camera, microphone, photo-library-add usage strings. Android manifest: `CAMERA`, `RECORD_AUDIO`.
- Keyboard checks on device: `StickyBottomCTA`, `MobileSheet` inputs, MathLive (`src/components/ui/math-field.tsx:69`; set `mathVirtualKeyboardPolicy` to `"manual"` on native if it fights the OS keyboard).

### Phase 2: native adapters

- Native bodies for `download.ts`, `print.ts`, `openExternal.ts` (interceptor installed from `NativeBootstrap`), `camera.ts`, `deepLinks.ts`, `haptics.ts`.
- Camera pre-flight in `CameraCapture.tsx`, `HybridCameraGate.tsx`, `useProctoring.ts`, `FaceEnrollment.tsx`, `FaceAttendance.tsx`, `OfflineScanFlow.tsx`; microphone in `TaskComments.tsx`. The `<input capture>` in `HybridUploadPage.tsx:287-303` works as-is.
- `public/.well-known/` files; **[ROOT]** `vercel.json` header; Android intent-filter; iOS Associated Domains.
- `ResetPassword.tsx` cross-device copy. `Login.tsx:271,280` terms and privacy links through `openExternal`.

### Phase 3: push, exam integrity, payments, account deletion

**NEEDS DB (Tushar):**
```sql
create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  token text not null unique,
  device_id text,
  app_version text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index push_devices_user_id_idx on public.push_devices (user_id);
-- RLS: authenticated own-row select/insert/update/delete on user_id = (select auth.uid());
-- REVOKE ALL FROM anon by name. Keep push_subscriptions untouched for web.
```

**NEEDS EDGE FN (Tushar):** `send-push`, input `{ user_ids, title, body, data: { url } }`, reads `push_devices`, sends through FCM HTTP v1 for both platforms (APNs auth key uploaded to Firebase), deletes rows on `UNREGISTERED`, fanned out from wherever `send-web-push` is triggered today. Needs a Firebase project, `android/app/google-services.json`, `ios/App/App/GoogleService-Info.plist`, the iOS Push capability, and a `FCM_SERVICE_ACCOUNT_JSON` secret.

Client: `push.ts` native body. Register after sign-in in `AuthContext`; unregister at the top of `signOut`, before the key purge. `pushNotificationActionPerformed` navigates to `data.url`. `SettingsPage.tsx`: on native the toggle drives `push.ts` and the iOS-standalone alert (L376-387) is hidden. Android 13 `POST_NOTIFICATIONS`.

Exam integrity: `fullscreenEnforced` additionally requires `!isNativePlatform()`. Skip `beforeunload` and `navigator.keyboard.lock` on native. `useAndroidBackButton` override on exam routes opens the existing leave-exam dialog instead of navigating back, leaving the `popstate` sentinel intact. App-state violations already flow through `appState.ts` from Phase 0. Optional: privacy-screen plugin enabled on exam mount, disabled on unmount.

Razorpay: on native, show "Complete payment on www.salci.org" and open it with `openExternal`; the App Link returns the user afterwards. A `capacitor-razorpay` adapter behind the existing `VITE_OLY_PAYMENT_ADAPTER` selection only if question 3 says in-app.

Apple 5.1.1(v) account deletion: sign-up exists, so Apple may ask. Claim the institution-managed exemption in the review notes. Fallback **NEEDS EDGE FN** `delete-account` plus a Settings entry behind a confirm dialog.

### Phase 4: store submission

Bundle id (proposal `org.salci.app`), display name "SALCI", version 1.0.0 build 1, `app-version.json` `minNativeBuild: 1`. Play App Signing with the upload key held by Tushar; iOS automatic signing under the SALCI team. Privacy policy and support URLs. Play Data Safety and Apple App Privacy: account info, photos (camera), device identifier (push token), encrypted in transit, not shared. Screenshots: 6.7" and 6.1" iPhone, Android phone, light and dark; iPhone-only for v1. Review notes: test accounts for student, teacher, coordinator and school_admin, the Olympiad payment behaviour, and a 4.2 evidence list (push, camera attendance and proctoring and scan, share-sheet exports, safe areas, back handling, offline state, deep links, haptics). Rating 4+ / Everyone.

## 5. Risk register

| # | Risk | Mitigation |
|---|---|---|
| 1 | Apple 4.2 "website in a shell" rejection | Ship Phases 1 to 3 before the first submission. Reviewer notes list the native features. Splash, icons, safe areas, no browser chrome. |
| 2 | Apple 3.1.1 demands IAP for the Olympiad fee | Web payment through the in-app browser on iOS by default. |
| 3 | Apple 5.1.1(v) account deletion | Exemption claim; fallback edge function. |
| 4 | Cross-device PKCE reset link fails in the app | Copy fix in ResetPassword. Implicit flow on native only as a last resort. |
| 5 | Bundled frontend drifts from edge functions or RPCs | `app-version.json` force-update gate; release the app with every breaking backend change; Capgo later if wanted. |
| 6 | Session loss from a scheme or appId change | Freeze both at v1. `safeStorage` seam allows a Preferences adapter later. |
| 7 | Keyboard and viewport regressions (MathLive, sticky CTAs, `100vh`) | Phase 0 dvh migration; `Keyboard.resize: "native"`; device tests on exam creation and homework. |
| 8 | Weaker exam integrity in a WebView (no fullscreen on iOS, no keyboard lock) | App-state violations, camera proctoring unchanged, privacy-screen on Android; document the parity gap for schools. |

Also watch: cold-start time from the roughly 60 eagerly imported pages in `App.tsx` (the splash covers it; `manualChunks` in `vite.config.ts` is a **[ROOT]** change for later), and the Android back button versus the exam `popstate` sentinel (covered by the route override).

## 6. Verification

- Every phase: the §5a gate (`npm run typecheck`, `npx eslint <changed>`, `npx vite build`) plus the stale-import eslint pass; 375px and dark-mode screenshots of every touched page. Web smoke on `npm run dev`: a DataTable CSV export, one PDF export, one external link, ForgotPassword to ResetPassword.
- Phase 0: `npm run preview` in PROD mode confirms the service worker still registers and updates on the web.
- Phase 1: `npx cap run android` (Pixel 8, API 35) and `npx cap run ios` (iPhone 16). Check: splash to login with no white flash, status bar contrast in both themes, notch and home-indicator insets on Login and on a `PageShell` page, back button navigates then exits at the dashboard, airplane mode shows the offline banner, no service worker registered, logout lands on Login. Real devices: one low-end Android and one iPhone. Keyboard on exam creation (MathLive), homework, support chat.
- Phase 2: exports open the share sheet and the file opens; print flows produce a PDF; the salci.ai terms link opens in the in-app browser; the camera prompt appears once and then FaceAttendance, CameraCapture and proctoring stream. Deep links: `adb shell am start -a android.intent.action.VIEW -d "https://www.salci.org/reset-password?code=x"` and `xcrun simctl openurl booted ...` route into the app; real-device App Link verification (`adb shell pm get-app-links <appId>`); a full email reset on a real phone.
- Phase 3: a `push_devices` row appears after login; a Firebase console test message arrives in foreground and background; tapping navigates to `data.url`; logout removes the row. Backgrounding during an attempt logs a violation. Android back during an exam opens the dialog rather than exiting.
- Phase 4: TestFlight internal and Play internal testing with the four review accounts, one full day of role walkthroughs before submission.

## 7. Open questions for Tushar

1. Bundle id / package name (proposal `org.salci.app`) and display name. iPhone-only or iPad too?
2. Who owns the Apple Developer account (Team ID), the Play Console, the Firebase project and the signing keys? Naman needs the Play App Signing SHA-256 and the Team ID for the `.well-known` files.
3. Olympiad payments: in-app through a Razorpay plugin, or web-only (iOS only, or both platforms)?
4. Do super_admin and Olympiad-admin surfaces ship in the app, or are they hidden in the app build?
5. Live updates (Capgo or similar): yes or no? If no, agree that every breaking backend change bumps `app-version.json`.
6. App Links scope: only `/reset-password` and the notification paths, or all of `https://www.salci.org/*`?
7. Confirm `VITE_PUBLIC_URL=https://www.salci.org` is set in Vercel today, and which lockfile is canonical (bun or npm).
8. Root and config files (`capacitor.config.ts`, `android/`, `ios/`, `resources/`, `package.json`, `index.html`, `vercel.json`, `.gitignore`, an eslint `no-restricted-imports` rule): may Naman touch them, or will Tushar commit them from Naman's patch?
9. Account-deletion stance for Apple 5.1.1(v): claim the institution-managed exemption, or build `delete-account`?
