import { useUserRole } from "@/hooks/useUserRole";
import { useIsTimetableManager } from "@/hooks/useIsTimetableManager";
import { useIsStaffManager } from "@/hooks/useIsStaffManager";
import { useIsStudentManager } from "@/hooks/useIsStudentManager";
import { useInstitutionContext } from "@/contexts/InstitutionContext";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { useIsOlympiadOnlyInstitution, olympiadHomePath } from "@/hooks/olympiad/useIsOlympiadOnlyInstitution";
import { FEATURE_URL_MAP } from "@/components/admin/institution-wizard/featuresData";
import { useDuaCanView } from "@/hooks/deletedUsers/useDeletedUsers";
import {
  LayoutDashboard,
  FileText,
  Plus,
  ClipboardCheck,
  CalendarCheck,
  Users,
  GraduationCap,
  Building2,
  BookOpen,
  Calendar,
  Inbox,
  Trophy,
  RefreshCcw,
  Award,
  BarChart3,
  CreditCard,
  Shield,
  Layers,
  ClipboardList,
  Activity,
  Brain,
  Building,
  MessageSquare,
  IndianRupee,
  Briefcase,
  CalendarDays,
  Medal,
  Sparkles,
  CalendarPlus,
  NotebookPen,
  Target, UserCheck,
} from "lucide-react";
import { UserX } from "lucide-react";

/**
 * The navigation tree for the signed-in user: one list of groups, each a list
 * of pages, already narrowed to the active view role, per-user override
 * grants, the Olympiad-only lockdown and the school's enabled features.
 *
 * Moved out of AppSidebar (2026-10-21) so every navigation surface reads the
 * SAME list: the desktop sidebar, the phone bottom bar (first entries), the
 * phone "More" sheet (the rest) and the in-page section tabs. Order matters:
 * the phone bar takes Home plus the first three groups, so put the groups a
 * role uses most first.
 */
