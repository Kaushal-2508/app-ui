import { Lock } from "lucide-react";

import { useProfileData } from "@/hooks/useProfileData";
import { formatClassName } from "@/lib/utils";
import {
  useTeacherClassSubjects,
  useTeacherHeader,
} from "@/hooks/dashboard/useTeacherDashboardData";

/**
 * Spec 2.1 — the teacher dashboard banner.
 *
 * Built on `.hero-card` (the Achievements hero system) with a new
 * `--brand` tone that runs the existing teal stop into the existing violet
 * stop, so it introduces no colour and inherits both :root and .dark values.
 *
 * DESIGN-SYSTEM NOTE: checklist rule 14 says never use HeroCard as a
 * page-spanning top banner. That rule was written about ROLE DASHBOARDS
 * (/dashboard), where a banner pushed the greeting and work tiles below the
 * fold, and the shipped Achievements PlayerCard is itself a full-width hero.
 * /school/snapshot is not a role dashboard and has no greeting-pattern
 * obligation, and the banner is the owner-approved mockup. Flagging rather than
 * breaking it silently, per the skill's closing rule.
 *
 * The chips are a LEGEND, not a filter: they state the (class, subject) pairs
 * this page is scoped to. Enforcement lives in dash_resolve_scoped_pairs().
 */
export function TeacherDashboardBanner({ institutionName }: { institutionName: string }) {
  const { data: profile } = useProfileData();
  const { data: meta } = useTeacherHeader();
  const { data: subjectData } = useTeacherClassSubjects();

  const firstName = profile?.full_name?.split(" ")[0] ?? "there";
  const pairs = subjectData?.pairs ?? [];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const subline = [meta?.wing_name, meta?.academic_year && `Academic Year ${meta.academic_year}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="hero-card hero-card--brand p-5 sm:p-6">
      <div className="relative z-10">
        <p className="hero-eyebrow">
          Teacher dashboard · {institutionName}
        </p>
        <h1 className="mt-1.5 text-[26px] font-bold leading-tight tracking-tight sm:text-[32px]">
          {greeting}, {firstName}
        </h1>
        {subline && <p className="mt-1 text-sm text-white/85 sm:text-[15px]">{subline}</p>}

        {pairs.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-white px-3.5 py-1.5 text-[13px] font-semibold text-[hsl(var(--hero-to))]">
              All my classes
            </span>
            {pairs.map((p) => (
              <span
                key={`${p.class_id}:${p.subject_id}`}
                className="rounded-full bg-white/20 px-3.5 py-1.5 text-[13px] font-medium text-white"
              >
                {p.subject_name} · {formatClassName(p.class_name, p.section)}
              </span>
            ))}
          </div>
        )}

        <p className="mt-4 flex items-start gap-2 text-[13px] leading-[18px] text-white/85">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          This page only ever shows your own assigned classes, subjects and students. Nothing
          school-wide, and no other teacher&apos;s data.
        </p>
      </div>
    </section>
  );
}
