# SALCI native app: working notes

**Decision, 2026-09-17 (Tushar):** ship the app with **Capacitor now**; a React Native rewrite
may follow later. Comparison that informed it:
[../superpowers/specs/2026-09-17-native-app-stack-comparison.md](../superpowers/specs/2026-09-17-native-app-stack-comparison.md).
Design: [../superpowers/specs/2026-09-16-native-app-capacitor-design.md](../superpowers/specs/2026-09-16-native-app-capacitor-design.md).

## The one rule

Nothing outside `src/lib/native/` imports `@capacitor/*` or reads `window.Capacitor`.
Every web/native difference is decided inside that directory behind
`isNativePlatform()`. Call sites use the adapters and never care which shell they run in.

| Need | Use | Never |
|---|---|---|
| Hand the user a file (PDF, XLSX, CSV, image) | `saveBlob`, `saveText`, `saveDataUrl` | `URL.createObjectURL` + `<a download>`, `XLSX.writeFile`, html2pdf `.save()` |
| Print a document | `printHtml(html, { filename })` | `window.open("", "_blank")` + `print()` |
| Open a URL outside the app | `openExternal(url)` | `window.open(url, "_blank")` |
| "Did the user leave the screen?" | `onAppStateChange(listener)` | raw `visibilitychange` / `blur` listeners |
| Connectivity | `useIsOnline()` | `navigator.onLine` |
| A link that leaves the device (QR, email, printout) | `buildAppUrl` / `getAppUrl` from `@/lib/appUrl` | `window.location.origin` |

## How the shell and the repo fit together

Section 28 keeps this branch inside `src/`, `docs/` and `public/`, and a Capacitor scaffold
lives at a project root. So the shell is a **separate project**, `~/salci-app-shell`
(Capacitor 8, appId `org.salci.app`, provisional), whose `webDir` points at this repo's
`dist/`. No `@capacitor/*` package is installed in this repo.

Plugins are still usable from the web code: Capacitor injects a bridge into its WebView, and
`src/lib/native/platform.ts` reaches plugins installed in the shell through
`Capacitor.registerPlugin(name)`, typing only the methods each adapter needs. Plugins the shell
carries today: App, Browser, Filesystem, Share, StatusBar, SplashScreen, Network, Keyboard.
Adding a plugin means installing it in the shell AND declaring the slice of its API in the
adapter that uses it; a missing plugin makes the adapter fall back to the web behaviour.

What the shell does on boot (`src/components/native/NativeBootstrap.tsx`, mounted once in
`App.tsx`): plays the launch intro, which also hides the system splash (see "Launch intro"
below), keeps the status bar in step with the theme,
maps the Android back button onto router history (closing an open sheet first, exiting from a
root screen), opens the links the app claims (the PTM feedback QR, see "App links" below), and
shows an offline banner under the app bar. `src/main.tsx` adds
`viewport-fit=cover` to the viewport meta on native so `env(safe-area-inset-*)` is non-zero,
and skips the service worker there.

## Build

```
# in the repo: production build with the canonical public URL
VITE_PUBLIC_URL=https://www.salci.org npx vite build

# in ~/salci-app-shell
npx cap sync
cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleDebug
#   -> android/app/build/outputs/apk/debug/app-debug.apk
cd ios/App && xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build   # simulator
# a real iPhone (Naman's personal team CBVNWF6376, signed into Xcode once):
cd ios/App && xcodebuild -project App.xcodeproj -scheme App -configuration Debug -sdk iphoneos \
  -destination "id=<device udid>" -allowProvisioningUpdates DEVELOPMENT_TEAM=CBVNWF6376 \
  CODE_SIGN_STYLE=Automatic build
xcrun devicectl device install app --device <device udid> build/.../Debug-iphoneos/App.app
xcrun devicectl device process launch --device <device udid> org.salci.app
```

The personal-team profile expires after 7 days; rerun the three lines to refresh it.

