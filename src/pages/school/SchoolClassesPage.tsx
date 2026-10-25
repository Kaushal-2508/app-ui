import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  Calendar,
  GraduationCap,
  Layers,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageShell, PageHeader } from "@/components/shared/page";
import { ClayStatTile, EmptyState } from "@/components/shared/surfaces";
import { TONES, type Tone } from "@/components/shared/design-system";
import { useUserRole } from "@/hooks/useUserRole";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { useClasses, ClassData } from "@/hooks/useClasses";
import { useCoordinatorClasses } from "@/hooks/useCoordinatorClasses";
import AddClassDialog from "@/components/admin/AddClassDialog";
import AssignTeachersDialog from "@/components/school/AssignTeachersDialog";
import RenameSectionDialog from "@/components/school/RenameSectionDialog";
import RenameClassDialog from "@/components/school/RenameClassDialog";
import { formatNumber } from "@/lib/formatNumber";
import { cn, formatClassName } from "@/lib/utils";

/** Tones cycle by grade so neighbouring grades read as distinct groups
 *  without any card becoming a loud full-bleed block. */
const GRADE_TONES: Tone[] = ["teal", "violet", "sky", "mint", "peach", "rose"];

/** "Class 9" -> "9", "Nursery" -> "N", "LKG" -> "L". Shown inside the
 *  card's tinted disc so a wall of cards can be scanned by grade. */
function gradeGlyph(name: string): string {
  const digits = name.match(/\d+/);
  if (digits) return digits[0];
  const letter = name.trim().charAt(0);
  return letter ? letter.toUpperCase() : "?";
}

function gradeTone(name: string): Tone {
  const digits = name.match(/\d+/);
  const idx = digits ? Number(digits[0]) : name.length;
  return GRADE_TONES[Math.abs(idx) % GRADE_TONES.length];
}

