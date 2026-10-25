import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  Loader2,
  Megaphone,
  MessageSquare,
  NotebookPen,
  Send,
} from "lucide-react";

import { PageHeader, PageShell } from "@/components/shared/page";
import { MobileTabs, type MobileTabOption } from "@/components/shared/nav";
import { EmptyState } from "@/components/shared/surfaces";
import { MessagingPanel } from "@/components/communication/MessagingPanel";
import { NoticeBoard } from "@/components/notices";
import { SchoolDiary } from "@/components/diary";
import { PTMPanel } from "@/components/ptm/PTMPanel";
import { PTM_FEATURE_ID } from "@/lib/ptm";
import { CommunicationAnalytics } from "@/components/communication/CommunicationAnalytics";
import { MessagesTab } from "@/components/communication/MessagesTab";
import { useUserRole } from "@/hooks/useUserRole";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { useProfileData } from "@/hooks/useProfileData";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { useAuth } from "@/hooks/useAuth";
import { isConversationUnread, useConversations } from "@/hooks/useConversations";
import { useUnreadNoticeCount } from "@/hooks/notices";
import { useMarkDiaryNotificationsRead, useUnreadDiaryCount } from "@/hooks/diary";

type CommTab = "messaging" | "notices" | "diary" | "ptm" | "analytics" | "messages";

const TAB_ICON = "h-4 w-4";

/**
 * Communication hub: messaging, the Notice Board, PTM scheduling, and for
 * admins the analytics and outbound messages panels.
 *
 * The tab strip is a MobileTabs row rather than a shadcn TabsList: five or
 * six labelled tabs wrapped into two ragged lines at phone widths, and Tabs
 * mounts every panel at once. Only the active panel renders here. The tab
 * lives in `?tab=` (replace, not push) so a refresh keeps the place and other
 * params, such as the Notice Board's `?notice=` deep link, survive alongside.
 */