`android/local.properties` names the SDK; `gradle.properties` sets `org.gradle.java.home` to
Android Studio's bundled JDK. Android declares CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS;
iOS carries the camera, microphone and photo-library usage strings. Icons and splash come from
`npx @capacitor/assets generate` over `resources/` (mark cut from `public/Logo-trim.png`).

## Launch intro (2026-09-30)

On a cold start the app plays a 2-second launch screen over the first screen while it loads:
the magnifier rises, the S A L C I tiles pop in, the tagline and six school-activity icons
follow, a loading line fills, then it fades into the app. It replaced the logo-only splash;
the 3D banner was judged too heavy for a splash, so this is plain CSS over six small images
(about 28 kB, `public/splash/`).

- **Seamless hand-over.** Android always shows its own system splash first. That splash IS
  the intro's first frame: the mark alone, 136 dp tall, centred on the same colour (light
  `#FBFAF8`, dark `#121421`, following the phone's dark setting). The shell's
  `scripts/launch-assets.mjs` draws the system splash icon, the old-style splash drawables and
  the web images from the logo in one run, so the sizes cannot drift. Change the mark size or
  the colours in the script, `index.css` (launch intro block) and the shell's
  `launch_colors.xml` together.
- **Who hides the system splash.** `LaunchIntro.tsx`, not NativeBootstrap: it waits (at most
  600 ms) for its images to decode, calls `hideSplash()` straight away (Capacitor's splash
  holds back every draw of the app until then, so waiting for a paint would wait forever),
  and starts the animation on the WebView's first frame after that. The shell's
  `launchShowDuration: 3000` auto-hide is only the safety net for a bundle that never runs.
- **Plays once.** A sessionStorage flag stops it replaying after sign-out's in-place reload;
  it never shows on the website. Reduced motion shows the finished frame for 0.8 s instead.
  The layer removes itself 4 s after mounting whatever happens.
- **Checks.** `npm run test:launch-intro` pins the decision table and the timing (the plan's
  exit time must cover the CSS keyframes). To see it in a desktop browser, fake the bridge
  (below) and load `/login` at 375 px, light and dark.

## The app-only look (html.native-shell)

`src/main.tsx` calls `markNativeShell()` before the first render, which adds the class
`native-shell` to `<html>` inside the app and nothing in a browser. Every visual difference
between the app and the website is a `.native-shell ...` rule at the end of `src/index.css`,
so the web never changes when the app does. Today those rules give the app:

- **A compact type scale.** Every Tailwind size utility (`text-xs` to `text-6xl`) and every
  arbitrary pixel size in use (`text-[14px]` to `text-[46px]`) is re-mapped one step down
  for body text and two for headings. Root font-size stays 16px, so rem spacing and hit
  boxes do not move. A call site's explicit `leading-*` is respected on named sizes.
- **Colour.** Light theme: a pale-teal 44px app bar with deep-teal controls (the bar re-points
  the ink/foreground tokens on itself, so nothing inside it needed a class change), a
  teal-tinted page floor with a stronger backdrop gradient, tinted hairlines. A first pass
  painted the bar full brand teal; on the phone that plus the status-bar inset read as a heavy
  block, so it was lightened and the title block under it tightened (`.native-page-content`,
  `.native-page-header`). Dark theme keeps its own colours and its dark bar. The status bar
  follows (`shell.ts`, `STATUS_BAR_BG`).
- **A phone login.** `Login.tsx` renders a teal hero plus a white form card when
  `isNativePlatform()` is true; the web layout is a separate branch and unchanged.
