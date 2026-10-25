import { useMemo } from "react";
import { addDays, format, startOfWeek } from "date-fns";
import { CalendarClock, CalendarX2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import TimetableGridV2 from "@/components/timetable-v2/TimetableGridV2";
import { currentAcademicYear } from "@/hooks/useAcademicCalendar";
import { useStudentWeekV2, useCalendarWindowV2, type Weekday } from "@/hooks/useTimetableV2";
import { useClassProjection } from "@/hooks/useSyllabusProgress";

import { PageShell, PageHeader } from "@/components/shared/page";

// --------------------------------------------------------------
// StudentWeekPageV2 — read-only weekly grid of the student's own
// class. Hidden unless the class's tt_class_structure row is
// publish_status='published' (enforced both by the hook and by RLS
// on tt_slots). Notes are never rendered for students.
// --------------------------------------------------------------

export default function StudentWeekPageV2() {
  const academicYear = currentAcademicYear();
  const query = useStudentWeekV2(academicYear);
  const data = query.data;
  const calendarWindow = useCalendarWindowV2(
    academicYear,
    data?.structure?.working_days ?? null,
  );

  // Auto-timeline overlay for the CURRENT real week (grid is weekly-recurring).
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const fromIso = format(weekStart, "yyyy-MM-dd");
  const toIso = format(addDays(weekStart, 6), "yyyy-MM-dd");
  const projection = useClassProjection(
    data?.classId ? { classId: data.classId, fromIso, toIso } : null,
  );
  const chapterOverlay = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projection.data ?? []) m.set(p.slot_id, p.topic_name);
    return m;
  }, [projection.data]);

  // Real dates for the week on screen. The grid is a weekly-recurring template,
  // so without these a student sees "Thu" with no way to tell which Thursday.
  const weekDates = useMemo(() => {
    const order: Weekday[] = [
      "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    ];
    const map = new Map<Weekday, Date>();
    order.forEach((d, i) => map.set(d, addDays(weekStart, i)));
    return map;
  }, [weekStart]);

  // getDay() is 0=Sunday; the order above is Monday-first.
  const todayWeekday: Weekday = ([
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  ] as Weekday[])[(new Date().getDay() + 6) % 7];

  const subtitle = data?.className
    ? `${data.classSection ? `${data.className} – ${data.classSection}` : data.className} · ${academicYear}`
    : academicYear;

  return (
    <PageShell>
      <PageHeader
        icon={<CalendarClock className="h-5 w-5" />}
        title="My week"
        subtitle={subtitle}
      />

      {query.isLoading ? (
        <Skeleton className="h-[400px] w-full rounded-2xl" />
      ) : query.isError ? (
        /* Error state renders BEFORE the empty state. A failed query resolves
           with data undefined, which used to fall through to "you aren't
           enrolled in a class" and send the student to their admin to fix a
           problem that did not exist (CLAUDE.md §6). */
        <Alert variant="destructive">
          <AlertTitle className="flex items-center gap-2">
            <CalendarX2 className="h-4 w-4" />
            Couldn&apos;t load your timetable
          </AlertTitle>
          <AlertDescription>
            Something went wrong while loading it, so this is not a sign that
            anything is missing from your class. Please try again in a moment.
          </AlertDescription>
        </Alert>
      ) : !data || !data.classId ? (
        <Alert>
          <AlertTitle className="flex items-center gap-2">
            <CalendarX2 className="h-4 w-4" />
            You aren&apos;t enrolled in a class for {academicYear} yet
          </AlertTitle>
          <AlertDescription>
            Ask your school admin to add you to a class.
          </AlertDescription>
        </Alert>
      ) : data.publishStatus !== "published" ? (
        <Alert>
          <AlertTitle className="flex items-center gap-2">
            <CalendarX2 className="h-4 w-4" />
            Timetable not published yet
          </AlertTitle>
          <AlertDescription>
            Your school is still setting up the timetable. It&apos;ll show here
            as soon as it&apos;s published.
          </AlertDescription>
        </Alert>
      ) : !data.structure ? (
        <Alert>
          <AlertTitle>No period structure configured</AlertTitle>
          <AlertDescription>
            Ask your school admin to finish setting up the timetable.
          </AlertDescription>
        </Alert>
      ) : (
        <TimetableGridV2
          structure={data.structure}
          slots={data.slots}
          calendarWindow={calendarWindow.data ?? null}
          readOnly
          chapterOverlay={chapterOverlay}
          weekDates={weekDates}
          todayWeekday={todayWeekday}
          colorBy="subject"
          hideMissingTeacher
        />
      )}
    </PageShell>
  );
}
