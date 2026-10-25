import { useMemo, useState } from "react";
import { startOfDay } from "date-fns";
import { CalendarPlus, CalendarX2, ChevronLeft, ChevronRight } from "lucide-react";

import { PageShell, PageHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/surfaces";
import { ApplyLeaveSheet } from "@/components/attendance/ApplyLeaveSheet";
import { LeaveReviewList } from "@/components/attendance/LeaveReviewList";
import { useMyLeaveRequests, useCancelLeave, LEAVE_PAGE_SIZE } from "@/hooks/useStudentLeave";
import { useInstitutionAcademicYears, useStudentClass } from "@/hooks/useStudentAttendanceTab";
import { useUserRole } from "@/hooks/useUserRole";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { formatClassName } from "@/lib/utils";

/**
 * Student-facing Leave Application destination (sidebar: Records → Leave Application).
 *
 * The apply + withdraw flows already existed as sheets buried behind two buttons
 * on StudentAttendancePage, where "Track Leaves" only appeared once a student had
 * at least one request. This page is the addressable home for the same flows and
 * reuses the SAME hooks and components, so there is one write path, not two.
 */
export default function StudentLeavePage() {
  const [page, setPage] = useState(0);
  const [applyOpen, setApplyOpen] = useState(false);

  // Which academic year is the student in right now? The hook guarantees the
  // current AY is present even when the school hasn't configured its row yet.
  const years = useInstitutionAcademicYears();
  const academicYear = useMemo(() => {
    const opts = years.data ?? [];
    const today = startOfDay(new Date());
    return (opts.find((y) => y.start <= today && y.end >= today) ?? opts[0])?.code ?? "";
  }, [years.data]);

  const studentClass = useStudentClass(academicYear);
  const { data: roleInfo } = useUserRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);

  const list = useMyLeaveRequests(page);
  const cancel = useCancelLeave();

  const rows = list.data ?? [];
  // The query is range()-bounded, so a full page is the only "there may be more"
  // signal available without an extra count round-trip. Deliberate (§23).
  const hasNext = rows.length === LEAVE_PAGE_SIZE;
  const hasPrev = page > 0;

  const subtitle = studentClass.data
    ? [
        formatClassName(studentClass.data.className, studentClass.data.classSection),
        academicYear,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Request time off and track approvals";

  return (
    <PageShell>
      <PageHeader
        icon={<CalendarPlus className="h-5 w-5" />}
        title="Leave Application"
        subtitle={subtitle}
        primaryAction={{
          label: "Apply for leave",
          icon: <CalendarPlus className="h-4 w-4" />,
          onClick: () => setApplyOpen(true),
          disabled: !studentClass.data,
        }}
      />

      {list.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-card" />
          ))}
        </div>
      ) : list.isError ? (
        /* Error BEFORE empty (CLAUDE.md §6): a failed read must never read as
           "you have no leave requests". */
        <EmptyState
          icon={<CalendarX2 className="h-5 w-5" />}
          tone="rose"
          title="Couldn't load your leave requests"
          description="Please try again in a moment."
        />
      ) : !studentClass.data && !studentClass.isLoading ? (
        <EmptyState
          icon={<CalendarX2 className="h-5 w-5" />}
          title="You're not enrolled in a class yet"
          description="Ask your school admin to add you to a class. You'll be able to apply for leave once that's done."
        />
      ) : (
        <div className="space-y-4">
          <LeaveReviewList
            rows={rows}
            variant="student"
            onCancel={(id) => cancel.mutate(id)}
            busyId={cancel.isPending ? cancel.variables ?? null : null}
            emptyLabel={page > 0 ? "Nothing on this page" : "No leave requests yet"}
          />

          {(hasPrev || hasNext) && (
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                disabled={!hasPrev}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Newer
              </Button>
              <span className="text-xs text-ink-500">Page {page + 1}</span>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                disabled={!hasNext}
                onClick={() => setPage((p) => p + 1)}
              >
                Older <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </div>
      )}

      <ApplyLeaveSheet
        open={applyOpen}
        onOpenChange={setApplyOpen}
        classId={studentClass.data?.classId ?? null}
        institutionId={institutionId}
      />
    </PageShell>
  );
}
