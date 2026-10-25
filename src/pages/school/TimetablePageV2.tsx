import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Clock,
  FileSpreadsheet,
  Inbox,
  Layers,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUserRole } from "@/hooks/useUserRole";
import { useIsTimetableManager } from "@/hooks/useIsTimetableManager";
import { currentAcademicYear } from "@/hooks/useAcademicCalendar";
import {
  useClassListV2,
  useTimetableV2Wings,
  type ClassListV2Row,
} from "@/hooks/useTimetableV2";
import SettingsSheetV2 from "@/components/timetable-v2/SettingsSheetV2";
import DownloadLessonPlanSheetV2 from "@/components/timetable-v2/DownloadLessonPlanSheetV2";

// --------------------------------------------------------------
// TimetablePageV2 — class-list home view for the rebuilt timetable
// stack. Admins see every class in scope; coordinators see only
// classes in wings they're assigned to (enforced both here AND by
// tt_slots RLS). Status pill reflects tt_class_structure.publish_status:
//   * null            → "Empty"    (no structure attached yet)
//   * 'draft'         → "Draft"    (fills in progress, invisible to teachers/students)
//   * 'published'     → "Published" (live)
// Clicking a card will open the class workspace (built in the
// next slice of Plan 2 — this page currently logs the click only).
// --------------------------------------------------------------

const ALL_WINGS_SENTINEL = "__all_wings__";

type StatusKey = "empty" | "draft" | "published";

function statusKey(row: ClassListV2Row): StatusKey {
  if (!row.publishStatus) return "empty";
  return row.publishStatus === "published" ? "published" : "draft";
}

