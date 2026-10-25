import { useNavigate, useSearchParams } from "react-router-dom";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  ClipboardList,
  ClipboardCheck,
  Plus,
  MoreHorizontal,
  Edit3,
  Copy,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { PageShell, PageHeader, MobileFab } from "@/components/shared/page";
import { ListRow, EmptyState } from "@/components/shared/surfaces";
import { FilterRow } from "@/components/shared/nav";
import { MobileTabs } from "@/components/shared/nav";

import { cn, formatClassName } from "@/lib/utils";
import {
  useHomeworkList,
  useHomeworkCounts,
  useHomeworkDrafts,
  useDuplicateHomework,
  useDeleteHomeworkDraft,
  useDeleteHomework,
  type HomeworkTab,
} from "@/hooks/useHomeworkData";
import type { HomeworkListRow, HomeworkStatus } from "@/types/homework";
import { useUserRole } from "@/hooks/useUserRole";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { TargetsHeaderButton } from "@/components/targets/TargetsHeaderButton";

const TAB_VALUES: HomeworkTab[] = ["scheduled", "submitted", "checked"];

function isHomeworkTab(v: string | null): v is HomeworkTab {
  return v === "scheduled" || v === "submitted" || v === "checked";
}

/** True when the row is still editable: drafts always; published only while not
 * yet visible to students (visible_from in the future). */
function isEditable(row: HomeworkListRow): boolean {
  if (row.status === "draft") return true;
  if (row.status === "published") return new Date(row.visible_from).getTime() > Date.now();
  return false;
}

/** Accent gradient for the leading icon disc, mirroring ExamsPage.statusAccent. */
function statusAccent(tab: HomeworkTab, status: HomeworkStatus): string {
  if (status === "draft") {
    return "bg-gradient-to-br from-slate-100 via-slate-50 to-zinc-50 text-slate-600";
  }
  switch (tab) {
    case "checked":
      return "bg-gradient-to-br from-emerald-100 via-teal-50 to-cyan-50 text-emerald-600";
    case "submitted":
      return "bg-gradient-to-br from-amber-100 via-orange-50 to-rose-50 text-amber-600";
    case "scheduled":
    default:
      return "bg-gradient-to-br from-sky-100 via-sky-50 to-indigo-50 text-sky-600";
  }
}

/** Small color-mapped status badge, mirroring ExamsPage.ExamStatusBadge. */
function HomeworkStatusBadge({ tab, status }: { tab: HomeworkTab; status: HomeworkStatus }) {
  let label: string;
  let cls: string;
  if (status === "draft") {
    label = "Draft";
    cls = "bg-muted text-muted-foreground border-border";
  } else if (status === "checked") {
    label = "Checked";
    cls = "bg-emerald-50 text-emerald-700 border-emerald-200";
  } else if (tab === "submitted") {
    label = "Closed";
    cls = "bg-amber-50 text-amber-700 border-amber-200";
  } else {
    label = "Scheduled";
    cls = "bg-blue-50 text-blue-700 border-blue-200";
  }
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] font-medium px-1.5 py-0 h-5", cls)}
    >
      {label}
    </Badge>
  );
}

const EMPTY_COPY: Record<HomeworkTab, { title: string; description: string }> = {
  scheduled: {
    title: "No scheduled homework",
    description: "Create homework and it will appear here until its due date passes.",
  },
  submitted: {
    title: "Nothing awaiting marks",
    description: "Homework past its due date shows up here so you can mark submissions.",
  },
  checked: {
    title: "No checked homework yet",
    description: "Once you finish marking, completed homework moves here.",
  },
};

