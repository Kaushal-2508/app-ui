import * as React from "react";
import { Users } from "lucide-react";

import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { useInstitutionClassGroups, useClassGroupSections } from "@/hooks/useClassGroups";

// =============================================================
// Shared "Classes › Class › Section" picker steps.
//
// UpdateRollNumberSheet, UpdateClassSectionSheet and
// UpdateOptionalSubjectSheet all open on the same two-step drill-down
// before reaching their own students list. The steps live here once so
// a fix to the class grid, the wing-scoped filtering or the breadcrumb
// reaches all three sheets. Each sheet keeps its own StudentsStep.
// =============================================================

export interface ClassStepProps {
  institutionId: string | null;
  /** Wing-scoped coordinators: only class groups with at least one of these
   *  section ids are shown, and the section count reflects the visible ones. */
  allowedClassIds?: string[] | null;
  /** Empty-state copy when the institution has no classes yet, e.g.
   *  "Use Manage Classes to add a class before moving students." */
  emptyDescription: string;
  onPick: (classGroupId: string, classGroupName: string) => void;
}

export function ClassStep({
  institutionId,
  allowedClassIds,
  emptyDescription,
  onPick,
}: ClassStepProps) {
  const { data, isLoading, isError } = useInstitutionClassGroups(institutionId);

  const allowedSet = allowedClassIds ? new Set(allowedClassIds) : null;
  const visible = allowedSet
    ? (data ?? []).filter((cg) => cg.section_ids.some((id) => allowedSet.has(id)))
    : (data ?? []);

  if (isLoading) {
    return <div className="p-6 text-sm text-ink-600">Loading classes…</div>;
  }
  if (isError) {
    return (
      <EmptyState
        icon={<Users className="h-7 w-7" />}
        title="Couldn't load classes"
        description="Please close this and try again."
        reason="error"
      />
    );
  }
  if (visible.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-7 w-7" />}
        title="No classes set up yet"
        description={emptyDescription}
        reason="noData"
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map((cg) => {
        const count = allowedSet
          ? cg.section_ids.filter((id) => allowedSet.has(id)).length
          : (cg.section_count ?? 0);
        return (
          <button
            key={cg.id}
            type="button"
            onClick={() => onPick(cg.id, cg.name)}
            className="surface-card frosted-shadow rounded-card p-4 text-left transition hover:-translate-y-0.5 hover:shadow-card-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            <p className="eyebrow">Class</p>
            <p className="mt-1 text-lg font-semibold text-ink-900">{cg.name}</p>
            <p className="mt-2 text-sm text-ink-600">
              {count} section{count === 1 ? "" : "s"}
            </p>
          </button>
        );
      })}
    </div>
  );
}

export interface SectionStepProps {
  classGroupId: string;
  classGroupName: string;
  allowedClassIds?: string[] | null;
  onBack: () => void;
  onPick: (classId: string, label: string) => void;
}

export function SectionStep({
  classGroupId,
  classGroupName,
  allowedClassIds,
  onBack,
  onPick,
}: SectionStepProps) {
  const { data, isLoading, isError } = useClassGroupSections(classGroupId);

  const allowedSet = allowedClassIds ? new Set(allowedClassIds) : null;
  const visible = allowedSet
    ? (data ?? []).filter((sec) => allowedSet.has(sec.id))
    : (data ?? []);

  return (
    <>
      <PickerBreadcrumb
        items={[{ label: "Classes", onClick: onBack }, { label: classGroupName }]}
      />
      {isLoading && <div className="p-6 text-sm text-ink-600">Loading sections…</div>}
      {isError && (
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          title="Couldn't load sections"
          description="Please go back and try again."
          reason="error"
        />
      )}
      {!isLoading && !isError && visible.length === 0 && (
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          title="No sections in this class"
          description="Add a section under Manage Classes first."
          reason="noData"
        />
      )}
      {!isLoading && !isError && visible.length > 0 && (
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((sec) => {
            const label = sec.section ? `Section ${sec.section}` : sec.name;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => onPick(sec.id, label)}
                className="surface-card frosted-shadow rounded-card p-4 text-left transition hover:-translate-y-0.5 hover:shadow-card-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
              >
                <p className="eyebrow">{classGroupName}</p>
                <p className="mt-1 text-lg font-semibold text-ink-900">{label}</p>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

export interface PickerBreadcrumbProps {
  items: { label: string; onClick?: () => void }[];
  /** Optional control pinned to the right of the trail (e.g. Auto assign). */
  trailing?: React.ReactNode;
}

export function PickerBreadcrumb({ items, trailing }: PickerBreadcrumbProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center gap-1 px-4 pt-4 text-sm text-ink-600"
    >
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <React.Fragment key={`${item.label}-${idx}`}>
            {item.onClick && !isLast ? (
              <button
                type="button"
                onClick={item.onClick}
                className="rounded px-1 py-0.5 font-medium text-brand-primary hover:bg-brand-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
              >
                {item.label}
              </button>
            ) : (
              <span className={isLast ? "font-semibold text-ink-900" : ""}>{item.label}</span>
            )}
            {!isLast && (
              <span className="text-ink-400" aria-hidden>
                ›
              </span>
            )}
          </React.Fragment>
        );
      })}
      {trailing && <div className="ml-auto">{trailing}</div>}
    </nav>
  );
}