export default function SchoolClassesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [assigningTeachers, setAssigningTeachers] = useState<ClassData | null>(null);
  const [renamingSection, setRenamingSection] = useState<ClassData | null>(null);
  const [renamingClass, setRenamingClass] = useState<ClassData | null>(null);

  const { data: roleInfo, isLoading: loadingRole } = useUserRole();
  const { activeViewRole, hasDualRole } = useActiveRole();

  // Determine effective role - one hat at a time, never a union.
  // "admin" maps back to the concrete admin role so every downstream
  // comparison against "school_admin" / "super_school_admin" is unchanged.
  const effectiveRole = hasDualRole
    ? (activeViewRole === "admin" ? roleInfo?.primaryRole : activeViewRole)
    : roleInfo?.primaryRole;

  const isEffectiveCoordinator = effectiveRole === "coordinator";
  const canRename =
    effectiveRole === "super_admin" ||
    effectiveRole === "super_school_admin" ||
    effectiveRole === "school_admin" ||
    effectiveRole === "coordinator";

  // Coordinator class access control
  const {
    classIds: coordinatorClassIds,
    isLoading: coordLoading,
    isError: coordFailed,
  } = useCoordinatorClasses();

  // For admins, fetch all institution classes
  const {
    data: allClasses,
    isLoading: loadingClasses,
    isError: classesFailed,
    isFetching: refetchingClasses,
    refetch: refetchClasses,
  } = useClasses(roleInfo?.institutionId || null);

  const isLoading = loadingRole || loadingClasses || (isEffectiveCoordinator && coordLoading);

  // A coordinator is scoped to their wing's classes UNCONDITIONALLY. The guard
  // used to be `length > 0`, which failed OPEN: a coordinator whose wing lookup
  // resolved to nothing fell through to the whole institution. Five of the 24
  // coordinators in production resolve to zero classes today (2026-09-18), so
  // this was live. An empty list must show nothing; a FAILED lookup is a
  // separate signal (`coordFailed`) and renders the error state instead (§6).
  const classes = isEffectiveCoordinator
    ? (allClasses || []).filter(cls => coordinatorClassIds.includes(cls.id))
    : allClasses;

  const filteredClasses = (classes || []).filter((cls) =>
    `${cls.name} ${cls.section || ""}`.toLowerCase().includes(search.toLowerCase())
  );

  const activeClasses = (classes || []).filter((c) => c.is_active);
  const totalStudents = activeClasses.reduce((sum, c) => sum + c.student_count, 0);
  const avgClassSize = activeClasses.length > 0
    ? Math.round(totalStudents / activeClasses.length)
    : 0;

  const currentYear = new Date().getFullYear();
  const currentAcademicYear = `${currentYear}-${String(currentYear + 1).slice(-2)}`;

  // Check if coordinator has no assigned classes
  const hasNoAccess = isEffectiveCoordinator && coordinatorClassIds.length === 0;

  const studentsPath = isEffectiveCoordinator ? "/coordinator/students" : "/school/students";

  if (isLoading) {
    return <PageSkeleton />;
  }

  return (
    <PageShell>
      <PageHeader
        density="compact"
        icon={<Layers className="h-5 w-5" />}
        title="Classes"
        subtitle={
          isEffectiveCoordinator
            ? "Classes in your wing at a glance"
            : "Manage class sections and assignments"
        }
        // Add Class is only available for Super Admins. The dialog owns its
        // trigger, so it rides in the extras slot rather than primaryAction.
        extras={
          roleInfo?.isSuperAdmin && roleInfo?.institutionId ? (
            <AddClassDialog
              institutionId={roleInfo.institutionId}
              trigger={
                <Button className="bg-brand-primary text-white hover:bg-brand-primary/90 active:scale-[0.98]">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Class
                </Button>
              }
            />
          ) : undefined
        }
      />

      {/* The error branch comes BEFORE stats and the empty state: a failed
          query resolving to zero rows would otherwise read as "no classes"
          with four zero tiles above it (§6). */}
      {classesFailed || (isEffectiveCoordinator && coordFailed) ? (
        <div className="surface-card frosted-shadow rounded-card border-ink-400/50">
          <EmptyState
            icon={<AlertTriangle className="h-7 w-7" />}
            tone="rose"
            reason="error"
            title="Couldn't load classes"
            description="Something went wrong fetching the class list. Please try again."
            // The query stays in its error state while it retries, so without
            // this the button gave no sign the click did anything.
            action={{
              label: refetchingClasses ? "Retrying..." : "Retry",
              icon: <RefreshCw className={cn("h-4 w-4", refetchingClasses && "animate-spin")} />,
              onClick: () => {
                if (!refetchingClasses) void refetchClasses();
              },
            }}
          />
        </div>
      ) : (
        <>
          {/* The dashboard's clay tiles, as on the Manage Users tabs (Naman,
              2026-10-07: "now also fix this"): four in a row from md up, two
              by two on a phone. */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 sm:gap-4">
            <ClayStatTile label="Total classes" value={formatNumber(activeClasses.length)} icon={<Layers />} tone="teal" />
            <ClayStatTile label="Total students" value={formatNumber(totalStudents)} icon={<Users />} tone="violet" />
            <ClayStatTile label="Avg class size" value={formatNumber(avgClassSize)} icon={<GraduationCap />} tone="mint" />
            <ClayStatTile label="Academic year" value={currentAcademicYear} icon={<Calendar />} tone="peach" />
          </div>

          {/* Toolbar: search on the left, a quiet scope note on the right,
              both 40px tall so they sit on one line. */}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <Input
                placeholder="Search classes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                // Card-coloured with a hairline and a shadow so it stands off the
                // cream backdrop (Naman, 2026-10-07: "mixed up with background").
                className="h-10 rounded-lg pl-9 border-[hsl(var(--surface-stroke))] bg-[hsl(var(--surface-card))] shadow-card placeholder:text-ink-500 focus-visible:ring-brand-primary/40"
              />
            </div>
            {isEffectiveCoordinator && !hasNoAccess && (
              <span className="inline-flex h-10 w-fit items-center gap-2 rounded-lg border border-ink-400/50 bg-surface-card px-3 text-[13px] text-ink-600">
                <ShieldCheck className="h-4 w-4 text-brand-primary" />
                <span>
                  <span className="font-semibold tabular-nums text-ink-900">{coordinatorClassIds.length}</span>
                  {" "}
                  {coordinatorClassIds.length === 1 ? "class" : "classes"} in your wing
                </span>
              </span>
            )}
          </div>

          {filteredClasses.length === 0 ? (
            <div className="mt-3 surface-card frosted-shadow rounded-card border-ink-400/50">
              <EmptyState
                icon={<Layers className="h-7 w-7" />}
                reason={search ? "noResults" : "noData"}
                title={search ? "No classes match" : "No classes yet"}
                description={
                  search
                    ? "Try a different name or section."
                    : isEffectiveCoordinator
                      ? "Classes assigned to your wing will appear here."
                      : "Add your first class to get started."
                }
              />
            </div>
          ) : (
            // grid-cols-1 + min-w-0: the implicit phone column was sized to
            // the card's min-content (the two-column stat row), so every card
            // was 411px on a 390px screen and the row menu sat half off the
            // edge (2026-09-18 audit).
            <ul className="mt-4 grid list-none grid-cols-1 gap-3 p-0 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredClasses.map((cls) => {
                const tone = TONES[gradeTone(cls.name)];
                const label = formatClassName(cls.name, cls.section);
                return (
                  <li
                    key={cls.id}
                    className={cn(
                      "surface-card frosted-shadow flex min-w-0 flex-col rounded-card border-ink-400/50 p-5 transition-[box-shadow,border-color] duration-200 hover:border-brand-primary/60 hover:shadow-card-lg",
                      !cls.is_active && "opacity-60",
                    )}
                  >
                    {/* Disc is 40px; title (22px) + meta (18px) = 40px, so the
                        two columns share top and bottom edges exactly. */}
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[16px] font-bold tabular-nums",
                          tone.bg,
                          tone.fg,
                        )}
                        aria-hidden
                      >
                        {gradeGlyph(cls.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-[17px] font-semibold leading-[22px] text-ink-900">{label}</h3>
                        <div className="flex items-center gap-2 text-[13px] leading-[18px] text-ink-500">
                          <span className="tabular-nums">{cls.academic_year}</span>
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              // Token, not a palette colour: the raw emerald did not flip in dark mode.
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                cls.is_active ? "bg-[hsl(var(--status-completed))]" : "bg-ink-400",
                              )}
                              aria-hidden
                            />
                            {cls.is_active ? "Active" : "Archived"}
                          </span>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="-mr-2 -mt-1 h-8 w-8 shrink-0 rounded-lg text-ink-500 hover:text-ink-900"
                            aria-label={`Actions for ${label}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem onClick={() => navigate(`${studentsPath}?class=${cls.id}`)}>
                            View Students
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setAssigningTeachers(cls)}>
                            Assign Teachers
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/exams?class=${cls.id}`)}>
                            View Exams
                          </DropdownMenuItem>
                          {canRename && cls.class_group_id && (
                            <>
                              <DropdownMenuItem onClick={() => setRenamingSection(cls)}>
                                Rename section
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setRenamingClass(cls)}>
                                Rename class
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Both cells use the same 36px disc and 24px + 14px text
                        stack, so numbers and captions line up across the row
                        and across neighbouring cards. */}
                    <div className="mt-5 grid grid-cols-2 gap-3 border-t border-ink-400/40 pt-4">
                      <button
                        type="button"
                        onClick={() => navigate(`${studentsPath}?class=${cls.id}`)}
                        className="-mx-2 -my-1 flex items-center gap-3 rounded-lg px-2 py-1 text-left transition-colors hover:bg-brand-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
                      >
                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10 text-brand-primary">
                          <Users className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[20px] font-semibold leading-6 tabular-nums text-ink-900">
                            {formatNumber(cls.student_count)}
                          </span>
                          <span className="eyebrow block leading-[14px]">Students</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setAssigningTeachers(cls)}
                        className="-mx-2 -my-1 flex items-center gap-3 rounded-lg px-2 py-1 text-left transition-colors hover:bg-brand-secondary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
                      >
                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-secondary/10 text-brand-secondary">
                          <GraduationCap className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[20px] font-semibold leading-6 tabular-nums text-ink-900">
                            {formatNumber(cls.teacher_count)}
                          </span>
                          <span className="eyebrow block leading-[14px]">Teachers</span>
                        </span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {/* Assign Teachers Dialog */}
      {roleInfo?.institutionId && (
        <AssignTeachersDialog
          classData={assigningTeachers}
          institutionId={roleInfo.institutionId}
          open={!!assigningTeachers}
          onOpenChange={(open) => !open && setAssigningTeachers(null)}
          coordinatorClassIds={isEffectiveCoordinator ? coordinatorClassIds : undefined}
        />
      )}
      <RenameSectionDialog
        classData={renamingSection}
        open={!!renamingSection}
        onOpenChange={(open) => !open && setRenamingSection(null)}
      />
      <RenameClassDialog
        classData={renamingClass}
        open={!!renamingClass}
        onOpenChange={(open) => !open && setRenamingClass(null)}
      />
    </PageShell>
  );
}

function PageSkeleton() {
  return (
    <PageShell>
      <div className="flex items-start gap-3 py-3 sm:py-4 lg:py-5">
        <Skeleton className="h-10 w-10 rounded-2xl" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-32 rounded-lg" />
          <Skeleton className="h-4 w-56 rounded-lg" />
        </div>
      </div>
      <Skeleton className="h-[292px] w-full rounded-card sm:h-[146px] md:h-[72px]" />
      <Skeleton className="mt-4 h-10 w-full rounded-lg sm:max-w-xs" />
      <div className="mt-4 grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-[164px] rounded-card" />
        ))}
      </div>
    </PageShell>
  );
}