export default function HomeworkPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Same role-derivation ExamsPage uses for its header Targets button, so a
  // dual-role user gets the same destination from both pages while switching
  // scope (activeViewRole is shared app-wide state, not page-local).
  const { data: roleInfo } = useUserRole();
  const { isManagingAsAdmin } = useEffectiveInstitution();
  const { activeViewRole, hasDualRole } = useActiveRole();
  const { isFeatureEnabled } = useInstitutionFeatures();
  const isAdminCapable = !!roleInfo?.isSchoolAdmin || isManagingAsAdmin;
  const isSchoolAdminView =
    isAdminCapable && (isManagingAsAdmin || !hasDualRole || activeViewRole === "admin");
  const isCoordinatorScope =
    !isSchoolAdminView &&
    !!roleInfo?.isCoordinator &&
    (!hasDualRole || activeViewRole === "coordinator");
  const targetsPathForRole =
    isSchoolAdminView || isCoordinatorScope ? "/school/teacher-targets" : "/teacher/my-targets";

  const tab: HomeworkTab = isHomeworkTab(searchParams.get("tab"))
    ? (searchParams.get("tab") as HomeworkTab)
    : "scheduled";

  const setTab = (next: string) => {
    if (!isHomeworkTab(next)) return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  const [showDrafts, setShowDrafts] = useState(false);
  const [classFilter, setClassFilter] = useState<string>("all");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [draftToDelete, setDraftToDelete] = useState<{ id: string; title: string } | null>(null);
  const [rowToDelete, setRowToDelete] = useState<{ id: string; title: string } | null>(null);

  const { data: drafts = [] } = useHomeworkDrafts();
  const draftCount = drafts.length;

  const duplicate = useDuplicateHomework();
  const deleteDraft = useDeleteHomeworkDraft();
  const deleteHomework = useDeleteHomework();

  const { data: rows = [], isLoading } = useHomeworkList(tab);

  // Filter option sets derived in-memory from the loaded rows (cheap).
  const classOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) =>
      r.classes.forEach((c) => map.set(c.id, formatClassName(c.name, c.section)))
    );
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const subjectOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => {
      r.subjects.forEach((s) => map.set(s.id, s.name));
    });
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  // Apply class/subject filters in-memory.
  const filteredRows = useMemo(
    () =>
      rows.filter((r) => {
        const matchesClass =
          classFilter === "all" || r.classes.some((c) => c.id === classFilter);
        const matchesSubject =
          subjectFilter === "all" || r.subjects.some((s) => s.id === subjectFilter);
        return matchesClass && matchesSubject;
      }),
    [rows, classFilter, subjectFilter]
  );

  const ids = useMemo(() => filteredRows.map((r) => r.id), [filteredRows]);
  const { data: counts } = useHomeworkCounts(ids);

  const activeFilterCount =
    (classFilter !== "all" ? 1 : 0) + (subjectFilter !== "all" ? 1 : 0);

  const resetFilters = () => {
    setClassFilter("all");
    setSubjectFilter("all");
  };

  const goCreate = () => navigate("/homework/create");

  const handleDuplicate = (sourceId: string) => {
    duplicate.mutate(sourceId, {
      onSuccess: (newId) => navigate(`/homework/edit/${newId}`),
    });
  };

  const handleRowClick = (row: HomeworkListRow) => {
    if (isEditable(row)) { navigate(`/homework/edit/${row.id}`); return; }
    if (row.status === "published" || row.status === "checked") navigate(`/homework/${row.id}`);
  };

  const isEmptyState = filteredRows.length === 0;

  return (
    <PageShell
      fab={
        <MobileFab
          label="Create"
          icon={<Plus className="h-5 w-5" />}
          onClick={goCreate}
          hideWhen={isEmptyState}
        />
      }
    >
      <PageHeader
        icon={<ClipboardList className="h-5 w-5" />}
        title="Homework and Assignment"
        subtitle="Create, schedule, and grade homework"
        extras={
          isFeatureEnabled("teacher_targets") ? (
            <TargetsHeaderButton to={targetsPathForRole} />
          ) : null
        }
        primaryAction={{
          label: "Create",
          icon: <Plus className="h-4 w-4" />,
          onClick: goCreate,
        }}
      />

      {/* Drafts strip */}
      {draftCount > 0 && (
        <div className="surface-card frosted-shadow rounded-card p-4 flex items-center justify-between gap-3 mt-2">
          <div className="space-y-0.5 min-w-0">
            <p className="text-sm font-medium text-ink-900">
              {draftCount} draft{draftCount === 1 ? "" : "s"}
            </p>
            <p className="text-xs text-ink-500">Pick up where you left off.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowDrafts((v) => !v)}
            className="shrink-0 text-sm font-medium text-brand-primary"
          >
            {showDrafts ? "Hide ↑" : "View →"}
          </button>
        </div>
      )}

      {showDrafts && draftCount > 0 && (
        <ul className="mt-3 list-none p-0 space-y-2">
          {drafts.map((draft) => {
            const subjectName = draft.subjects.map((s) => s.name).join(", ") || undefined;
            const classText = draft.classes
              .map((c) => formatClassName(c.name, c.section))
              .join(", ");
            return (
              <ListRow
                key={draft.id}
                as="li"
                leading={
                  <span
                    className={cn(
                      "inline-flex h-10 w-10 items-center justify-center rounded-xl",
                      statusAccent(tab, "draft")
                    )}
                  >
                    <ClipboardList className="h-5 w-5" />
                  </span>
                }
                title={
                  <span className="flex items-center gap-2">
                    <span className="truncate">{draft.title || "Untitled draft"}</span>
                    <HomeworkStatusBadge tab={tab} status="draft" />
                  </span>
                }
                subtitle={[subjectName, classText].filter(Boolean).join(" · ") || undefined}
                onClick={() => navigate(`/homework/edit/${draft.id}`)}
                trailing={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem onClick={() => navigate(`/homework/edit/${draft.id}`)}>
                        <Edit3 className="h-4 w-4 mr-2" />
                        Continue
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDuplicate(draft.id)}>
                        <Copy className="h-4 w-4 mr-2" />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() =>
                          setDraftToDelete({ id: draft.id, title: draft.title || "Untitled draft" })
                        }
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            );
          })}
        </ul>
      )}

      {/* Tabs */}
      <div className="mt-4">
        <MobileTabs
          value={tab}
          onValueChange={setTab}
          options={[
            { value: "scheduled", label: "Scheduled" },
            { value: "submitted", label: "Submitted" },
            { value: "checked", label: "Checked" },
          ]}
        />
      </div>

      {/* Filters */}
      <div className="mt-3">
        <FilterRow activeCount={activeFilterCount} onClear={resetFilters}>
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger
              className={cn(
                "h-10 rounded-full px-4 text-sm font-medium border bg-[hsl(var(--surface-card)/0.85)] backdrop-blur-sm w-auto min-w-[140px] gap-2",
                classFilter !== "all"
                  ? "border-brand-primary text-brand-primary"
                  : "border-surface-stroke text-ink-700"
              )}
            >
              <SelectValue placeholder="All classes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              {classOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger
              className={cn(
                "h-10 rounded-full px-4 text-sm font-medium border bg-[hsl(var(--surface-card)/0.85)] backdrop-blur-sm w-auto min-w-[140px] gap-2",
                subjectFilter !== "all"
                  ? "border-brand-primary text-brand-primary"
                  : "border-surface-stroke text-ink-700"
              )}
            >
              <SelectValue placeholder="All subjects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All subjects</SelectItem>
              {subjectOptions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterRow>
      </div>

      {/* Body */}
      {isLoading ? (
        <ul className="mt-4 list-none p-0 space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="surface-card frosted-shadow rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="h-8 w-12 rounded-md shrink-0" />
              </div>
            </li>
          ))}
        </ul>
      ) : isEmptyState ? (
        <div className="mt-4 surface-card frosted-shadow rounded-card" data-sticky-bottom>
          <EmptyState
            icon={<ClipboardList className="h-7 w-7" />}
            title={
              activeFilterCount > 0 ? "No homework matches your filters" : EMPTY_COPY[tab].title
            }
            description={
              activeFilterCount > 0
                ? "Try clearing the class or subject filter."
                : EMPTY_COPY[tab].description
            }
            tone="teal"
            action={
              activeFilterCount > 0
                ? undefined
                : {
                    label: "Create homework",
                    icon: <Plus className="h-4 w-4" />,
                    onClick: goCreate,
                  }
            }
          />
        </div>
      ) : (
        <ul className="mt-4 list-none p-0 space-y-2">
          {filteredRows.map((row) => {
            const subjectName = row.subjects.map((s) => s.name).join(", ") || undefined;
            const classText = row.classes
              .map((c) => formatClassName(c.name, c.section))
              .join(", ");
            const c = counts?.get(row.id);
            const editable = isEditable(row);
            const clickable =
              editable || row.status === "published" || row.status === "checked";

            // Trailing count text: "{submitted}/{total}"; on the Submitted tab
            // also surface the marked progress as a second line.
            // Offline assignments have no online submissions — surface marks
            // entered (graded/total) instead of the misleading "0/total".
            const countText = c
              ? row.offline_marks
                ? `${c.graded}/${c.total}`
                : `${c.submitted}/${c.total}`
              : null;
            const markedText = row.offline_marks
              ? c
                ? "marked"
                : null
              : tab === "submitted" && c
                ? `${c.graded}/${c.submitted} marked`
                : null;

            return (
              <ListRow
                key={row.id}
                as="li"
                leading={
                  <span
                    className={cn(
                      "inline-flex h-10 w-10 items-center justify-center rounded-xl",
                      statusAccent(tab, row.status)
                    )}
                  >
                    <ClipboardList className="h-5 w-5" />
                  </span>
                }
                title={
                  <span className="flex items-center gap-2">
                    <span className="truncate">{row.title}</span>
                    <HomeworkStatusBadge tab={tab} status={row.status} />
                    {row.offline_marks && (
                      <span className="shrink-0 rounded-full bg-brand-secondary/10 px-2 py-0.5 text-[10px] font-medium text-brand-secondary">
                        Offline
                      </span>
                    )}
                  </span>
                }
                subtitle={[subjectName, classText].filter(Boolean).join(" · ") || undefined}
                onClick={clickable ? () => handleRowClick(row) : undefined}
                trailing={
                  <div className="flex items-center gap-2">
                    {countText && (
                      <div className="text-right leading-tight">
                        <p className="text-[13px] font-semibold tabular-nums text-ink-900">
                          {countText}
                        </p>
                        {markedText && (
                          <p className="text-[11px] tabular-nums text-ink-500">{markedText}</p>
                        )}
                      </div>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        {editable && (
                          <DropdownMenuItem onClick={() => navigate(`/homework/edit/${row.id}`)}>
                            <Edit3 className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                        )}
                        {!editable && (row.status === "published" || row.status === "checked") && (
                          <DropdownMenuItem onClick={() => navigate(`/homework/${row.id}`)}>
                            <ClipboardCheck className="h-4 w-4 mr-2" />
                            Open to mark
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => handleDuplicate(row.id)}>
                          <Copy className="h-4 w-4 mr-2" />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setRowToDelete({ id: row.id, title: row.title })}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                }
              />
            );
          })}
        </ul>
      )}

      {/* Draft delete confirmation */}
      <AlertDialog
        open={!!draftToDelete}
        onOpenChange={(open) => !open && setDraftToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete draft</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{draftToDelete?.title}&quot;? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (draftToDelete) {
                  deleteDraft.mutate(draftToDelete.id);
                  setDraftToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteDraft.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Assignment delete confirmation (published/checked — destructive) */}
      <AlertDialog
        open={!!rowToDelete}
        onOpenChange={(open) => !open && setRowToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete homework</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &quot;{rowToDelete?.title}&quot;? This permanently removes the assignment
              along with every student submission, file, and mark. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (rowToDelete) {
                  deleteHomework.mutate(rowToDelete.id);
                  setRowToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteHomework.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
