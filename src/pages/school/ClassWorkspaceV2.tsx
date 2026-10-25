import { useState } from "react";
import { toast } from "sonner";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  CalendarClock,
  ChevronLeft,
  Loader2,
  Printer,
  Rocket,
  Undo2,
  UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useUserRole } from "@/hooks/useUserRole";
import { useIsTimetableManager } from "@/hooks/useIsTimetableManager";
import { currentAcademicYear } from "@/hooks/useAcademicCalendar";
import {
  useClassWorkspaceV2,
  useSaveTtSlot,
  useDeleteTtSlot,
  useSetPublishStatusV2,
  useSubstitutionsForClass,
  useCalendarWindowV2,
  useTtPeriodStructures,
  useAssignStructureToClassesV2,
  type PeriodSlotV2,
  type ResolvedSlotV2,
  type Weekday,
  slotsForDay,
} from "@/hooks/useTimetableV2";
import TimetableGridV2, {
  type GridCellClick,
} from "@/components/timetable-v2/TimetableGridV2";
import SlotDrawerV2 from "@/components/timetable-v2/SlotDrawerV2";
import SubstituteDialogV2 from "@/components/timetable-v2/SubstituteDialogV2";
import TeacherLoadPanelV2 from "@/components/timetable-v2/TeacherLoadPanelV2";
import { useOptionalGroupsForClass } from "@/hooks/useOptionalGroups";
import { openTimetablePrintWindowV2 } from "@/components/timetable-v2/TimetablePrintViewV2";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ClassInfo {
  id: string;
  name: string;
  section: string | null;
  academic_year: string;
}

function useClassInfo(classId: string | undefined) {
  return useQuery({
    queryKey: ["timetable-v2", "class-info", classId],
    enabled: !!classId,
    queryFn: async (): Promise<ClassInfo | null> => {
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, section, academic_year")
        .eq("id", classId!)
        .maybeSingle();
      if (error) throw error;
      return (data as ClassInfo | null) ?? null;
    },
  });
}

// --------------------------------------------------------------
// ClassWorkspaceV2 — single-class workspace. Grid on the left,
// placeholder for teacher-load panel on the right (lands in a
// follow-up slice). Header has Save Draft / Publish toggle and a
// back-to-list link. Slot drawer opens on cell tap.
// --------------------------------------------------------------