- **Phone screens, not web pages (2026-09-18).** Pages branch on `isNativePlatform()` to drop
  web furniture the tab counts already carry: Tasks and Support hide their stat-tile grids
  and the Cards/Board toggle (a kanban is not a phone pattern), Support lists tickets in one
  grouped hairline list with chevrons, and a support thread opens full screen
  (`MobileSheet placement="right"` + `bodyClassName`) as a chat: `SupportThread layout="chat"`
  scrolls the messages in their own pane pinned to the newest and `SupportComposer
  variant="chat"` is a growing one-line field beside a round send button, pinned above the home
  indicator. Task cards drop the "From:"/"Assigned to:" labels, the relative "Updated" line and
  the owner's manage buttons (all still in the detail sheet). The floating quick-actions "+"
  was hidden in the app first and then removed everywhere by Tushar (715be218, 2026-09-21).
  The Tasks strip carries `native-unpin` and scrolls
  with the page in the app ("no sticking"); every other strip stays pinned (a first cut
  unpinned all of them and the dashboard's was asked back the same afternoon). Settings puts
  Save Settings on the tab row beside General on both surfaces.
- **The 2026-09-18 phone audit** (29 routes crawled at 390x844 in app mode, school-admin
  account; report and screenshots were kept in the session scratchpad, not the repo) fixed the
  shared causes rather than the screens: `MobileFab` renders nothing in the app (PageHeader's
  primary action is visible at every width there, so the FAB only duplicated it and floated
  over cards on eight pages); `MobileTabs` fades 44px under its scroll chevron so the last
  label is never half-cut; `StatTile` is a compact 64px row in the app (`.stat-tile*` hooks,
  odd last tile spans the row); a nested `PageHeader` (tab sub-pages under Manage Users)
  collapses to a section heading (`usePageShellNested`); every pill control uses
  `bg-[hsl(var(--surface-card)/0.85)]` instead of `bg-white/85` so dark mode holds; the
  toast viewport pads by the top inset; `MobileSheet`'s right drawer pads its header by the
  top inset. Per-screen: Classes cards (`grid-cols-1` + `min-w-0`), Question Bank rows wrap
  to two lines, Communication panels (`min-w-0` + `overflow-hidden`), Wings and Rechecks get a
  card list under `md` (their tables hid the Actions column off-screen), Tasks pages its
  render 24 cards at a time, exam status bands have `dark:` tints, Command Center's wide
  table pins its first column, Timetable drops its double gutter. Re-run the crawl after
  any layout change: every route must measure `scrollWidth` 390 AND no element may have a
  bounding rect past the viewport (PageShell's `overflow-x-clip` hides the first symptom).
- **Push notifications look native.** Android needs a monochrome small icon or FCM falls back
  to the colour launcher icon on a white tile: `ic_stat_salci.png` (white silhouette of the mark,
  five densities) plus the `default_notification_icon` / `default_notification_color` meta-data
  in the shell's manifest. A tapped notification lands on the exact task or thread:
  `src/lib/notificationLink.ts` resolves `metadata.task_id` / `conversation_id` for both the
  web bell and the app tap (`NativeBootstrap` reads the row by `notificationId`), and the
  client-written task notifications now link `/tasks?task=<id>` directly.

Two shell-side settings make the scale what the user actually sees: Android
`MainActivity` pins `WebSettings.textZoom` to 100 (the System WebView otherwise multiplies
every size by the phone's font-size setting), and `shell.ts` adds `maximum-scale=1,
user-scalable=no` to the viewport on native so a 15px input no longer makes WebKit zoom the
page on focus.

To preview the app look in a desktop browser: fake the bridge before any module runs
(`window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" }` in an inline
`<script>`), then load a harness page; `main.tsx`'s boot adds the class and the adapters fall
back to their web bodies because the fake has no `nativePromise`.

## App links: the PTM feedback QR

Since 2026-09-29 a scanned PTM feedback QR (`https://www.salci.org/ptm/feedback/<token>`, or the
permanent `/ptm/feedback/active`) opens the Android app on the feedback form when the app is
installed, and the website otherwise. A signed-out family signs in inside the app and comes
straight back to the form.

| Piece | Where |
|---|---|
| The claim | `~/salci-app-shell/android/app/src/main/AndroidManifest.xml`: an `autoVerify` intent filter for `https` + `www.salci.org` + path prefix `/ptm/feedback/`. Only that path, so password-reset and other email links keep opening the browser. Only `www`: `salci.org` redirects to it, and Android does not follow redirects when it verifies. |
| The proof | `public/.well-known/assetlinks.json`, served by the website. Android fetches it after install and trusts the claim only for an app signed with a key listed there. |
| The routing | `NativeBootstrap` listens once for the App plugin's `appUrlOpen`; a cold start's link is held by the plugin until that listener registers. `getLaunchUrl()` is deliberately unused: it returns the launch link for the life of the app, so every in-app reload would reopen an old QR. A link opens only if `appLinkPath` in `src/lib/appLinks.ts` accepts it (`https`, the host of `VITE_PUBLIC_URL`, a listed route). The listener is declared in NativeBootstrap, not `src/lib/native/`, because that folder is Tushar's (section 28). |
| The QR itself | `ptmFeedbackUrl` uses `buildAppUrl`, so an app build **must** set `VITE_PUBLIC_URL=https://www.salci.org`, as the build recipe above does. Without it, a QR shown in the app reads `https://localhost/...`, which opens nothing on another phone. |

Adding another link: add its route to `APP_LINK_ROUTES` in `src/lib/appLinks.ts` and the same path
to the intent filter, in one change.

**Decided with Naman, 2026-09-29: the website form is the only fallback.** No "Open in the SALCI app"
button (it would only help a phone that installed the APK before the deploy, and a reinstall fixes
that), and the QR never points at the APK file: a downloaded APK needs "Install unknown apps" on the
family's phone, the new install does not know which meeting it came from, and a family with the app
would download it again on every scan. Revisit when the app is on the Play Store.

**Signing keys in `assetlinks.json`.** The app is not on the Play Store: schools get the APK
directly (Naman, 2026-09-29), and that APK is the debug build from this Mac, so the file lists:

1. **The debug key** (`~/.android/debug.keystore`, SHA-256 `57:A2:B5:...:1F:FD`), which signs every
   APK shared with schools so far. Listing it adds no real risk: the file trusts only the package
   `org.salci.app` signed with it, and whoever holds this key can already ship an update over the
   schools' installs. That is the risk to manage: **back the keystore up.** If it is lost (a new
   Mac, a reinstalled Android Studio), no later APK installs over the current ones, and every
   school phone has to uninstall the app first.
2. **The upload key** (`2A:27:8D:...:95:46`), which signs `assembleRelease` / `bundleRelease` builds
   (password in the gitignored `keystore.properties`). Moving schools to release APKs means one
   uninstall per phone (a different key cannot update an installed app); the file already covers it.

3. **The Play upload key made on 2026-09-30** (`02:5F:8C:...:5D:6F`, on Tushar's Windows PC). The
   `2A:27:8D` key above was made on the Mac but never handed over, so this one signs every `.aab`
   uploaded to Play.
4. **The Play App Signing key** (`93:51:18:...:49:B6`), added 2026-09-30. Play re-signs every
   install from the store with it, so this is the entry that makes the link work for Play installs.
   Find it in Play Console, the app, Protected with Play, Play app signing, "Classical key" SHA-256
   (the older Test and release, Setup, App signing path has moved).

**When it starts working, and the rollout order.** Only once `assetlinks.json` is live on
www.salci.org (Tushar's deploy). Android checks the file when the app is installed, so **share the
new APK with schools after the deploy is live**, not before. A phone that installed it earlier keeps
opening the browser until the APK is reinstalled or re-verified:

```
adb shell pm verify-app-links --re-verify org.salci.app
adb shell pm get-app-links org.salci.app      # www.salci.org should read "verified"
```

Google's checker for the hosted file:
`https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://www.salci.org&relation=delegate_permission/common.handle_all_urls`

**Testing before the deploy.** Hand the link to the app directly:

```
adb shell am start -W -a android.intent.action.VIEW -d "https://www.salci.org/ptm/feedback/<token>" org.salci.app
```

or approve the link once on the phone (Settings, Apps, SALCI, Open by default, Add link,
www.salci.org) and scan the QR with the camera.

**iOS is not possible yet.** Universal Links need the paid Apple team. When it exists: the
Associated Domains capability `applinks:www.salci.org` in the shell,
`public/.well-known/apple-app-site-association` naming `<TEAM_ID>.org.salci.app` with the component
`/ptm/feedback/*`, and a `vercel.json` header that serves that extension-less file as
`application/json` (NEEDS CORE, Tushar). The shell's `SceneDelegate` already forwards universal
links to the App plugin, and the web side is shared, so nothing else changes. A free personal team
cannot carry the capability: adding it earlier stops iPhone builds from signing.

## Push notifications

The website uses Web Push: a Database Webhook on `notifications` INSERT calls the
`send-web-push` edge function, which reads `push_subscriptions` and sends with VAPID. A WebView
has no usable PushManager, so the app uses the platform services (FCM on Android, APNs on iOS)
through `@capacitor/push-notifications` (installed in the shell 2026-09-17).

What the repo already has (app side, complete):

- `src/lib/native/push.ts`: permission, device token (`registerForPush`, with a 15s bound),
  `unregisterFromPush`, `onPushEvents` (foreground receive + tap), `pushTargetUrl` (only
  same-app `/paths` from `data.url` are honoured).
- `src/lib/pushDevices.ts`: stores the token for the signed-in user in `push_devices` (token is
  the conflict key, so re-registration and a second user on the same phone update one row) and
  drops it again; remembers the token locally so sign-out can delete the row.
- `NativeBootstrap`: registers after sign-in (prompts the OS once; skips users who switched push
  off in Settings), refreshes the bell on a foreground message, navigates to `data.url` on tap.
- `AuthContext.signOut`: deletes this phone's row first, bounded to 2.5s.
- `SettingsPage`: on native the "Push Notifications" toggle drives the above instead of the
  browser flow, with phone-specific copy for blocked / unsupported.

**Android push is live end to end (proven on a real handset 2026-09-18).** What landed:

| Who | Step | Status |
|---|---|---|
| Tushar | `public.push_devices` + the `register_push_device` RPC (`e9dc0f79`, migration 20260918120000). The client calls the RPC; `user_id` is stamped server-side and a second user on a shared phone takes the row over. | done |
| Tushar | `send-push` edge function (`e584c774`): FCM HTTP v1, `notification` + `data.url`, dead tokens deleted, driven by a second Vault-backed trigger on `notifications` INSERT beside the web one. | done |
| Naman | Firebase project `salci-app-535ce`, Android app `org.salci.app`, `google-services.json` in `~/salci-app-shell/android/app/`. The APK carries FCM (about 18 MB now). | done |
| Tushar | iOS needs the paid Apple Developer team: enable the Push Notifications capability on the app id, create an APNs auth key, upload it to the Firebase project, then add the iOS app and `GoogleService-Info.plist` to `~/salci-app-shell/ios/App/App/`. A personal (free) team cannot carry the push entitlement, so iOS push waits for this. | open |

Verified 2026-09-18 on an Android phone: Settings toggle on, task assigned from the website,
system notification arrived with the app in the background. Repeat that as the smoke test after
any change to `push.ts`, `pushDevices.ts`, the shell plugins or `send-push`. Sign-out should
still remove the `push_devices` row.

## Lessons from the first phone test (2026-09-17)

- **Entry bundle was 6.7 MB** because App.tsx imported ~70 pages eagerly; a phone parsed all of
  it before the login appeared. Every page except the five public ones is now `lazy()` behind
  one Suspense boundary; the entry is about 1.1 MB. Keep it that way: new pages are lazy.
- **Fonts blocked rendering**: three Google Fonts `@import`s at the top of `index.css` held back
  every rule until the network answered, so the app showed unstyled for seconds. Fonts now load
  after first paint from `src/lib/fonts.ts`.
- **`dvh` needs a `vh` fallback** on older Android WebViews; `index.css` has an `@supports not`
  block for the three utilities used.
- **iOS safe areas were zero** without `viewport-fit=cover`; added at boot on native.
- **"Very large text" and "the whole app is white"** (second test, same day): the web type
  scale plus Android's textZoom, and a 98%-white floor under 10 to 18% gradient tints. Fixed
  app-only, see "The app-only look" above.
- **"One minute on every tap"** after the app came back from the background. supabase-js runs
  `auth.getSession()` before every REST call, under a lock shared by the whole app, and refreshes
  an expired token over the network while holding it; nothing had a timeout. iOS keeps a dead
  keep-alive socket across a background stint and reuses it, so the first request hung for the
  OS's 60-second limit and every other request queued behind the lock. `client.ts` now bounds
  auth (10s) and REST (20s) requests, leaving edge functions and storage unbounded, and inside the
  shell swaps the Web Locks lock for auth-js's in-process `processLock` (one WebView, no tabs).
- **Every screen change was a skeleton** for as long as the network took. Two causes: the
  query cache's 5-minute `gcTime` evicted a screen's data soon after you left it, and iOS kills
  the WebView in the background so every return was a cold start with an empty cache. Now
  `gcTime` is a day and `src/lib/queryPersist.ts` restores the last snapshot from localStorage
  before the first render (bound to the signed-in user, cleared on sign-out, never for exam-time
  keys, `staleTime: 0`, or data that is not plain JSON: a Set, Map or Date would come back as `{}`
  or a string, which is what crashed /school/attendance on 2026-09-18). A hook opts out with
  `meta: { persist: false }`. Each query's
  `staleTime` still decides when it refetches; the data is only shown sooner. The lazy-page
  Suspense boundary also moved inside `AppLayout`, so a chunk download no longer blanks the app bar.
- **Scrolling "vibrated" on Android** (the page moved in steps and the pinned bars shook):
  `.surface-gradient` painted the page backdrop with `background-attachment: fixed`, which makes
  Chromium and WebKit scroll the whole page on the main thread (a "slow repaint object") and
  repaint the gradient every frame. The glows are now anchored to the page instead; nothing in
  `index.css` may use `fixed` attachment. That alone did not stop the dashboard tab strip
  shaking, so the strip now also carries `will-change: transform` (its own compositor layer, the
  one thing the never-shaking app bar had that it lacked). Still shaking after that: record the
  screen and trace it in an emulator before guessing again.
- **The app bar is not pinned in the app** (asked 2026-09-17): `AppLayout` renders it in flow on
  native, so it scrolls off with the page and `--app-bar-offset` is only the status-bar inset
  there; pinned strips take the top edge below the clock (the app is edge to edge, so a strip
  pinned at 0 sat under the status bar). A strip flush under the app bar adds `native-status-scrim`
  to paint its surface behind the status bar once pinned. Pinned tab strips and filter rows use
  `.tab-strip-frost`, never `.app-bar-frost`:
  the native block restyles `.app-bar-frost` as the teal app bar and the strip turned teal with it.

## Still to do

- App Links: the PTM feedback QR is claimed on Android (2026-09-29, "App links" above) and starts
  working once `assetlinks.json` is live; share the new APK after that. Add the Play App Signing
  key when the app goes on the Play Store. Still open: the password-reset email, and iOS Universal
  Links (paid Apple team, Team ID, the association file, a `vercel.json` header).
- Push notifications: Android live (2026-09-18); iOS waits on the paid Apple team and APNs key,
  see "Push notifications" above.
- Store submission (spec Phase 4). Move the shell into the repo once root files are approved.
