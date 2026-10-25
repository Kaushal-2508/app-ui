import { Link } from "react-router-dom";
import { ArrowLeft, Mail, School, UserX } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Public account-deletion page, /delete-account.
 *
 * Google Play requires a web link where users can ask for their account and
 * its data to be deleted (Play Console, Data safety), reachable without the
 * app and without signing in. SALCI accounts are created by schools, so the
 * page sends people to their school admin first and to the support inbox
 * otherwise. It is a public route, so it paints its own backdrop instead of
 * using PageShell, which expects AppLayout's padding around it.
 */

const SUPPORT_EMAIL = "team@salci.in";

const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
  "Delete my SALCI account",
)}&body=${encodeURIComponent(
  "Please delete my SALCI account and its data.\n\n" +
    "Full name:\n" +
    "School name:\n" +
    "Login (email, mobile or admission number):\n" +
    "Role (student, parent, teacher, staff):\n",
)}`;

const DELETED = [
  "Your login and profile: name, email, mobile number and profile photo",
  "Photos you uploaded, such as homework photos and attendance or proctoring snapshots",
  "Voice recordings you left on tasks or in parent-teacher meetings",
  "Your messages, comments and support threads",
  "The push-notification registrations of your devices",
];

const KEPT = [
  "Academic records your school is required to keep, such as marks, report cards and attendance registers, stay with your school as school records.",
  "Copies in our encrypted backups are overwritten within 90 days.",
];

export default function DeleteAccount() {
  return (
    <div className="min-h-dvh pt-safe pb-safe surface-gradient px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <Link
          to="/login"
          className="mb-6 inline-flex items-center gap-2 text-sm text-ink-600 transition-colors hover:text-ink-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to SALCI
        </Link>

        <p className="eyebrow">SALCI · Account deletion</p>
        <h1 className="mt-2 text-[28px] font-bold leading-tight text-ink-900 sm:text-[34px]">
          Delete your SALCI account
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-600">
          SALCI accounts are created and managed by schools. You can ask for your account and the
          personal data linked to it to be deleted in either of the two ways below, whether or not
          you still have the app installed.
        </p>

        <section className="surface-card frosted-shadow mt-6 rounded-card p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-primary/10">
              <School className="h-5 w-5 text-brand-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ink-900">1. Ask your school</h2>
              <p className="mt-1 text-[15px] leading-relaxed text-ink-600">
                Your school admin can remove your account from SALCI. This is the quickest way for
                students, parents and staff.
              </p>
            </div>
          </div>
        </section>

        <section className="surface-card frosted-shadow mt-4 rounded-card p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-primary/10">
              <Mail className="h-5 w-5 text-brand-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-ink-900">2. Email SALCI</h2>
              <p className="mt-1 text-[15px] leading-relaxed text-ink-600">
                Write to <span className="font-medium text-ink-900">{SUPPORT_EMAIL}</span> with your
                full name, your school's name, your login (email, mobile or admission number) and
                "Delete my account". We confirm the request with your school and delete the account
                within 30 days, then reply to tell you it is done.
              </p>
              <Button asChild className="mt-4 w-full sm:w-auto">
                <a href={mailto}>
                  <Mail className="mr-2 h-4 w-4" />
                  Email a deletion request
                </a>
              </Button>
            </div>
          </div>
        </section>

        <section className="surface-card frosted-shadow mt-4 rounded-card p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-primary/10">
              <UserX className="h-5 w-5 text-brand-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-ink-900">What happens to your data</h2>
              <p className="mt-3 text-sm font-semibold text-ink-900">Deleted</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-ink-600">
                {DELETED.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="mt-4 text-sm font-semibold text-ink-900">Kept</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-ink-600">
                {KEPT.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <p className="mt-6 text-sm text-ink-600">
          More about how SALCI handles your data is in our{" "}
          <a
            href="https://www.salci.ai/privacy"
            target="_blank"
            rel="noreferrer"
            className="text-brand-primary hover:underline"
          >
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}
