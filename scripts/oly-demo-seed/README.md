# Olympiad Demo Seed — "New Flow Demo" (NEW00A)

Seeds a complete demo environment for the olympiad school-admin + student flows
on prod (`gyymkgohcijeksmrzuyw`), school `edec11b2-2604-4e58-bfdb-2dfa05f8d3a1`
(institution "New Flow Demo"). The 2026 campaign is a TEST campaign — every
school in it is a test school, so upgrading the shared catalog is safe.

Applied 2026-06-11. End state: exam conducted on 2026-06-08, results published
2026-06-10, school status `results_published` (stepper stage 4).

## What was seeded

| Layer | Contents |
|---|---|
| Catalog (`01-catalog.sql`) | Subjects renamed (dfdfdf→Mathematics, rttrtr→Science, Test Exam→General Knowledge, English 2→English Language), 5 real syllabus topics per subject×grade (30 total), all 60 questions rewritten as real MCQs with topic links |
| Study material (`02-study-materials.ps1`) | 12 PDFs (2 per subject×grade) generated + uploaded to `olympiad-study-material`, rows in `oly_study_materials` |
| School (`03-school-seed.sql`) | 2 teachers (auth+profiles+roles+class assignments), 24 students (13×C9, 11×C10) with real auth users, 24 paid `oly_enrollment_pending` rows (₹500+₹90 GST each = ₹14,160), 3 completed batches with plaintext PINs, 21 submitted attempts (630 snapshot questions + 630 answers), 24 ranked `oly_results` (3 gold / 5 silver / 8 bronze / 5 participation / 3 absent), completed publish job, audit trail, school → `results_published` |
| PDFs (`04-pdfs.ps1`) | 24 receipts (`{student_id}.pdf` + `oly_receipts` rows), 21 result PDFs (`results/{result_id}.pdf`), 21 certificates (`certificates/{result_id}.pdf`) in `olympiad-receipts` bucket |
| Verify (`05-verify.sql`) | Runs `oly_school_report` as the school admin via JWT-claim simulation + integrity checks |

## Demo credentials

- School admin: `new.flow.admin@salci.in` (existing account, untouched)
- Teachers: `anjali.mehra@newflowdemo.salci.in`, `rohan.verma@newflowdemo.salci.in` — password `Demo@2026`
- Students: olympiad student login = roll number + DOB. Example: roll
  `SO26-NEW00A-09-0001` (Aarav Sharma), DOB 14/03/2011, password `140311`
  (DDMMYY). Roll numbers run `SO26-NEW00A-09-0001..0013` and `-10-0001..0011`.
- Batch PINs (exam already completed): `XK7P2M`, `T9WQ4R`, `B3NHL8`
- Absentee-pool students (unassigned): Dhruv Malhotra (C9), Arnav Chawla (C10);
  no-show with batch: Kunal Bhatt (C10)

## Re-run / rollback

- `03-school-seed.sql` is re-runnable: it wipes all school rows + previous demo
  auth users first (tracked in `salci_backups.oly_demo_seed_nfd`), then rebuilds.
- Full rollback: run only the cleanup block (§1) of `03-school-seed.sql`, then
  delete the `oly_study_materials` rows + bucket objects and revert the school
  row (`status='enrollment_open'`, pc_count/city/state/enrollment_closes_at null).
- Catalog renames/questions are upgrades, not demo-scoped — leave them.

All queries run via `mgmt-query.ps1` (Supabase Management API; PAT from Windows
Credential Manager "Supabase CLI:supabase"). Storage uploads use the service
role key fetched live from the Management API — nothing secret is stored here.
