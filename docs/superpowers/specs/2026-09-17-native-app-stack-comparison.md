# Native app stack: Capacitor or React Native? Decision note for Tushar

**Written by:** Naman's session, 2026-09-17. **Decision owner:** Tushar.
**Decision taken, 2026-09-17: Capacitor now, React Native possibly later.** Tushar first leaned
to React Native, then chose to ship the Capacitor app first (one-day deadline) and revisit a
rewrite afterwards. This note is kept as the record of the comparison; the bar for revisiting
is in section 8.
**Companion:** [2026-09-16-native-app-capacitor-design.md](2026-09-16-native-app-capacitor-design.md), question 10.

Rows and statements marked **(observed)** come from this repo or from work done on 2026-09-16.
Everything about React Native, Expo, Capgo or Ionic is general knowledge and has not been
measured on SALCI.

## 1. Decision requested

Confirm the Capacitor route already in motion, or approve a React Native rewrite as a new repo.
Please decide before Phase 1 root-file work starts (spec question 8); after that the choice
gets expensive to reverse. Naman raised the question after hearing that React Native updates
more easily and looks better. This note checks both claims against SALCI as it is, sizes the
two routes, and recommends one.

The single question that settles it: **is the app the same product as salci.org on a phone,
or a different product?** Same product points to Capacitor. Different product points to
React Native.

## 2. What exists today (observed)

| Item | State on 2026-09-17 |
|---|---|
| Web codebase | 131 pages, 652 components, 295 hooks, about 276,000 lines of TypeScript in `src/`, 65 edge functions |
| Phase 0 of the Capacitor plan | Pushed as `4c1f2fb6` on `naman-erp`: adapter layer `src/lib/native/`, every download, print, external link and origin funnelled through it, safe-area app bar, `dvh` viewport units, exam-integrity listeners behind one adapter. Web behaviour unchanged, typecheck and build clean |
| Shell project | `~/salci-app-shell`, Capacitor 8.5.2, appId `org.salci.app` (provisional), `webDir` pointing at this repo's `dist/`. Kept outside the repo until question 8 is answered, so no root file has changed |
| Android | Debug APK, 13.8 MB, minSdk 24, targetSdk 36, SALCI mark as icon and splash (light and dark) cut from `public/Logo-trim.png`. Installs and boots to the production login |
| iOS | Unsigned Simulator build running on an iPhone 17 simulator; signed build installed on Naman's iPhone 17 Pro with his free personal team through Xcode. Boots to the production login |
| Effort so far | One working day, frontend only, no database or backend change |
| Known gaps in this first build | Downloads, PDF export, print and open-in-new-tab do nothing inside the shell yet (Phase 2 adapters); camera flows fail until permissions and plugins are declared (Phase 1); password-reset email opens the browser, not the app (Phase 2 App Links); no push (Phase 3) |

## 3. Claim 1: "React Native is easier to update"

**What the claim means.** Over-the-air (OTA) updates: shipping a new JavaScript bundle to
installed apps without waiting for App Store or Play review, with the ability to roll a bad
release back and to release to a channel (one school, a test group) before everyone.

**How each stack does it.**

| Capability | Capacitor | React Native |
|---|---|---|
| OTA JavaScript update | Capgo (open source, self-hostable) or Ionic Appflow | Expo Updates (EAS Update) or Microsoft CodePush |
| Rollback | Yes | Yes |
| Channels / staged rollout | Yes | Yes |
| Force a minimum version | `public/app-version.json` gate, already in the spec, stack-independent | Same idea, built in the app |
| Store release still required for | Any native change: new plugin, permission, SDK bump | Any native change: new native module, permission, SDK bump |
| Store policy | JS-only updates allowed on both stores, as long as the app's purpose does not change | Same |
| Effort to add | Days: install the plugin, create the account, add a build step | Part of the Expo setup |

**The asymmetry that is SALCI's, not the tooling's (observed).** The Capacitor app runs the
same build as salci.org. One fix, one build, and it ships to the website and to the app
together; with Capgo it reaches installed phones in minutes. With React Native every fix is
written twice (web and app), tested twice and shipped through two update systems. Over a year
of school-driven bug reports, that doubling is the real cost, not the update mechanism.

**Verdict on claim 1:** equal capability; Capacitor is cheaper to operate for this product.

## 4. Claim 2: "React Native gives a better UI"

**Where React Native is genuinely better** (general knowledge): heavy animation, very long
lists at a constant 60fps, platform-native controls such as the iOS date picker, native
gesture feel, and on low-end Android phones where the system WebView can stutter.

**What SALCI's UI actually is (observed):** forms, lists, cards, dashboards and stat tiles,
exam papers with KaTeX maths and MathLive input, charts, drag-and-drop task boards, PDF and
print output, camera capture. A WebView renders this class of UI as well as native does.
Every page already passes the 375px and dark-mode review, and the login screen on Naman's
iPhone is indistinguishable from the website because it is the website.

**What a React Native rewrite has to rebuild, because none of it runs in React Native
(observed in `package.json` and `src/`):**

