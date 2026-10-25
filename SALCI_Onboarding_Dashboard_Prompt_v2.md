# SALCI — In-App Onboarding Progress Dashboard

## What This Feature Does

Right now the Admin Command Center has a button that downloads the onboarding report as an Excel file. We want to add a "View Dashboard" button next to it that opens a live in-app dashboard instead — same data, but rendered as a visual report with insights, so the admin can take action directly without leaving the app.

---

## Before Writing Anything

1. Find the existing Excel export logic in the Command Center. The query that computes onboarding milestone status per teacher already exists — read it fully before touching anything.
2. Read the existing hook patterns in the hooks folder to understand how institution-scoped Supabase queries are structured.
3. Read the existing dashboard components to understand how pages are composed.
4. Check App.tsx for how protected routes are registered.
5. Check the Supabase types file for exact table and column names before assuming any schema.

---

## Data Model

The dashboard needs 5 boolean milestones per teacher:
- First task created or received
- First task completed
- First study material uploaded
- First exam published
- First result validated or published

From these, derive:
- Steps completed (0–5)
- Completion percentage
- Whether journey is fully complete

This computation already exists in the Excel export. Reuse it exactly.

---

## New Database Table Needed

To show day-over-day changes, we need to persist a daily snapshot per institution. The snapshot stores:
- Date
- Institution ID
- Summary counts (total teachers, fully complete, avg completion %, each milestone count)
- Full per-teacher data as JSON (so we can compare individual teacher progress across days)
- Unique constraint on institution + date so it auto-upserts

On every dashboard load: check if today's snapshot exists. If not, compute and save it. Then fetch yesterday's (or most recent prior) snapshot for delta calculation. Delta = today minus yesterday for every metric.

Flag this migration for manual review before applying — do not auto-run on production.

---

## Application Flow

### Entry Point
In the Command Center, the existing Excel download button stays untouched. Add a new "View Dashboard" button next to it that navigates to the new dashboard route.

### Route
New protected route accessible only to school_admin and super_school_admin roles. Follows the same route protection pattern as other school admin pages.

### Page Load Sequence
1. Fetch current teacher onboarding data for the institution (reuse existing query)
2. Check if today's snapshot exists in the new table
3. If no snapshot → save one now using the freshly fetched data
4. Fetch yesterday's snapshot for comparison
5. Compute deltas (today minus yesterday) for every metric
6. Render the dashboard

---

## What the Dashboard Shows

Work through these sections top to bottom. Each section feeds into the next.

### Summary Banner
Top-level numbers at a glance: total teachers, how many are fully done, average completion percentage, when the report was generated.

### Delta Bar
A single bar showing what changed since yesterday: fully complete count, average %, each milestone count. If no prior snapshot exists, show "First report" and skip deltas. If deltas exist, surface a callout based on the magnitude of change.

### Alert Cards
Conditionally rendered based on real data. Compute these conditions:
- Is any teacher at 0% and has been for more than one snapshot? → escalation alert with their name and how many days
- Are there teachers at 80% (one step away from done)? → action alert with the count
- Is study material or result validation below a meaningful threshold? → bottleneck alert
- Did avg completion jump significantly today? → positive momentum alert
Only show alerts that are actually true. Do not hardcode copy.

### KPI Cards
Six key numbers: fully complete, average completion %, in-progress count, stuck at one step only, study material uploaded count, result validated count. Each shows its delta badge if prior snapshot data exists.

### Progress Trend
If multiple snapshots exist: a chart showing fully complete count and average % over time by date. If only one snapshot (today): show a single-day summary card instead. Use the charting library already in the project.

### Distribution + Milestone Funnel
Two panels side by side. Left: breakdown of how many teachers are at each tier (100%, 80%, 60%, 40%, 20%, 0%) as a visual proportion. Right: the 5 milestones as a funnel showing count and % who have cleared each one, with delta badges where available.

### Completed Teachers
List of all teachers who have reached 100%. Teachers who crossed 100% today (identifiable by comparing today's snapshot to yesterday's) get a "New today" indicator.

### Per-Teacher Table
Every teacher in one filterable, searchable table. Columns: name, email, all 5 milestones as yes/no, progress bar, completion %. Filters: search by name or email, filter by completion tier, filter by which specific milestone is missing. Row count updates dynamically with filters.

### Pending Tasks Grid
Only teachers below 100%. One card per teacher showing which steps are done and which are still pending. Cards at 80% (one step away) get a "close today" indicator. Cards at 0% for multiple days get a day-count escalation indicator.

---

## Print Support
Add a print action that calls window.print(). When printing: hide navigation, sidebar, filter controls. Show all data without truncation. Clean white output suitable for sharing in a meeting.

---

## What Not To Do
- Do not duplicate the onboarding data query — find the existing one and reuse it
- Do not remove or modify the existing Excel download button
- Do not auto-apply the snapshot table migration on production
- Do not add the route without proper role protection
- Do not create UI primitives that already exist in the component library