export default function TimetablePageV2() {
  const { data: roleInfo, isLoading: roleLoading } = useUserRole();
  // Per-user override grant (tt_manager_overrides): full institution-wide
  // timetable management for a named non-admin user — treated as admin here.
  const { isTimetableManager, isLoading: overrideLoading } = useIsTimetableManager();
  const isAdmin = !!(roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin) || isTimetableManager;
  const isCoordinator = !!roleInfo?.isCoordinator;
  const canEdit = isAdmin;

  const academicYear = currentAcademicYear();
  const [wingId, setWingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [openSheet, setOpenSheet] = useState<"structures" | "resources" | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);

  const wingsQuery = useTimetableV2Wings();
  const wings = useMemo(() => wingsQuery.data ?? [], [wingsQuery.data]);

  // Coordinator scoping: pin the class list to the wings the user is
  // assigned to, so they can never see classes outside their scope. Admins
  // pass `null` and continue to see every wing.
  const restrictToWingIds = useMemo<string[] | null>(() => {
    if (!isCoordinator) return null;
    return wings.map((w) => w.id);
  }, [isCoordinator, wings]);

  // A coordinator with zero wing assignments has nothing they're allowed to
  // see — show the "yet to be approved" notification card instead of an
  // empty grid. Wait for the wings query so we don't flash the card.
  const coordinatorBlocked =
    isCoordinator && !wingsQuery.isLoading && wings.length === 0;

  const classListQuery = useClassListV2(academicYear, wingId, restrictToWingIds);
  // Memoize the empty-array fallback so the downstream useMemo's
  // `classes` identity only changes when the actual data changes,
  // not on every render where `data` is still undefined.
  const classes = useMemo(
    () => classListQuery.data ?? [],
    [classListQuery.data],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return classes;
    return classes.filter((c) => {
      const hay = `${c.className} ${c.section ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [classes, search]);

  if (roleLoading || overrideLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!isAdmin && !isCoordinator) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <Alert>
          <AlertTitle>Not available</AlertTitle>
          <AlertDescription>
            The timetable builder is for admins and coordinators. Teachers can
            view their personal schedule from the dashboard.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    // No page padding of its own: PageShell already provides the gutter, and
    // the extra p-4 indented this title to x=28 while every other page sits
    // at 16 (2026-09-18 phone audit).
    <div className="max-w-[1400px] mx-auto space-y-5">
      {/* Header — title + subtitle stay flowing on mobile;
          Resources moves into the controls card below at narrow widths. */}
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2.5 text-ink-900 tracking-tight">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-primary/10 text-brand-primary">
              <CalendarClock className="h-5 w-5" />
            </span>
            Timetable
          </h1>
          <p className="mt-1.5 text-sm sm:text-[15px] text-ink-600">
            Pick a class to fill its weekly grid. Publish when every period has
            a teacher assigned.
          </p>
        </div>

        {/* Lesson-plan export — available to admins AND coordinators (scope is
            resolved server-side). Hidden for a coordinator with no wings yet. */}
        {!coordinatorBlocked && (
          <div className="shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl"
              onClick={() => setDownloadOpen(true)}
            >
              <FileSpreadsheet className="h-4 w-4 mr-1.5" />
              Download Lesson Plan
            </Button>
          </div>
        )}
      </header>

      {/* Coordinator without any wing assignment yet — block the rest of
          the page with a clear notification card. */}
      {coordinatorBlocked && (
        <Card className="border-dashed">
          <CardContent className="p-8 sm:p-10 text-center space-y-3">
            <div className="mx-auto h-14 w-14 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
              <Inbox className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-semibold">
              Time table is yet to be approved by the admin
            </h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              You haven&apos;t been assigned to a wing yet, so there are no
              classes for you to fill in. Once your school admin assigns you a
              wing, the classes will show up here automatically.
            </p>
          </CardContent>
        </Card>
      )}

      {!coordinatorBlocked && (
      <>
      {/* Controls — search and filters. Stacks vertically on mobile,
          row on tablet+. Action buttons (Resources/Structures) sit on
          their own row on mobile so they don't crowd the wing select. */}
      <section className="surface-card frosted-shadow rounded-card p-3 sm:p-4 space-y-3">
        {/* Top row: wing select + search */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {(isAdmin || wings.length > 1) && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs sm:text-sm text-ink-500 shrink-0">Wing</span>
              <Select
                value={wingId ?? ALL_WINGS_SENTINEL}
                onValueChange={(v) => setWingId(v === ALL_WINGS_SENTINEL ? null : v)}
              >
                <SelectTrigger className="h-10 rounded-xl flex-1 sm:w-[180px] sm:flex-none">
                  <SelectValue placeholder={isCoordinator ? "All my wings" : "All wings"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_WINGS_SENTINEL}>
                    {isCoordinator ? "All my wings" : "All wings"}
                  </SelectItem>
                  {wings.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="relative flex-1 min-w-0">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search class or section"
              className="h-10 pl-9 rounded-xl"
            />
          </div>
        </div>

        {/* Action buttons — Structures + Resources in a 2-column grid
            on every breakpoint so they always sit side-by-side. Outline, not
            filled: they open set-up sheets, and two filled brand buttons
            above the class list read as the page's main action
            (2026-09-18 phone audit). */}
        {canEdit && (
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOpenSheet("structures")}
              className="h-10 rounded-xl"
            >
              <Clock className="h-3.5 w-3.5 mr-1.5" />
              Structures
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOpenSheet("resources")}
              className="h-10 rounded-xl"
            >
              <Layers className="h-4 w-4 mr-1.5" />
              Resources
            </Button>
          </div>
        )}
      </section>

      {/* Body */}
      {classListQuery.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : classListQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn't load classes</AlertTitle>
          <AlertDescription>
            {(classListQuery.error as Error)?.message ?? "Unknown error"}
          </AlertDescription>
        </Alert>
      ) : classes.length === 0 ? (
        <Alert>
          <AlertTitle>No classes in this scope</AlertTitle>
          <AlertDescription>
            {isAdmin
              ? `No active classes${wingId ? " in the selected wing" : ""}. Create classes first, then come back.`
              : "You haven't been assigned to any wing with classes. Ask your school admin."}
          </AlertDescription>
        </Alert>
      ) : filtered.length === 0 ? (
        <Alert>
          <AlertTitle>No matches</AlertTitle>
          <AlertDescription>
            Clear the search to see all classes again.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((c) => (
            <ClassCard key={c.classId} row={c} academicYear={academicYear} />
          ))}
        </div>
      )}
      </>
      )}

      {canEdit && (
        <SettingsSheetV2
          open={openSheet !== null}
          onOpenChange={(o) => {
            if (!o) setOpenSheet(null);
          }}
          mode={openSheet ?? "structures"}
        />
      )}

      <DownloadLessonPlanSheetV2 open={downloadOpen} onOpenChange={setDownloadOpen} />
    </div>
  );
}

function ClassCard({ row, academicYear }: { row: ClassListV2Row; academicYear: string }) {
  const k = statusKey(row);
  const displayName = row.section ? `${row.className} – ${row.section}` : row.className;
  const pctLabel = row.requiredCount > 0
    ? `${row.filledCount} / ${row.requiredCount}`
    : "No grid";
  const workspaceHref = `/school/timetable/${row.classId}?ay=${encodeURIComponent(academicYear)}`;

  // Vertical layout, fixed inner sections, so every card across the grid
  // is the same height regardless of structureName/lastEditedAt presence.
  return (
    <Link
      to={workspaceHref}
      className="group flex flex-col surface-card frosted-shadow rounded-card p-3.5 sm:p-4 min-h-[140px] transition-shadow hover:shadow-card-lg focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-brand-primary/10 text-brand-primary">
        <Layers className="h-4 w-4" />
      </span>

      <div className="mt-2.5 min-w-0 flex-1">
        <h3 className="text-sm sm:text-base font-semibold text-ink-900 truncate leading-tight">
          {displayName}
        </h3>
        <p className="mt-0.5 text-[11px] text-ink-500 truncate">
          {row.structureName ?? "No structure"}
        </p>
      </div>

      <div className="mt-3 flex items-center justify-between gap-1">
        <StatusPill k={k} />
        <span className="text-[11px] text-ink-500 tabular-nums shrink-0 inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {pctLabel}
        </span>
      </div>
    </Link>
  );
}

function StatusPill({ k }: { k: StatusKey }) {
  // Mobile gets the short label so the pill fits the 2-col grid; tablet+
  // shows the explicit label per the product copy decision.
  if (k === "empty") {
    return (
      <Badge variant="outline" className="gap-1 text-slate-600 dark:text-slate-300 shrink-0 max-w-full">
        <CircleDashed className="h-3 w-3 shrink-0" />
        <span className="sm:hidden">Pending</span>
        <span className="hidden sm:inline">Time Table Pending</span>
      </Badge>
    );
  }
  if (k === "draft") {
    return (
      <Badge
        variant="outline"
        className="gap-1 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30 shrink-0 max-w-full"
      >
        <CircleDashed className="h-3 w-3 shrink-0" />
        Draft
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30 shrink-0 max-w-full"
    >
      <CheckCircle2 className="h-3 w-3 shrink-0" />
      <span className="sm:hidden">Assigned</span>
      <span className="hidden sm:inline">Time Table Assigned</span>
    </Badge>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  if (diffMs < 0) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