| Subsystem | Today | In React Native |
|---|---|---|
| Design system | shadcn/ui on 63 primitives, Tailwind, 980-line token sheet, light and dark themes, 27-point build checklist | New component library, new theming, kept visually identical to the web forever |
| Maths | MathLive editor, KaTeX rendering (`MathText`, `MathPreview`) | No equivalent; WebView embed or a different renderer with different output |
| Charts | Recharts | Replace, re-style every chart |
| Task and support boards | dnd-kit drag and drop | Replace with a native gesture library, re-test every move rule |
| Exports | html2pdf.js, jsPDF, xlsx, exceljs, print pipelines | All replaced with native file and share APIs |
| Camera flows | getUserMedia for proctoring, face attendance, offline scan, hybrid upload; face-api.js | Native camera modules, face recognition re-integrated |
| Motion and onboarding | framer-motion, react-joyride, Lottie | Replace |
| Routing, data, auth | React Router, TanStack Query, Supabase client | TanStack Query and Supabase carry over; routing and every page shell rebuilt |

**What Capacitor can still add to feel native** (planned, Phases 1 to 3): native status bar
and splash, haptics, native share sheet, camera through plugins, Android back-button handling,
safe-area layout (already done), an offline banner, a bottom tab bar if wanted.

**Verdict on claim 2:** for SALCI's screens the two are equal; React Native's advantage is in
kinds of UI SALCI does not have, and it costs the whole design system to get there.

## 5. Effort, cost and timeline

| Criterion | Capacitor | React Native |
|---|---|---|
| Codebases to maintain (observed) | 1: the web build is the app | 2: website and app, every fix twice |
| Time to a store-ready app | Weeks: Phases 1 to 4 of the spec | Months: parity with 131 pages, new repo |
| Proof so far (observed) | APK built; runs on iPhone simulator and Naman's iPhone | None |
| Ongoing cost per feature | 1x | 2x |
| Design system (observed) | Existing, reused | Rebuilt from scratch, second copy kept in sync |
| Maths, charts, boards, PDF and print (observed) | Existing libraries reused | All replaced |
| UI feel: forms, lists, dashboards | Equal | Equal |
| UI feel: heavy animation, huge lists | Weaker | Stronger |
| Apple review risk (guideline 4.2) | Real, cleared by native push, camera, share, safe areas (Phases 1 to 3) | Low |
| Team skills (observed) | React and Tailwind, already in hand | React Native and native tooling, to be learned |
| Team size | Same people as the website | A second front-end effort |
| Offline-first exams on the phone | Possible via plugins, more work | Natural fit |

**Indicative sizing.** Capacitor to store submission: the spec's Phases 1 to 4, roughly 3 to 6
weeks of Naman's time plus Tushar's database and edge-function items for push. React Native
to feature parity: rebuilding 131 pages and the eight subsystems above is a multi-month project
for more than one person, and until parity there is nothing to ship, while the website keeps
changing underneath it. These are estimates, not measurements.

## 6. Longevity

The asset to protect is the working web application. What decides whether the app is still
maintainable in three years:

| Factor | Capacitor | React Native |
|---|---|---|
| Vendor | Ionic (OutSystems), about 10 years, stable API across major versions; the 2026-09-16 setup on version 8 was routine | Meta, plus Expo as a second vendor in practice; a recent multi-year "New Architecture" migration forced library rewrites |
| Exit cost if the framework falls away | Low: the web build runs in any other WebView shell or as an installable PWA within days | High: the app is React Native forever; no cheap exit |
| Dependency surface | The web app's, already maintained for the website | The web app's plus a second tree of native modules |
| Platform policy changes (Apple, Google) | Hit both equally | Hit both equally |
| Who maintains it | Whoever maintains the website | Someone who also knows native build tooling |

## 7. Risks either way

- **Capacitor:** Apple guideline 4.2 ("not just a website"), mitigated by Phases 1 to 3;
  scroll feel on low-end Android WebViews; the exam anti-cheat model is weaker inside a WebView
  (no fullscreen lock on iOS), which the spec addresses with app-state events and a privacy
  screen plugin.
- **React Native:** schedule and duplicate bugs; the LMS on the same Supabase project gains
  nothing; no store-ready artefact until parity; Phase 0 work stays useful for the web only;
  a second team skill set to hire or learn.

## 8. Recommendation

Capacitor now. Add Capgo for over-the-air updates in Phase 1 or 2. Revisit React Native only if
a named screen fails a measured bar on a real phone: exam attempt page scrolling at 60fps on a
Redmi-class device, board drag response under 100 ms, or a store rejection under guideline 4.2
that the planned native features do not clear. One failing screen argues for one native plugin,
not for a rewrite.

If the answer to the question in section 1 is "a different product", choose React Native and
start it as a new repo with its own plan; do not fork this one.

## 9. What Naman needs from Tushar

1. This decision.
2. Spec questions 1, 2 and 8: bundle id, who owns the Apple Developer, Play Console and
   Firebase accounts, and whether Naman may touch the root files or Tushar commits them from
   Naman's patch.
