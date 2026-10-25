import { useMemo, useState } from "react";
import { AlertTriangle, Hourglass, NotebookPen, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterChip } from "@/components/shared/nav";
import { EmptyState } from "@/components/shared/surfaces";
import { groupNoticesByDate } from "@/components/notices/noticeMeta";
import { useUserRole } from "@/hooks/useUserRole";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { useNoticeTargetOptions } from "@/hooks/notices";
import { isDiaryUnavailableError, useDiaryFeed, type DiaryKind } from "@/hooks/diary";

import { DiaryComposer } from "./DiaryComposer";
import { DiaryEntryCard, DiaryEntrySkeleton } from "./DiaryEntryCard";
import { DIARY_KIND_LIST, diaryKindMeta } from "./diaryMeta";

const ALL = "all";

/**
 * The School Diary: the day-to-day line between a teacher and a family.
 * Homework to finish, a reminder to bring something, a remark about conduct,
 * a word of appreciation. One entry addresses a whole class or one student.
 *
 * Who sees what is decided server-side by `diary_feed`: a student sees entries
 * for them or their class, a teacher the classes they teach, a coordinator
 * their wings, an admin the whole school. The class filter here only narrows
 * inside that scope, and it is applied in SQL, so paging stays honest.
 *
 * Writing is offered to teachers, coordinators and admins; `diary_write_entry`
 * re-checks authority, so the button is a convenience, not the gate.
 */
