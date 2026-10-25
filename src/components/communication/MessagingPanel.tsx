import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  Megaphone,
  MessageSquare,
  MousePointerClick,
  Plus,
  Search,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MobileSheet } from "@/components/shared/sheets";
import { EmptyState } from "@/components/shared/surfaces";
import { formatNoticeDate } from "@/components/notices/noticeMeta";
import {
  isConversationUnread,
  useClassStudents,
  useConversations,
  useTeacherClasses,
} from "@/hooks/useConversations";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { getDisplayName } from "@/lib/displayName";
import { cn, formatClassName } from "@/lib/utils";

import { MessageThread } from "./MessageThread";
import { conversationTitle, initialsOf, useParticipantNames } from "./conversationNames";

interface Props {
  institutionId: string;
}

/**
 * Messaging for teachers and students: one inbox of threads on the left, the
 * open thread on the right.
 *
 * The previous teacher view had no inbox at all. It opened on a "Select
 * Class" dropdown and a student roster, so a teacher with three unread
 * replies saw none of them until they guessed the right student. Now both
 * roles start from their conversations; a teacher additionally gets "New
 * message", which is where the class and student pickers moved.
 *
 * At phone widths the two columns become two screens: the list, then the
 * thread with a back arrow.
 */
export function MessagingPanel({ institutionId }: Props) {
  const { data: roleInfo } = useUserRole();
  const { activeViewRole, hasDualRole } = useActiveRole();

  const isTeacher = hasDualRole
    ? activeViewRole === "teacher"
    : Boolean(roleInfo?.isTeacher) && !roleInfo?.isSchoolAdmin && !roleInfo?.isCoordinator;

  return <ConversationWorkspace institutionId={institutionId} canCompose={isTeacher} />;
}

/* --------------------------------------------------------------- workspace */