export interface NavItem {
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  hasBadge?: boolean;
  tourId?: string;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

/** Icon for a group when it is shown as ONE entry (phone bar, phone More). */
export const GROUP_ICONS: Record<string, typeof LayoutDashboard> = {
  Main: LayoutDashboard,
  Administration: Shield,
  Monitoring: Activity,
  "School Management": Building2,
  Academic: GraduationCap,
  Academics: GraduationCap,
  Curriculum: BookOpen,
  Exams: FileText,
  "My Wing": Layers,
  Operations: Briefcase,
  Work: Briefcase,
  Resources: Building2,
  Olympiad: Medal,
  Progress: Trophy,
  "Diary & Notices": NotebookPen,
  Records: IndianRupee,
};

export function useNavGroups(): NavGroup[] {
  const { data: roleInfo } = useUserRole();
  const { isManagingInstitution } =
    useInstitutionContext();
  const { activeViewRole, hasDualRole } = useActiveRole();
  const { isFeatureEnabled } = useInstitutionFeatures();
  // Per-user override grants: a named teacher given school-management
  // rights without a role change. These add tabs to THAT teacher's sidebar
  // only; every other user is unaffected.
  //   - tt_manager_overrides   → full Timetable + Academic Calendar
  //   - staff_manager_overrides → manage teaching staff (Teachers tab)
  const { isTimetableManager } = useIsTimetableManager();
  const { isStaffManager } = useIsStaffManager();
  const { isStudentManager } = useIsStudentManager();
  // Deleted Users shows only to the archive owner (dua.viewers), asked of the
  // server once per 5 minutes and only for super admins.
  const { data: canViewDeletedUsers } = useDuaCanView(Boolean(roleInfo?.isSuperAdmin));
  // Onboarded (net-new) Olympiad-only schools collapse the entire sidebar to a
  // single Olympiad tab. Never applies to super admins (keeps full nav even
  // when managing such a school) or to existing SALCI schools.
  const { isOlympiadOnly } = useIsOlympiadOnlyInstitution();
  // Filter sidebar items by institution features (for all institution-bound roles)
  const shouldFilterByFeatures = roleInfo?.isSchoolAdmin || roleInfo?.isTeacher || roleInfo?.isCoordinator || roleInfo?.isStudent || (roleInfo?.isSuperAdmin && isManagingInstitution);

  const filterItemsByFeature = <T extends { url: string }>(items: T[]): T[] => {
    if (!shouldFilterByFeatures) return items;
    return items.filter((item) => {
      const featureId = FEATURE_URL_MAP[item.url];
      return !featureId || isFeatureEnabled(featureId);
    });
  };

  // For dual-role users, determine which role's navigation to show
  const shouldShowTeacherNav = () => {
    if (!hasDualRole) return roleInfo?.isTeacher;
    return activeViewRole === "teacher";
  };

  const shouldShowCoordinatorNav = () => {
    if (!hasDualRole) return roleInfo?.isCoordinator;
    return activeViewRole === "coordinator";
  };

  // An admin who also teaches gets ONE portal at a time, the same way a
  // teacher+coordinator does. Without this the sidebar renders the admin
  // groups AND the teacher groups stacked together, including two groups both
  // named "Work" that collide on key={group.group} and on the persisted
  // open-groups list.
  const shouldShowAdminNav = () => {
    if (!hasDualRole) return roleInfo?.isSchoolAdmin;
    return activeViewRole === "admin";
  };

  // Define navigation items based on role and institution management state
  const getNavItems = () => {
    const items: {
      group: string;
      items: {
        title: string;
        url: string;
        icon: typeof LayoutDashboard;
        hasBadge?: boolean;
        tourId?: string;
      }[];
    }[] = [];

    // When Super Admin is managing an institution, show school admin navigation
    if (roleInfo?.isSuperAdmin && isManagingInstitution) {
      items.push({
        group: "Main",
        items: [
          {
            title: "Dashboard",
            url: "/dashboard",
            icon: LayoutDashboard,
            tourId: "dashboard",
          },
        ],
      });
      items.push({
        group: "School Management",
        items: [
          { title: "Manage Users", url: "/school/users", icon: Users },
          // Gated by FEATURE_URL_MAP["/school/admissions"] (feature `admissions`).
          { title: "Admissions", url: "/school/admissions", icon: UserCheck },
          {
            title: "Classes",
            url: "/school/classes",
            icon: Layers,
            tourId: "classes",
          },
          { title: "Wings", url: "/school/wings", icon: Building },
          {
            title: "Syllabus",
            url: "/school/syllabus",
            icon: BookOpen,
            tourId: "syllabus",
          },
        ],
      });
      items.push({
        group: "Academic",
        items: [
          {
            title: "All Exams",
            url: "/school/exams",
            icon: FileText,
            tourId: "exams",
          },
          {
            title: "Recheck Requests",
            url: "/school/rechecks",
            icon: RefreshCcw,
          },
          {
            title: "Analytics",
            url: "/school/analytics",
            icon: BarChart3,
            tourId: "analytics",
          },
          {
            title: "Question Bank",
            url: "/question-bank",
            icon: Layers,
          },
        ],
      });
      // Operations = running the school day. Work = the admin's own desk
      // (their tasks, the money, the audit trail). Split out of one 10-item
      // group that was too deep to scan; keep both branches of this admin nav
      // (here and the school_admin branch below) in sync.
      items.push({
        group: "Operations",
        items: [
          { title: "Attendance", url: "/school/attendance", icon: ClipboardCheck },
          { title: "Academic Calendar", url: "/school/calendar", icon: CalendarDays },
          { title: "Timetable", url: "/school/timetable", icon: Calendar },
          { title: "Shared Resources", url: "/school/shared-resources", icon: Building2 },
          { title: "Communication", url: "/school/communication", icon: MessageSquare },
        ],
      });
      items.push({
        group: "Work",
        items: [
          {
            title: "Task Management",
            url: "/tasks",
            icon: ClipboardList,
            tourId: "tasks",
          },
          { title: "Fee Management", url: "/school/fees", icon: IndianRupee },
          { title: "HR & Payroll", url: "/school/hr", icon: Briefcase },
          // No Workday here: a super admin is not on the school's staff and
          // the /staff/workday route excludes super_admin, so the link only
          // bounced to the dashboard. The school-admin block below keeps it.
          { title: "Activity Logs", url: "/school/activity", icon: Activity },
          { title: "Billing", url: "/school/billing", icon: CreditCard },
        ],
      });
      return items.map(g => ({ ...g, items: filterItemsByFeature(g.items) })).filter(g => g.items.length > 0);
    }

    // Everyone has dashboard
    items.push({
      group: "Main",
      items: [
        {
          // Teachers, coordinators and school admins call this "Home": their
          // real data surface is the tile labelled "Dashboard"
          // (/school/snapshot), so leaving both named "Dashboard" would point
          // at two different pages. Students have no separate analytics page,
          // so they keep "Dashboard". Dual-role users follow the active view.
          title:
            shouldShowTeacherNav() || shouldShowCoordinatorNav() || roleInfo?.isSchoolAdmin
              ? "Home"
              : "Dashboard",
          url: "/dashboard",
          icon: LayoutDashboard,
          tourId: "dashboard",
        },
      ],
    });

    // Super Admin navigation
    if (roleInfo?.isSuperAdmin) {
      items.push({
        group: "Administration",
        items: [
          {
            title: "Institutions",
            url: "/admin/institutions",
            icon: Building2,
            tourId: "institutions",
          },
          {
            title: "Non-SALCI Schools",
            url: "/admin/non-salci-schools",
            icon: Building,
          },
          { title: "Users", url: "/admin/users", icon: Users, tourId: "users" },
          {
            title: "AI Quotas",
            url: "/admin/ai-quotas",
            icon: Brain,
            tourId: "ai-quota",
          },
          {
            title: "Employee Levels",
            url: "/admin/employee-levels",
            icon: Layers,
          },
          {
            title: "Syllabus",
            url: "/admin/syllabus",
            icon: BookOpen,
            tourId: "syllabus",
          },
          {
            title: "Question Bank",
            url: "/admin/question-bank",
            icon: Layers,
            tourId: "question-bank",
          },
          {
            title: "Olympiad",
            url: "/admin/olympiad",
            icon: Medal,
          },
          {
            title: "Analytics",
            url: "/admin/analytics",
            icon: BarChart3,
            tourId: "analytics",
          },
          {
            title: "Payments",
            url: "/admin/payments",
            icon: CreditCard,
            tourId: "payments",
          },
          { title: "Access Control", url: "/admin/access", icon: Shield },
        ],
      });
      items.push({
        group: "Monitoring",
        items: [
          {
            title: "All Exams",
            url: "/admin/exams",
            icon: FileText,
            tourId: "exams",
          },
          {
            title: "All Teachers",
            url: "/admin/teachers",
            icon: GraduationCap,
          },
          { title: "All Students", url: "/admin/students", icon: Users },
          { title: "Activity Logs", url: "/admin/activity", icon: Activity },
          ...(canViewDeletedUsers ? [{ title: "Deleted Users", url: "/admin/deleted-users", icon: UserX }] : []),
          // Reports retired 2026-09-10 (see the /reports route note in App.tsx).
        ],
      });
    }

    // School Admin navigation
    if (shouldShowAdminNav()) {
      items.push({
        group: "School Management",
        items: [
          { title: "Manage Users", url: "/school/users", icon: Users },
          {
            title: "Classes",
            url: "/school/classes",
            icon: Layers,
            tourId: "classes",
          },
          { title: "Wings", url: "/school/wings", icon: Building },
          {
            title: "Syllabus",
            url: "/school/syllabus",
            icon: BookOpen,
            tourId: "syllabus",
          },
        ],
      });
      items.push({
        group: "Academic",
        items: [
          {
            title: "All Exams",
            url: "/school/exams",
            icon: FileText,
            tourId: "exams",
          },
          { title: "Homework and Assignment", url: "/homework", icon: ClipboardList },
          {
            title: "Recheck Requests",
            url: "/school/rechecks",
            icon: RefreshCcw,
          },
          {
            title: "Analytics",
            url: "/school/analytics",
            icon: BarChart3,
            tourId: "analytics",
          },
          {
            title: "Question Bank",
            url: "/question-bank",
            icon: Layers,
          },
          {
            title: "Olympiad",
            url: "/school/olympiad",
            icon: Medal,
          },
        ],
      });
      // Mirrors the super-admin-while-managing branch above — same two groups.
      items.push({
        group: "Operations",
        items: [
          { title: "Attendance", url: "/school/attendance", icon: ClipboardCheck },
          { title: "Academic Calendar", url: "/school/calendar", icon: CalendarDays },
          { title: "Timetable", url: "/school/timetable", icon: Calendar },
          { title: "Shared Resources", url: "/school/shared-resources", icon: Building2 },
          { title: "Communication", url: "/school/communication", icon: MessageSquare },
        ],
      });
      items.push({
        group: "Work",
        items: [
          {
            title: "Task Management",
            url: "/tasks",
            icon: ClipboardList,
            tourId: "tasks",
          },
          { title: "Fee Management", url: "/school/fees", icon: IndianRupee },
          { title: "HR & Payroll", url: "/school/hr", icon: Briefcase },
          // Staff side of attendance: the admin's own check-in and leave,
          // staff attendance, the staff leave queue, substitutions.
          // Operations → Attendance above is students only.
          { title: "Workday", url: "/staff/workday", icon: CalendarCheck },
          { title: "Activity Logs", url: "/school/activity", icon: Activity },
          { title: "Billing", url: "/school/billing", icon: CreditCard },
        ],
      });

    }

    // Coordinator navigation - show only when in coordinator view (for dual-role) or single coordinator role
    if (shouldShowCoordinatorNav()) {
      items.push({
        group: "My Wing",
        items: [
          { title: "My Classes", url: "/coordinator/classes", icon: Layers },
          { title: "Students", url: "/coordinator/students", icon: Users },
          {
            title: "Teachers",
            url: "/coordinator/teachers",
            icon: GraduationCap,
          },
        ],
      });
      items.push({
        group: "Curriculum",
        items: [
          { title: "Syllabus", url: "/school/syllabus", icon: BookOpen },
          {
            title: "Question Bank",
            url: "/question-bank",
            icon: Layers,
          },
        ],
      });
      items.push({
        group: "Academic",
        items: [
          {
            title: "Class Exams",
            url: "/coordinator/exams",
            icon: FileText,
            tourId: "exams",
          },
          { title: "Create Exam", url: "/exams/create", icon: Plus },
          { title: "Homework and Assignment", url: "/homework", icon: ClipboardList },
          {
            title: "Recheck Requests",
            url: "/coordinator/rechecks",
            icon: RefreshCcw,
          },
        ],
      });
      // Same split as the admin branches, and the same shape as the teacher
      // nav below: Operations = running the wing day-to-day, Work = this
      // coordinator's own desk. Was one 12-item group.
      items.push({
        group: "Operations",
        items: [
          { title: "Attendance", url: "/school/attendance", icon: ClipboardCheck },
          { title: "Academic Calendar", url: "/school/calendar", icon: CalendarDays },
          { title: "Timetable", url: "/school/timetable", icon: Calendar },
          { title: "Shared Resources", url: "/school/shared-resources", icon: Building2 },
          { title: "Communication", url: "/school/communication", icon: MessageSquare },
        ],
      });
      items.push({
        group: "Work",
        items: [
          {
            title: "Tasks",
            url: "/coordinator/tasks",
            icon: Inbox,
            tourId: "tasks",
          },
          // Own check-in and leave, plus the wing's staff attendance, staff
          // leave queue and substitutions. Operations → Attendance is students.
          { title: "Workday", url: "/staff/workday", icon: CalendarCheck },
          { title: "My Salary", url: "/staff/my-salary", icon: IndianRupee },
          // Own individual targets, if the coordinator has been given any
          // directly (tt_target_eligible admits both teacher and coordinator).
          // Also lives in the teacher branch below — a dual-role
          // teacher+coordinator user defaults to teacher view, so it must be
          // reachable from both branches, not just this one.
          { title: "My Targets", url: "/teacher/my-targets", icon: Target },
          {
            title: "Analytics",
            url: "/coordinator/analytics",
            icon: BarChart3,
            tourId: "analytics",
          },
          // Reports retired 2026-09-10. The coordinator entry was the page's only
          // legitimate nav home, and it was institution-wide in code while the
          // living docs described it as wing-scoped. Wing aggregates live on
          // /school/snapshot (DashboardScope + the dash_scoped_* family).
          {
            title: "Achievements",
            url: "/achievements",
            icon: Award,
            tourId: "achievements",
          },
          {
            title: "Leaderboard",
            url: "/leaderboard",
            icon: Trophy,
            tourId: "leaderboard",
          },
        ],
      });
    }

    // Teacher navigation - show only when in teacher view (for dual-role) or single teacher role
    if (shouldShowTeacherNav()) {
      items.push({
        group: "Curriculum",
        items: [
          { title: "Syllabus", url: "/school/syllabus", icon: BookOpen },
          {
            title: "Question Bank",
            url: "/question-bank",
            icon: Layers,
          },
          {
            title: "Olympiad",
            url: "/teacher/olympiad",
            icon: Medal,
          },
        ],
      });
      items.push({
        group: "Exams",
        items: [
          { title: "My Exams", url: "/exams", icon: FileText, tourId: "exams" },
          { title: "Create Exam", url: "/exams/create", icon: Plus },
          { title: "Homework and Assignment", url: "/homework", icon: ClipboardList },
        ],
      });
      items.push({
        group: "Academics",
        items: [
          { title: "Timetable", url: "/teacher/my-week", icon: CalendarDays },
          { title: "My Students", url: "/teacher/students", icon: Users },
          { title: "Attendance", url: "/school/attendance", icon: ClipboardCheck },
          { title: "Communication", url: "/school/communication", icon: MessageSquare },
          // shouldShowCoordinatorNav() keys off activeViewRole, and a
          // teacher+coordinator user defaults to teacher view (viewRoles[0]),
          // so this row must live here too, not only in the coordinator branch.
          { title: "My Targets", url: "/teacher/my-targets", icon: Target },
          {
            title: "Achievements",
            url: "/achievements",
            icon: Award,
            tourId: "achievements",
          },
        ],
      });
      // Per-user override grants: surface the school-management tabs the
      // ONE teacher has been granted (no role change). Each item is gated on
      // its own grant so the group only shows what was actually granted.
      // ("Academic Calendar" already lives in the Work group below.)
      {
        const schoolMgmtItems: { title: string; url: string; icon: typeof LayoutDashboard }[] = [];
        if (isTimetableManager) {
          schoolMgmtItems.push({ title: "School Timetable", url: "/school/timetable", icon: Calendar });
          schoolMgmtItems.push({ title: "Shared Resources", url: "/school/shared-resources", icon: Building2 });
        }
        if (isStaffManager) {
          schoolMgmtItems.push({ title: "Manage Teachers", url: "/school/manage-teachers", icon: GraduationCap });
        }
        if (isStudentManager) {
          schoolMgmtItems.push({ title: "Manage Students", url: "/school/manage-students", icon: Users });
        }
        if (schoolMgmtItems.length > 0) {
          items.push({ group: "School Management", items: schoolMgmtItems });
        }
      }
      items.push({
        group: "Work",
        items: [
          { title: "Academic Calendar", url: "/school/calendar", icon: CalendarDays },
          // Own check-in, attendance history and leave; Academics →
          // Attendance above is the class roster.
          { title: "Workday", url: "/staff/workday", icon: CalendarCheck },
          { title: "My Salary", url: "/staff/my-salary", icon: IndianRupee },
          { title: "Tasks", url: "/tasks", icon: Inbox, tourId: "tasks" },
          // Reports is deliberately absent for teachers. /reports rendered the
          // "Teacher Overview" dashboard, which was built on three tables that
          // are empty or unmaintained in prod (student_topic_performance has no
          // writer at all), so ~68% of teachers saw a page of zeroes and none of
          // the numbers were scoped to the teacher's own subject. Removed
          // 2026-08-18 rather than kept as a broken tab. Coordinators and admins
          // keep /reports.
          {
            title: "Leaderboard",
            url: "/leaderboard",
            icon: Trophy,
            tourId: "leaderboard",
          },
        ],
      });
    }

    // Student navigation.
    //
    // Five groups, each answering one question for the student:
    //   Academics        — does this help me learn or track coursework?
    //   Exams            — is this graded / assessment-related?
    //   Progress         — is this status / gamification, not a task?
    //   Diary & Notices  — is this a message, note or scheduled interaction?
    //   Records          — is this a document or account record about me?
    // Keep new student tabs inside one of these rather than adding a sixth
    // group; the taxonomy is what makes the sidebar scannable.
    if (roleInfo?.isStudent) {
      items.push({
        group: "Academics",
        items: [
          {
            title: "My Week",
            url: "/student/my-week",
            icon: CalendarDays,
          },
          {
            title: "Attendance",
            url: "/student/attendance",
            icon: ClipboardCheck,
          },
          {
            title: "Homework",
            url: "/student/homework",
            icon: ClipboardList,
          },
          {
            title: "Study Materials",
            url: "/student/study-materials",
            icon: BookOpen,
            tourId: "study-materials",
          },
        ],
      });
      items.push({
        group: "Exams",
        items: [
          {
            title: "Upcoming Exams",
            url: "/student/exams",
            icon: Calendar,
            tourId: "upcoming-exams",
          },
          {
            title: "My Results",
            url: "/student/results",
            icon: Trophy,
            tourId: "results",
          },
          {
            title: "Recheck Requests",
            url: "/student/rechecks",
            icon: RefreshCcw,
          },
          // Olympiad is an assessment the student sits, so it answers the
          // Exams question rather than earning a group of its own.
          {
            title: "Olympiad",
            url: "/student/olympiad",
            icon: Medal,
          },
        ],
      });
      items.push({
        group: "Progress",
        items: [
          {
            title: "Achievements",
            url: "/achievements",
            icon: Award,
            tourId: "achievements",
          },
          {
            title: "Leaderboard",
            url: "/leaderboard",
            icon: Trophy,
            tourId: "leaderboard",
          },
        ],
      });
      // One row, no dropdown: a single-item group renders as a plain link.
      // Notice Board, School Diary, Messages and PTM appointments are the
      // Communication page's own tabs, so the sidebar just opens the page.
      items.push({
        group: "Diary & Notices",
        items: [
          {
            title: "Diary & Notices",
            url: "/school/communication",
            icon: NotebookPen,
          },
        ],
      });
      items.push({
        group: "Records",
        items: [
          {
            title: "My Fees",
            url: "/student/fees",
            icon: IndianRupee,
          },
          {
            title: "Leave Application",
            url: "/student/leave",
            icon: CalendarPlus,
          },
          {
            title: "Learning Passport",
            url: "/student/passport",
            icon: Sparkles,
          },
        ],
      });
    }

    return items.map(g => ({ ...g, items: filterItemsByFeature(g.items) })).filter(g => g.items.length > 0);
  };

  // Olympiad-only onboarded schools: every non-super role sees ONLY the
  // Olympiad tab — all other nav groups are suppressed.
  const olympiadOnly = isOlympiadOnly && !roleInfo?.isSuperAdmin;
  const navGroups = olympiadOnly
    ? [
        {
          group: "Olympiad",
          items: [
            {
              title: "Olympiad",
              url: olympiadHomePath(roleInfo),
              icon: Medal,
            },
          ],
        },
      ]
    : getNavItems();

  return navGroups;
}

/**
 * The single most specific nav url matching `pathname`, or null. Nav urls
 * nest ("My Exams" = /exams, "Create Exam" = /exams/create), so the longest
 * match is the real destination.
 */
export function activeNavUrl(groups: NavGroup[], pathname: string): string | null {
  let best: string | null = null;
  for (const g of groups) {
    for (const item of g.items) {
      const matches = pathname === item.url || pathname.startsWith(item.url + "/");
      if (matches && (best === null || item.url.length > best.length)) best = item.url;
    }
  }
  return best;
}
