# Admissions module

Enquiry to admission, the way the schools run it (Naman, 2026-10-09): a parent **enquires**, pays
the **registration** fee (Rs 1000 today) and is saved as registered for as long as it takes, then
comes with the filled physical form for the **admission**, where the receptionist types the data,
ticks the certificates collected, and the child gets an **admission number** and a student account.
Design, permutations and the full server contract:
[specs/2026-10-09-admissions-module-design.md](superpowers/specs/2026-10-09-admissions-module-design.md).

## State

Frontend built on `naman-erp` on 2026-10-09 behind a schema probe (`admission_settings` exists):
until Tushar's migration lands, `/school/admissions` shows "Admissions switches on soon" and the
public form says the school takes enquiries at the front desk. Every table and RPC is `NEEDS DB`,
the intake function and the `admit_student` action of `admin-operations` are `NEEDS EDGE FN`, and
the two routes (`/school/admissions`, `/enquire/:schoolCode`) are `NEEDS CORE` in `App.tsx`
(section 28: load-bearing file). The feature id `admissions` and the sidebar entry are in place
and gated, so nothing shows until the feature is switched on for a school.

## Who

School admins always; other staff when named in Admissions settings (`admissions_overrides`,
`is_admissions_staff`). Teachers and students never see it. Decided 2026-10-09.

## The pipeline

| Stage | Set by | What the desk sees |
|---|---|---|
| Enquiry | the public form (`source = public_form`) or New enquiry at the desk | child, class applying for (a class group), academic year, parent, phone, follow-up date, notes |
| Registered | Register: fee amount (default from settings), paid by, receipt number, date | the fee line, "registered N days ago", the certificate checklist (ticks saved any time) |
| Admitted | Admit: the physical form, certificates, class and section, admission number, date | admission number and date, the certificates ticked at admission; "Open student" |

| Dropped | Drop with a reason, from Enquiry or Registered | the reason; Reopen puts it back |

Every certificate row also takes a scan (a photo or a PDF, 10 MB) into the private bucket
`admission-documents` at `<school>/<enquiry>/<doc_key>.<ext>`; uploading ticks it, View opens a
short signed link, Replace overwrites, Remove clears it in one RPC (Naman, 2026-10-12).

**The school's own questions (Naman, 2026-10-12: "like we create a google form, different schools
need different things").** Settings has a designer that is a small labelled form per question:
Question, Answer type (Text, Long text, Number, Date, Pick one, Yes / No), Hint (optional), Asked
on (Everywhere, Online form only, At the school only, Admission form only), the Choices of a Pick
one as rows with "Add a choice", and a footer with "Must answer", Move up, Move down and Remove. The questions appear as a last card on New enquiry and on the admit form and inside the
online form, in the designer's order; the record lists the answers by question. Answers are stored
in the enquiry's `form.custom` by question id; a form replaces only the answers of the questions it
asked, so an enquiry edit keeps admission-time answers. Naman asked for it to stay simple ("from a
new person's point of view it is very confusing", then "very simplified like in google form", then "a
little professional, nothing can be understood in this"), so every control carries a label, nothing
hides in a menu, and there is no drag and drop, no sections, no conditional questions.

Admission creates the student in ONE server transaction (`admit_student` → `admission_admit_tx`:
auth user, profile, role, `set_student_class`, personal details, stage). The sheet then shows the
slip: admission number, login (the admission number, or the email when given) and the one-time
password, with Copy and Print. **Admission numbers are auto from a school prefix** (decided
2026-10-09): Settings holds the prefix and the next number, the admit form pre-fills
`<prefix><number padded to 3>` (editable), and the server takes the next free one at commit when
the field was left as pre-filled, so two desks never clash.

## Settings

Registration fee default, admission number prefix and next number, the certificate checklist
(default nine; keys stable, labels free), the school's own questions (`form_schema`), the
admissions staff, and the public form on or off.

## Public form

`/enquire/<school code>` (the Enquiry link sheet shows it as a QR and a copyable address). No login.
It talks only to the `admission-enquiry-intake` edge function (context, then submit), the
platform's one unauthenticated write: rate-limited per IP and per school, with a honeypot field
that silently discards bots. `context` carries the school's online questions; `submit` takes the
`answers` and the function checks the required ones and each answer's shape again. The parent gets
a reference number; the admissions staff get an in-app notification.

## Files

| Where | What |
|---|---|
| `src/lib/admissions.ts` | the pure rules: stages and actions, auto-number preview, academic-year labels, validation, money text |
| `src/hooks/admissions/` | the probe, access, settings, staff, pipeline (50 a page), counts, detail, one mutation per RPC, `useAdmitStudent` |
| `src/pages/school/AdmissionsPage.tsx` | tiles, stage tabs, year and class filters, search, the list, the sheets |
| `src/components/admissions/` | `EnquiryDetailSheet` (centred record), `NewEnquirySheet`, `RegisterSheet`, `AdmitSheet` (+ slip), `DropSheet`, `DocumentChecklist`, `AdmissionSettingsSheet`, `FormDesigner`, `CustomQuestions`, `EnquiryLinkSheet`, `parts` |
| `src/pages/public/EnquiryPage.tsx` | the parent's form |
| `featuresData.ts`, `AppSidebar.tsx` | feature `admissions`, `/school/admissions` mapped and listed under School Management |

## Verification

Node asserts over the rules (`scratchpad/admissions/test-admissions.mjs`, 22 checks) and the
browser harness (`ptm-preview`, scenes `admissions`, `admissions-desktop`, `admissions-off`,
`admissions-staff`, `enquire`, `enquire-off`; 122 checks) at 375px and 1280px, light and dark.
Gate: typecheck, eslint, `vite build`, `test:cache`, stale-import pass.

## Out of scope for v1

Entrance tests and interviews, AI checks of the uploaded scans, fee refunds and posting the
registration fee into Fee Management, SMS or email to the parent, transfers, medical records, alumni.