export default function ClassWorkspaceV2() {
  const { classId } = useParams<{ classId: string }>();
  const [searchParams] = useSearchParams();
  const ayFromQuery = searchParams.get("ay");
  const academicYear = ayFromQuery ?? currentAcademicYear();
  const navigate = useNavigate();

  const { data: roleInfo } = useUserRole();
  // Per-user override grant (tt_manager_overrides): full institution-wide
  // timetable management for a named non-admin user — treated as admin here.
  const { isTimetableManager } = useIsTimetableManager();
  const isAdmin = !!(roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin) || isTimetableManager;
  const isCoordinator = !!roleInfo?.isCoordinator;
  const { institutionName } = useEffectiveInstitution();

  const classInfo = useClassInfo(classId);
  const workspace = useClassWorkspaceV2(classId ?? null, academicYear);
  // Subjects inside each optional basket, for the printed sheet. Must sit
  // with the other top-level queries: below this point the component has
  // early returns, and a conditional hook breaks the hook order.
  const optionalGroupsQuery = useOptionalGroupsForClass(classId ?? null);
  const saveSlot = useSaveTtSlot(classId ?? null, academicYear);
  const deleteSlot = useDeleteTtSlot(classId ?? null, academicYear);
  const publishMut = useSetPublishStatusV2(classId ?? null, academicYear);
  const substitutionsQuery = useSubstitutionsForClass(classId ?? null, academicYear);
  const calendarWindow = useCalendarWindowV2(
    academicYear,
    workspace.data?.structure?.working_days ?? null,
  );

  const [substituteMode, setSubstituteMode] = useState(false);
  const [drawer, setDrawer] = useState<
    | {
        day: Weekday;
        periodSlot: PeriodSlotV2;
        existingSlot: ResolvedSlotV2 | null;
      }
    | null
  >(null);
  const [subDialog, setSubDialog] = useState<
    | {
        day: Weekday;
        periodSlot: PeriodSlotV2;
        existingSlot: ResolvedSlotV2;
      }
    | null
  >(null);

  // Permission split (matches the new flow + DB RLS):
  //   * canManageStructure (admin only) — assign/unassign structure.
  //     `tt_class_structure` direct writes are admin-only at RLS layer;
  //     used here for the empty-state inline picker.
  //   * canEditCells (admin OR coordinator-in-wing) — slot drawer
  //     (subject + teacher per cell) and substitute mode. `tt_slots` writes
  //     are gated through `tt_user_can_edit_class_slots` RLS helper.
  //   * canPublish (admin OR coordinator-in-wing) — flips publish_status
  //     via the `tt_set_publish_status` SECURITY DEFINER RPC, which checks
  //     wing membership server-side.
  const canManageStructure = isAdmin;
  const canEditCells = isAdmin || isCoordinator;
  const canPublish = isAdmin || isCoordinator;

  // Validate the route param is a plausible UUID before even firing
  // queries — avoids Supabase's "invalid input syntax for type uuid"
  // error path that silently leaves the skeleton spinning.
  const classIdLooksValid =
    !!classId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(classId);

  if (!classId || !classIdLooksValid) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
        <BackBar />
        <Alert>
          <AlertTitle>That URL doesn&apos;t point to a real class</AlertTitle>
          <AlertDescription>
            The class id in the URL isn&apos;t valid. Head back to the{" "}
            <Link className="underline" to="/school/timetable">class list</Link>{" "}
            and click a card instead of typing a URL by hand.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (classInfo.isLoading || workspace.isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (classInfo.isError || workspace.isError || !classInfo.data) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
        <BackBar />
        <Alert>
          <AlertTitle>Class not found</AlertTitle>
          <AlertDescription>
            This class either doesn&apos;t exist, belongs to another school,
            or you don&apos;t have access to it. Go back to the{" "}
            <Link className="underline" to="/school/timetable">class list</Link>.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const className = classInfo.data.name;
  const classSection = classInfo.data.section;
  const headerName = classSection ? `${className} – ${classSection}` : className;

  // No structure attached. Admins get an inline picker so they can wire up a
  // structure right here without leaving the page. Coordinators see a
  // read-only message — they can't write to `tt_class_structure` (RLS).
  if (!workspace.data || !workspace.data.structure) {
    return (
      <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">
        <BackBar />
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarClock className="h-5 w-5" />
          {headerName}
        </h1>
        {canManageStructure ? (
          <NoStructureAdminPicker classId={classId} academicYear={academicYear} />
        ) : (
          <Alert>
            <AlertTitle>No period structure assigned yet</AlertTitle>
            <AlertDescription>
              A period structure (the weekly grid of periods + breaks) must be
              attached to this class before you can fill in teachers. Ask your
              school admin to assign one from the Timetable settings.
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  const { structure, publishStatus, slots } = workspace.data;
  const published = publishStatus === "published";

  function handleCellClick(args: GridCellClick) {
    const ps = structure!.slots.find((p) => p.id === args.periodSlotId);
    if (!ps) return;
    if (substituteMode) {
      // Only existing slots can have substitutes — you can't cover a
      // period that hasn't been assigned a teacher yet. Say so instead of
      // doing nothing: an optional-group cell looks populated, so a silent
      // no-op read as the app being broken.
      if (!args.existingSlot || !args.existingSlot.teacher_id) {
        if (args.existingSlot?.optional_group_id) {
          toast.info(
            "Optional periods can't take a substitute yet. Each subject in the basket has its own teacher, so arrange cover with them directly.",
          );
        } else {
          toast.info("Assign a subject and teacher to this period before arranging a substitute.");
        }
        return;
      }
      setSubDialog({
        day: args.day,
        periodSlot: ps,
        existingSlot: args.existingSlot,
      });
      return;
    }
    setDrawer({
      day: args.day,
      periodSlot: ps,
      existingSlot: args.existingSlot,
    });
  }

  // Per-day override rows REPLACE the default schedule for the days they
  // list, so the denominator is the sum of each working day's effective
  // period count, not (all period rows x working days) - the old formula
  // counted default and override rows together and produced a target that
  // could never be reached. The numerator likewise counts only cells the
  // grid actually renders, so slots orphaned by a structure change no
  // longer inflate it. Same rule as useClassListV2 step 4.

  const { requiredCells, filledCount } = (() => {
    const effective = new Set<string>();
    let required = 0;
    for (const day of structure.working_days) {
      for (const p of slotsForDay(structure.slots, day)) {
        if (p.kind !== "period") continue;
        required += 1;
        effective.add(`${day}|${p.id}`);
      }
    }
    return {
      requiredCells: required,
      filledCount: slots.filter((s) => effective.has(`${s.day}|${s.period_slot_id}`)).length,
    };
  })();

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">
      <BackBar />

      {/* Header — title block + actions. Title is its own row on mobile;
          actions wrap into a 2-col grid below so each button is full-width
          and tappable. From sm+, actions inline beside the title. */}
      <header className="space-y-3 md:flex md:items-start md:justify-between md:gap-4 md:space-y-0">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2.5 text-ink-900">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-primary/10 text-brand-primary">
              <CalendarClock className="h-5 w-5" />
            </span>
            <span className="truncate">{headerName}</span>
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            {structure.name} · {filledCount} / {requiredCells} cells filled
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-2 md:shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() =>
              openTimetablePrintWindowV2({
                optionalGroups: optionalGroupsQuery.data ?? [],
                className,
                classSection,
                academicYear,
                institutionName: institutionName ?? undefined,
                structure,
                slots,
              })
            }
          >
            <Printer className="h-4 w-4 mr-1.5" />
            Print
          </Button>
          {canEditCells && (
            <Button
              variant={substituteMode ? "default" : "outline"}
              size="sm"
              onClick={() => setSubstituteMode((v) => !v)}
              title="Cover for an absent teacher on a specific date"
              className={
                substituteMode
                  ? "rounded-xl bg-brand-primary text-white hover:bg-brand-primary/90"
                  : "rounded-xl"
              }
            >
              <UserCog className="h-4 w-4 mr-1.5" />
              <span className="sm:hidden">{substituteMode ? "Sub: ON" : "Substitute"}</span>
              <span className="hidden sm:inline">
                {substituteMode ? "Substitute mode: ON" : "Substitute mode"}
              </span>
            </Button>
          )}
          {canPublish && (
            <div className="col-span-2 sm:col-span-1">
              <PublishButton
                published={published}
                busy={publishMut.isPending}
                onToggle={() => publishMut.mutate(published ? "draft" : "published")}
              />
            </div>
          )}
        </div>
      </header>

      {substituteMode && (
        <Alert className="bg-purple-50 border-purple-200 text-purple-900 dark:bg-purple-500/10 dark:border-purple-500/30 dark:text-purple-200">
          <AlertDescription className="text-sm">
            <strong>Substitute mode is on.</strong> Tap an assigned cell to
            cover the teacher for a specific date. The recurring schedule
            isn&apos;t changed. Only that one date.
          </AlertDescription>
        </Alert>
      )}

      {published && (
        <Alert className="bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-200">
          <AlertDescription className="text-sm">
            This timetable is <strong>published</strong>. Teachers and students
            can see their slots. Edits go live immediately.
          </AlertDescription>
        </Alert>
      )}

      {/* Grid + side panel. On mobile / tablet the grid scrolls
          horizontally inside its surface card so the page itself doesn't
          jiggle, and the teacher-load card sits below in its own surface. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
        <div className="min-w-0 surface-card frosted-shadow rounded-card p-3 sm:p-4 overflow-x-auto">
          <TimetableGridV2
            structure={structure}
            slots={slots}
            calendarWindow={calendarWindow.data ?? null}
            readOnly={!canEditCells}
            onCellClick={handleCellClick}
          />
        </div>

        <TeacherLoadPanelV2
          academicYear={academicYear}
          wingId={null}
          workingDays={structure.working_days}
          weeklyCapacity={requiredCells}
        />
      </div>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => navigate("/school/timetable")}>
          Back to class list
        </Button>
      </div>

      {drawer && (
        <SlotDrawerV2
          open
          onOpenChange={(open) => {
            if (!open) setDrawer(null);
          }}
          classId={classId}
          className={className}
          classSection={classSection}
          academicYear={academicYear}
          day={drawer.day}
          periodSlot={drawer.periodSlot}
          existingSlot={drawer.existingSlot}
          canEdit={canEditCells}
          onSave={async (input) => {
            await saveSlot.mutateAsync(input);
          }}
          onDelete={async (slotId) => {
            await deleteSlot.mutateAsync(slotId);
          }}
        />
      )}

      {subDialog && (
        <SubstituteDialogV2
          open
          onOpenChange={(open) => {
            if (!open) setSubDialog(null);
          }}
          className={className}
          classSection={classSection}
          day={subDialog.day}
          periodSlot={subDialog.periodSlot}
          existingSlot={subDialog.existingSlot}
          existingSubstitutions={substitutionsQuery.data?.get(subDialog.existingSlot.id) ?? []}
          existingError={substitutionsQuery.isError}
          onRetryExisting={() => void substitutionsQuery.refetch()}
          canEdit={canEditCells}
        />
      )}
    </div>
  );
}

function BackBar() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link to="/school/timetable">
        <ChevronLeft className="h-4 w-4 mr-1" />
        Back to classes
      </Link>
    </Button>
  );
}

/**
 * Admin-only inline picker for the empty-state. Lists every period structure
 * the institution has and assigns the chosen one to this class for the given
 * academic year. Coordinator never reaches this branch — they get a static
 * "ask your admin" message instead.
 */
function NoStructureAdminPicker({
  classId,
  academicYear,
}: {
  classId: string;
  academicYear: string;
}) {
  const structures = useTtPeriodStructures();
  const assign = useAssignStructureToClassesV2();
  const [selectedId, setSelectedId] = useState<string>("");

  const available = structures.data ?? [];

  if (structures.isLoading) {
    return (
      <Alert>
        <AlertTitle>Loading structures…</AlertTitle>
      </Alert>
    );
  }

  if (available.length === 0) {
    return (
      <Alert>
        <AlertTitle>No period structure yet</AlertTitle>
        <AlertDescription>
          Create a structure first from <strong>Timetable → Structures</strong>,
          then come back here to attach it to this class.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div>
        <h2 className="font-semibold text-base">Pick a period structure</h2>
        <p className="text-sm text-muted-foreground">
          Choose the weekly grid this class will use for {academicYear}. You can
          still change it later from <strong>Timetable → Structures → Assign</strong>.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="sm:flex-1">
            <SelectValue placeholder="Select a structure" />
          </SelectTrigger>
          <SelectContent>
            {available.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} · {s.slotCount} period{s.slotCount === 1 ? "" : "s"} ·{" "}
                {s.working_days.length} working day{s.working_days.length === 1 ? "" : "s"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          onClick={() =>
            assign.mutate({
              structureId: selectedId,
              classIds: [classId],
              academicYear,
            })
          }
          disabled={!selectedId || assign.isPending}
        >
          {assign.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          Assign
        </Button>
      </div>
    </div>
  );
}

function PublishButton({
  published,
  busy,
  onToggle,
}: {
  published: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  if (published) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={onToggle}
        disabled={busy}
        className="w-full sm:w-auto rounded-xl"
      >
        {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Undo2 className="h-4 w-4 mr-1.5" />}
        <span className="sm:hidden">Revert</span>
        <span className="hidden sm:inline">Revert to draft</span>
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      onClick={onToggle}
      disabled={busy}
      className="w-full sm:w-auto rounded-xl bg-brand-primary text-white hover:bg-brand-primary/90"
    >
      {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Rocket className="h-4 w-4 mr-1.5" />}
      <span className="sm:hidden">Publish</span>
      <span className="hidden sm:inline">Publish timetable</span>
    </Button>
  );
}