function ConversationWorkspace({
  institutionId,
  canCompose,
}: {
  institutionId: string;
  canCompose: boolean;
}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { conversations, isLoading, isError, refetch, getOrCreateConversation } =
    useConversations(institutionId);
  const names = useParticipantNames(conversations, userId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  // Deep link from the notification bell: ?conversation=<id> opens that
  // thread once the list has loaded, then the param is consumed so a refresh
  // or back-navigation does not force it open again. Only a thread the
  // reader can actually see is opened; an unknown id is ignored.
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedConversationId = searchParams.get("conversation");
  useEffect(() => {
    if (!linkedConversationId || isLoading) return;
    if (conversations.some((c) => c.id === linkedConversationId)) {
      setSelectedId(linkedConversationId);
    }
    const next = new URLSearchParams(searchParams);
    next.delete("conversation");
    setSearchParams(next, { replace: true });
  }, [linkedConversationId, isLoading, conversations, searchParams, setSearchParams]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  const renderList = () => {
    // Error before empty (CLAUDE.md section 6).
    if (isError) {
      return (
        <EmptyState
          size="sm"
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="rose"
          title="Couldn't load your messages"
          description="Something went wrong reaching the server."
          reason="error"
          action={{ label: "Retry", onClick: () => refetch() }}
        />
      );
    }
    if (isLoading) {
      return (
        <ul className="divide-y divide-surface-stroke" aria-busy="true" aria-label="Loading conversations">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="flex items-start gap-3 px-4 py-3">
              <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-ink-400/15" />
              <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                <span className="block h-3.5 w-1/2 animate-pulse rounded bg-ink-400/15" />
                <span className="block h-3 w-5/6 animate-pulse rounded bg-ink-400/10" />
              </div>
            </li>
          ))}
        </ul>
      );
    }
    if (conversations.length === 0) {
      return canCompose ? (
        <EmptyState
          size="sm"
          icon={<MessageSquare className="h-5 w-5" />}
          title="No conversations yet"
          description="Write to a student, or to a whole class at once."
          reason="noData"
          action={{ label: "New message", onClick: () => setComposerOpen(true) }}
        />
      ) : (
        <EmptyState
          size="sm"
          icon={<MessageSquare className="h-5 w-5" />}
          title="No messages yet"
          description="When a teacher writes to you, the thread appears here."
          reason="noData"
        />
      );
    }

    return (
      <ul className="divide-y divide-surface-stroke">
        {conversations.map((c) => {
          const title = conversationTitle(c, names.data ?? {}, userId);
          const last = c.conversation_messages[0];
          const active = c.id === selectedId;
          // The open thread is being read right now, so no dot there.
          const unread = !active && isConversationUnread(c, userId);
          const isClass = c.type !== "direct";
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setSelectedId(c.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary/40",
                  active ? "bg-brand-primary/5" : "hover:bg-ink-400/5",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
                    isClass
                      ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                      : "bg-brand-primary/10 text-brand-primary",
                  )}
                >
                  {isClass ? <Megaphone className="h-4 w-4" /> : initialsOf(title)}
                  {unread && (
                    <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-brand-primary ring-2 ring-[hsl(var(--surface-card))]" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span
                      className={cn(
                        "min-w-0 truncate text-[14px] leading-5 text-ink-900",
                        unread ? "font-semibold" : "font-medium",
                      )}
                    >
                      {title}
                    </span>
                    <span className="shrink-0 text-[12px] leading-4 tabular-nums text-ink-500">
                      {formatNoticeDate(last?.created_at ?? c.updated_at)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 block truncate text-[13px] leading-[18px]",
                      unread ? "text-ink-700" : "text-ink-500",
                    )}
                  >
                    {last?.content?.trim() || (isClass ? "Class thread" : "No messages yet")}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="surface-card frosted-shadow rounded-card flex h-[calc(100dvh-var(--app-bar-height,61px)-13rem)] min-h-[480px] overflow-hidden">
      {/* Left: the inbox. Hidden on phones while a thread is open. */}
      <aside
        className={cn(
          "flex w-full flex-col border-surface-stroke lg:w-[360px] lg:shrink-0 lg:border-r",
          selectedId && "hidden lg:flex",
        )}
        aria-label="Conversations"
      >
        <div className="flex items-center justify-between gap-3 border-b border-surface-stroke px-4 py-3">
          <h3 className="text-[15px] font-semibold text-ink-900">Conversations</h3>
          {canCompose && (
            <Button
              size="sm"
              onClick={() => setComposerOpen(true)}
              className="gap-1.5 bg-brand-primary text-white hover:bg-brand-primary/90"
            >
              <Plus className="h-4 w-4" aria-hidden />
              New message
            </Button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">{renderList()}</div>
      </aside>

      {/* Right: the open thread. Hidden on phones until one is chosen. */}
      <section
        className={cn("flex min-w-0 flex-1 flex-col", !selectedId && "hidden lg:flex")}
        aria-label="Open conversation"
      >
        {selectedId ? (
          <>
            <div className="flex items-center gap-2 border-b border-surface-stroke px-2 py-2 lg:hidden">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedId(null)}
                className="gap-1.5 text-ink-700"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                All conversations
              </Button>
              {selected && (
                <span className="min-w-0 truncate text-sm font-medium text-ink-900">
                  {conversationTitle(selected, names.data ?? {}, userId)}
                </span>
              )}
            </div>
            <div className="min-h-0 flex-1">
              <MessageThread conversationId={selectedId} />
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-ink-400/10 text-ink-500">
              <MousePointerClick className="h-5 w-5" aria-hidden />
            </span>
            <div className="max-w-[240px] space-y-1">
              <p className="text-[14px] font-semibold text-ink-700">Nothing open</p>
              <p className="text-[13px] leading-[18px] text-ink-500">
                {canCompose
                  ? "Choose a conversation on the left, or start a new one."
                  : "Choose a conversation on the left to read it here."}
              </p>
            </div>
          </div>
        )}
      </section>

      {canCompose && (
        <NewMessageSheet
          open={composerOpen}
          onOpenChange={setComposerOpen}
          institutionId={institutionId}
          pending={getOrCreateConversation.isPending}
          onStart={async (args) => {
            const result = await getOrCreateConversation.mutateAsync({
              institutionId,
              ...args,
            });
            setComposerOpen(false);
            setSelectedId(result.id);
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------- composer */

function NewMessageSheet({
  open,
  onOpenChange,
  pending,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string;
  pending: boolean;
  onStart: (args: {
    type: "direct" | "class_announcement";
    classId: string;
    targetUserId?: string;
  }) => Promise<void>;
}) {
  const [classId, setClassId] = useState("");
  const [search, setSearch] = useState("");

  const { data: classes, isLoading: classesLoading } = useTeacherClasses();
  const { data: students, isLoading: studentsLoading } = useClassStudents(classId || null);

  const classOptions = useMemo(
    () =>
      (classes ?? []).map((c: { id: string; name: string; section: string | null }) => ({
        id: c.id,
        label: formatClassName(c.name, c.section),
      })),
    [classes],
  );

  const visibleStudents = useMemo(() => {
    const list = (students ?? []) as { id: string; full_name: string | null; email: string | null }[];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) => getDisplayName(s, "").toLowerCase().includes(q));
  }, [students, search]);

  const className = classOptions.find((c) => c.id === classId)?.label;

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      desktopWidth="md"
      icon={<MessageSquare className="h-4 w-4" />}
      title="New message"
      subtitle="Pick a class, then one student or the whole class"
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Label>Class</Label>
          {classesLoading ? (
            <p className="flex items-center gap-2 text-sm text-ink-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading your classes…
            </p>
          ) : classOptions.length === 0 ? (
            <p className="text-sm text-ink-600">
              You aren't assigned to any class yet, so there is nobody to message.
            </p>
          ) : (
            <Select
              value={classId}
              onValueChange={(v) => {
                setClassId(v);
                setSearch("");
              }}
            >
              <SelectTrigger aria-label="Class">
                <SelectValue placeholder="Choose a class" />
              </SelectTrigger>
              <SelectContent>
                {classOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {classId && (
          <div className="space-y-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => void onStart({ type: "class_announcement", classId })}
              className="flex w-full items-center gap-3 rounded-xl border border-brand-primary/30 bg-brand-primary/5 px-4 py-3 text-left transition-colors duration-200 hover:bg-brand-primary/10 disabled:opacity-60"
            >
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
                <Users className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink-900">
                  Message the whole of {className ?? "this class"}
                </span>
                <span className="block text-[13px] leading-[18px] text-ink-600">
                  Every student in the class sees one shared thread.
                </span>
              </span>
            </button>

            <div className="space-y-2">
              <Label htmlFor="new-message-search">Or one student</Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500"
                  aria-hidden
                />
                <Input
                  id="new-message-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name"
                  className="pl-9"
                />
              </div>

              {studentsLoading ? (
                <p className="flex items-center gap-2 py-2 text-sm text-ink-500">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Loading students…
                </p>
              ) : visibleStudents.length === 0 ? (
                <p className="py-2 text-sm text-ink-500">
                  {search.trim() ? "No student matches that name." : "No students are enrolled in this class yet."}
                </p>
              ) : (
                <ul className="max-h-64 divide-y divide-surface-stroke overflow-y-auto rounded-xl border border-surface-stroke">
                  {visibleStudents.map((s) => {
                    const name = getDisplayName(s, "Unnamed student");
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            void onStart({ type: "direct", classId, targetUserId: s.id })
                          }
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-200 hover:bg-ink-400/5 disabled:opacity-60"
                        >
                          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-[12px] font-semibold text-brand-primary">
                            {initialsOf(name)}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{name}</span>
                          {pending && <Loader2 className="h-4 w-4 animate-spin text-ink-400" aria-hidden />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </MobileSheet>
  );
}