export function SchoolDiary() {
  const { data: roleInfo, isLoading: roleLoading } = useUserRole();
  const { activeViewRole, hasDualRole } = useActiveRole();
  const { isFeatureEnabled } = useInstitutionFeatures();

  const isAdmin = Boolean(roleInfo?.isSchoolAdmin) && (!hasDualRole || activeViewRole === "admin");
  const isCoordinator = hasDualRole
    ? activeViewRole === "coordinator"
    : Boolean(roleInfo?.isCoordinator) && !roleInfo?.isSchoolAdmin;
  const isTeacher = hasDualRole
    ? activeViewRole === "teacher"
    : Boolean(roleInfo?.isTeacher) && !roleInfo?.isSchoolAdmin && !roleInfo?.isCoordinator;
  const isStudent = Boolean(roleInfo?.isStudent) && !isAdmin && !isCoordinator && !isTeacher;
  const canWrite = isAdmin || isCoordinator || isTeacher;

  const [classFilter, setClassFilter] = useState<string>(ALL);
  const [kindFilter, setKindFilter] = useState<string>(ALL);
  const [composerOpen, setComposerOpen] = useState(false);

  // The same server-scoped class list the Notice Board uses; students get none
  // and need none, since their feed is already theirs.
  const targets = useNoticeTargetOptions(canWrite);
  const classes = targets.data?.classes ?? [];

  const feed = useDiaryFeed(
    {
      classId: classFilter === ALL ? null : classFilter,
      kind: kindFilter === ALL ? null : (kindFilter as DiaryKind),
    },
    !roleLoading,
  );

  const rows = useMemo(() => feed.data?.pages.flatMap((p) => p.rows) ?? [], [feed.data]);
  const grouped = useMemo(() => groupNoticesByDate(rows, (r) => r.created_at), [rows]);

  const activeFilters = (classFilter !== ALL ? 1 : 0) + (kindFilter !== ALL ? 1 : 0);
  const clearFilters = () => {
    setClassFilter(ALL);
    setKindFilter(ALL);
  };

  const classLabel =
    classFilter === ALL ? "All classes" : classes.find((c) => c.id === classFilter)?.label ?? "Class";
  const kindLabel = kindFilter === ALL ? "All kinds" : diaryKindMeta(kindFilter).label;

  // The flag is on but the database half has not been applied. Not a fault,
  // not transient, and Retry will not help, so it gets its own words.
  const unavailable = feed.isError && isDiaryUnavailableError(feed.error);

  const renderList = () => {
    if (unavailable) {
      return (
        <EmptyState
          icon={<Hourglass className="h-7 w-7" />}
          tone="peach"
          title="The diary isn't switched on yet"
          description={
            canWrite
              ? "Your school has the School Diary enabled, but the server update it needs hasn't been applied. Once it is, this tab starts working with no further setup."
              : "Your school is still setting up the School Diary. Check back soon."
          }
          reason="error"
        />
      );
    }

    // Error before empty (CLAUDE.md section 6): a failed RPC must never read
    // as "the diary is empty".
    if (feed.isError) {
      return (
        <EmptyState
          icon={<AlertTriangle className="h-7 w-7" />}
          tone="rose"
          title="Couldn't open the diary"
          description="Something went wrong reaching the server. Try again in a moment."
          reason="error"
          action={{ label: "Retry", onClick: () => feed.refetch() }}
        />
      );
    }

    if (roleLoading || feed.isLoading) {
      return (
        <ul className="grid gap-2.5" aria-busy="true" aria-label="Loading the diary">
          <DiaryEntrySkeleton />
          <DiaryEntrySkeleton />
          <DiaryEntrySkeleton />
        </ul>
      );
    }

    if (rows.length === 0 && activeFilters > 0) {
      return (
        <EmptyState
          icon={<NotebookPen className="h-7 w-7" />}
          tone="sky"
          title="Nothing matches these filters"
          description="Clear the filters to see every entry you have access to."
          reason="noResults"
          action={{ label: "Clear filters", onClick: clearFilters }}
        />
      );
    }

    if (rows.length === 0) {
      return isStudent ? (
        <EmptyState
          icon={<NotebookPen className="h-7 w-7" />}
          title="Nothing in your diary yet"
          description="Homework, reminders and remarks from your teachers will appear here."
          reason="noData"
        />
      ) : (
        <EmptyState
          icon={<NotebookPen className="h-7 w-7" />}
          title="The diary is empty"
          description={
            canWrite
              ? "Write the first entry: homework, a reminder, or a remark for a class or a student."
              : "Entries teachers write for the classes you oversee will appear here."
          }
          reason="noData"
          action={canWrite ? { label: "New entry", onClick: () => setComposerOpen(true) } : undefined}
        />
      );
    }

    return (
      <div className="space-y-5">
        {grouped.map((g) => (
          <section key={g.group} aria-label={g.group}>
            <p className="eyebrow mb-2.5 px-1">{g.group}</p>
            <ul className="grid gap-2.5">
              {g.rows.map((entry) => (
                <DiaryEntryCard key={entry.id} entry={entry} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {canWrite && classes.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <FilterChip
                label={classLabel}
                active={classFilter !== ALL}
                aria-label="Filter by class"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
              <DropdownMenuRadioGroup value={classFilter} onValueChange={setClassFilter}>
                <DropdownMenuRadioItem value={ALL}>All classes</DropdownMenuRadioItem>
                {classes.map((c) => (
                  <DropdownMenuRadioItem key={c.id} value={c.id}>
                    {c.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <FilterChip label={kindLabel} active={kindFilter !== ALL} aria-label="Filter by kind" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuRadioGroup value={kindFilter} onValueChange={setKindFilter}>
              <DropdownMenuRadioItem value={ALL}>All kinds</DropdownMenuRadioItem>
              {DIARY_KIND_LIST.map((k) => (
                <DropdownMenuRadioItem key={k.value} value={k.value}>
                  {k.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {activeFilters > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-10 rounded-full px-3 text-[13px] text-ink-600 hover:bg-ink-400/5"
          >
            Clear
          </Button>
        )}

        {canWrite && (
          <Button
            onClick={() => setComposerOpen(true)}
            disabled={targets.isLoading || unavailable}
            title={unavailable ? "The diary isn't switched on yet" : undefined}
            className="ml-auto shrink-0 gap-1.5 bg-brand-primary text-white hover:bg-brand-primary/90 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New entry
          </Button>
        )}
      </div>

      {isStudent && rows.length > 0 && (
        <p className="text-[13px] leading-[18px] text-ink-500">
          Entries your teachers wrote for you or for your class.
        </p>
      )}

      <div className="lg:max-w-3xl">
        {renderList()}

        {feed.hasNextPage && !feed.isError && (
          <Button
            variant="outline"
            className="mt-4 w-full rounded-full border-surface-stroke text-ink-700 hover:bg-ink-400/5"
            disabled={feed.isFetchingNextPage}
            onClick={() => feed.fetchNextPage()}
          >
            {feed.isFetchingNextPage ? "Loading…" : "Show older entries"}
          </Button>
        )}
      </div>

      {canWrite && (
        <DiaryComposer
          open={composerOpen}
          onOpenChange={setComposerOpen}
          classes={classes}
          defaultClassId={classFilter === ALL ? null : classFilter}
          homeworkModuleEnabled={isFeatureEnabled("homework")}
        />
      )}
    </div>
  );
}