export default function CommunicationPage() {
  const { data: roleInfo, isLoading: roleLoading } = useUserRole();
  const { activeViewRole, hasDualRole } = useActiveRole();
  const { data: profile, isLoading: profileLoading } = useProfileData();
  const institutionId = profile?.institution_id;
  const { isFeatureEnabled } = useInstitutionFeatures();
  // The diary tab is flag-gated: its RPCs ship in a separate migration, so a
  // school only sees the tab once Tushar has applied it and turned the flag on.
  const diaryEnabled = isFeatureEnabled("school_diary");
  // PTM is flag-gated too (2026-09-28): Tushar turns ptm_scheduling on per
  // school once the PTM migration is applied.
  const ptmEnabled = isFeatureEnabled(PTM_FEATURE_ID);

  const [searchParams, setSearchParams] = useSearchParams();

  // Effective role flags, respecting activeViewRole for dual-role users.
  const isAdmin = Boolean(roleInfo?.isSchoolAdmin) && (!hasDualRole || activeViewRole === "admin");
  const isTeacher = hasDualRole
    ? activeViewRole === "teacher"
    : Boolean(roleInfo?.isTeacher) && !roleInfo?.isSchoolAdmin && !roleInfo?.isCoordinator;
  const isCoordinator = hasDualRole
    ? activeViewRole === "coordinator"
    : Boolean(roleInfo?.isCoordinator) && !roleInfo?.isSchoolAdmin;
  const isStudent = Boolean(roleInfo?.isStudent);
  const canViewAnalytics = Boolean(roleInfo?.isSchoolAdmin) || isCoordinator;
  const canMessage = isTeacher || isStudent;

  // Unread badge on the messaging tab. Shares the list query (and its cache)
  // with MessagingPanel, so this costs no extra request; it counts the rows
  // already on the client, the same way the Notice Board labels its tab.
  const { user } = useAuth();
  const { conversations } = useConversations(
    canMessage || isAdmin ? institutionId ?? null : null,
  );
  const unreadConversations = useMemo(
    () => conversations.filter((c) => isConversationUnread(c, user?.id)).length,
    [conversations, user?.id],
  );

  // Unread badge on the Notice Board tab: notices addressed to this reader
  // that they have not opened (`read_at` is null), counted by the server
  // (notice_unread_count, 2026-09-09). The first version counted the loaded
  // rows of the inbox itself, which fetched a page of notices on every visit
  // just to print a number and could not see past page one.
  const { data: unreadNotices = 0 } = useUnreadNoticeCount();

  // Unread badge on the School Diary tab. The diary has no read receipts, so
  // the count is this reader's unread diary_* notifications (server-side
  // head count). Opening the tab stamps them read, once per visit, and only
  // when there is something to stamp so an idle open sends no request.
  const { data: unreadDiary = 0 } = useUnreadDiaryCount(user?.id, diaryEnabled);

  const tabs = useMemo<(MobileTabOption & { value: CommTab })[]>(() => {
    const list: (MobileTabOption & { value: CommTab })[] = [];
    // Analytics leads for admins and coordinators: it is the overview the
    // rest of the tabs drill into, and it is also their default tab.
    if (canViewAnalytics) {
      list.push({ value: "analytics", label: "Analytics", icon: <BarChart3 className={TAB_ICON} /> });
    }
    if (canMessage) {
      list.push({
        value: "messaging",
        label: isStudent ? "Messages" : "Messaging",
        icon: <MessageSquare className={TAB_ICON} />,
        count: unreadConversations || undefined,
      });
    }
    list.push({
      value: "notices",
      label: "Notice Board",
      icon: <Megaphone className={TAB_ICON} />,
      count: unreadNotices || undefined,
    });
    if (diaryEnabled) {
      list.push({
        value: "diary",
        label: "School Diary",
        icon: <NotebookPen className={TAB_ICON} />,
        count: unreadDiary || undefined,
      });
    }
    if (ptmEnabled) {
      list.push({ value: "ptm", label: "PTM", icon: <Calendar className={TAB_ICON} /> });
    }
    if (isAdmin) {
      list.push({
        value: "messages",
        label: "Messages",
        icon: <Send className={TAB_ICON} />,
        count: unreadConversations || undefined,
      });
      // The Settings tab (CommunicationSettings: email / SMS / WhatsApp
      // provider keys + a "bulk messaging" flag) is hidden on purpose. Nothing
      // in the product calls the `send-communication` edge function it
      // configures, and the flag gates nothing, so the toggles promised
      // delivery channels that do not exist. See CLAUDE.md section 11, Misc.
    }
    return list;
  }, [
    canMessage,
    isStudent,
    canViewAnalytics,
    isAdmin,
    diaryEnabled,
    ptmEnabled,
    unreadConversations,
    unreadNotices,
    unreadDiary,
  ]);

  const defaultTab: CommTab = canMessage ? "messaging" : canViewAnalytics ? "analytics" : "notices";
  const tabParam = searchParams.get("tab");
  // A `?conversation=<id>` deep link (from the notification bell) lands on
  // whichever tab hosts this reader's inbox; MessagingPanel then opens the
  // thread and clears the param. An explicit `tab` still wins.
  const conversationTab: CommTab | null = searchParams.get("conversation")
    ? canMessage
      ? "messaging"
      : isAdmin
        ? "messages"
        : null
    : null;
  const activeTab: CommTab = tabs.some((t) => t.value === tabParam)
    ? (tabParam as CommTab)
    : conversationTab ?? defaultTab;

  // Stamp the diary notifications read when the reader lands on the diary
  // tab. The ref is the single-flight guard: one UPDATE per distinct unread
  // count while the tab is open, so a re-render cannot repeat it, while a new
  // entry arriving mid-visit (count goes up) is still stamped.
  const { mutate: stampDiaryRead } = useMarkDiaryNotificationsRead();
  const stampedDiaryFor = useRef<number | null>(null);
  useEffect(() => {
    if (activeTab !== "diary") {
      stampedDiaryFor.current = null;
      return;
    }
    if (!user?.id || unreadDiary === 0) return;
    if (stampedDiaryFor.current === unreadDiary) return;
    stampedDiaryFor.current = unreadDiary;
    stampDiaryRead(user.id);
  }, [activeTab, user?.id, unreadDiary, stampDiaryRead]);

  const handleTabChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", value);
    // An open PTM (`?ptm=<id>`) belongs to the PTM tab only.
    if (value !== "ptm") next.delete("ptm");
    setSearchParams(next, { replace: true });
  };

  if (roleLoading || profileLoading) {
    return (
      <PageShell>
        <div className="flex min-h-[40vh] items-center justify-center" aria-busy="true">
          <Loader2 className="h-8 w-8 animate-spin text-ink-500" aria-label="Loading" />
        </div>
      </PageShell>
    );
  }

  if (!institutionId) {
    return (
      <PageShell>
        <PageHeader
          title="Communication"
          subtitle="Messaging, Notice Board, PTM and more"
          icon={<MessageSquare className="h-5 w-5" />}
        />
        <EmptyState
          icon={<AlertTriangle className="h-7 w-7" />}
          tone="rose"
          title="No institution found"
          description="Your account is not linked to a school yet. Ask your administrator to check your profile."
          reason="error"
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Communication"
        subtitle={canMessage ? "Messaging, Notice Board, PTM and more" : "Notice Board, analytics and more"}
        icon={<MessageSquare className="h-5 w-5" />}
      />

      <div className="mt-2">
        <MobileTabs value={activeTab} onValueChange={handleTabChange} options={tabs} />
      </div>

      <div className="mt-4">
        {activeTab === "messaging" && canMessage && <MessagingPanel institutionId={institutionId} />}
        {activeTab === "notices" && <NoticeBoard />}
        {activeTab === "diary" && diaryEnabled && <SchoolDiary />}
        {activeTab === "ptm" && ptmEnabled && <PTMPanel institutionId={institutionId} />}
        {activeTab === "analytics" && canViewAnalytics && (
          <CommunicationAnalytics
            institutionId={institutionId}
            onOpenTab={handleTabChange}
            availableTabs={tabs
              .map((t) => t.value)
              .filter((v): v is "notices" | "messages" | "ptm" =>
                v === "notices" || v === "messages" || v === "ptm",
              )}
          />
        )}
        {activeTab === "messages" && isAdmin && <MessagesTab institutionId={institutionId} />}
      </div>
    </PageShell>
  );
}
