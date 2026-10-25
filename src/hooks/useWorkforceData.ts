import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { useUserRole } from "@/hooks/useUserRole";
import { differenceInDays, subDays, startOfWeek, format } from "date-fns";
import { getDisplayName } from "@/lib/displayName";

export interface WorkforceUser {
  userId: string;
  name: string;
  role: string;
  roleRaw: string;
  wing: string;
  tasksAssignedByThem: number;
  open: number;
  inProgress: number;
  overdue: number;
  completed: number;
  totalAssigned: number;
  completionPercent: number;
  lastActivity: string | null;
  workloadScore: number;
  // Detail data
  openTasks: { id: string; title: string; dueDate: string | null }[];
  overdueTasks: { id: string; title: string; dueDate: string | null; daysOverdue: number }[];
  assignedByThem: { id: string; title: string; assigneeName: string; status: string }[];
  completedTasks: { id: string; title: string; createdAt: string; completedAt: string }[];
}

export interface WingMetrics {
  wingName: string;
  totalTasks: number;
  open: number;
  overdue: number;
  completionPercent: number;
  avgCompletionDays: number;
}

export interface AdminMetrics {
  adminName: string;
  tasksCreated: number;
  tasksClosed: number;
  overdueUnderThem: number;
  avgClosureDays: number;
}

export function useWorkforceData() {
  const { institutionId, roleInfo } = useEffectiveInstitution();
  const { data: userRole } = useUserRole();

  return useQuery({
    queryKey: ["workforce-data", institutionId, userRole?.primaryRole],
    queryFn: async () => {
      if (!institutionId) return null;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      // Fetch all needed data in parallel.
      //
      // PostgREST silently caps unranged SELECTs at 1000 rows. Alliance hit
      // this with 1,360 profiles — 360 staff were dropped, including school
      // admin Dr Shivali Sharma, who showed up as "Unknown" on the workforce
      // dashboard because her user_roles row was kept but her profile was
      // truncated. Same pattern fixed in InstitutionsPage (commit 9b2d148).
      //
      // 50k is plenty of headroom — Alliance currently maxes out at ~1.8k
      // class_assignments — and matches the cap used in InstitutionsPage.
      const PAGE = 50000;
      const [
        { data: tasks },
        { data: allProfiles },
        { data: allRoles },
        { data: wings },
        { data: wingAssignments },
        { data: wingClassMappings },
        { data: classAssignments },
      ] = await Promise.all([
        supabase
          .from("tasks")
          .select("id, title, status, due_date, created_at, updated_at, task_assignments!inner(assigner_id, assignee_id)")
          .eq("institution_id", institutionId)
          .range(0, PAGE - 1),
        supabase
          .from("profiles")
          .select("id, full_name, email")
          .eq("institution_id", institutionId)
          .range(0, PAGE - 1),
        supabase
          .from("user_roles")
          .select("user_id, role")
          .eq("institution_id", institutionId)
          .range(0, PAGE - 1),
        supabase.from("wings").select("id, name").eq("institution_id", institutionId),
        supabase.from("wing_assignments").select("user_id, wing_id").range(0, PAGE - 1),
        supabase.from("wing_class_mappings").select("wing_id, class_id").range(0, PAGE - 1),
        supabase.from("class_assignments").select("user_id, class_id, role").range(0, PAGE - 1),
      ]);

      const profileMap = new Map((allProfiles || []).map(p => [p.id, getDisplayName(p)]));

      // PostgREST returns the joined `task_assignments!inner(...)` shape with
      // some run-time variance that the generated supabase types model as
      // unions — this hook only uses the singular-object shape, so a small
      // inline type keeps the loops below well-typed without `any`.
      type TaskRow = {
        id: string;
        title: string;
        status: string;
        due_date: string | null;
        created_at: string;
        updated_at: string;
        task_assignments: { assigner_id?: string | null; assignee_id?: string | null } | null;
      };
      const taskRows = (tasks || []) as unknown as TaskRow[];

      // Backfill profiles missed by the institution-filtered fetch.
      //
      // `profiles.institution_id` is nullable and isn't guaranteed to match
      // `user_roles.institution_id`. Cross-school super_school_admins,
      // recently-transferred staff, and any user whose profile is institution-
      // less still get a `user_roles` row at this school but won't come back
      // from the .eq("institution_id", …) profile fetch above — so their
      // name renders as "Unknown" in the workforce dashboard. Resolve those
      // user_ids directly by id.
      const referencedUserIds = new Set<string>();
      (allRoles || []).forEach(r => referencedUserIds.add(r.user_id));
      taskRows.forEach(t => {
        const a = t.task_assignments;
        if (a?.assignee_id) referencedUserIds.add(a.assignee_id);
        if (a?.assigner_id) referencedUserIds.add(a.assigner_id);
      });
      const missingProfileIds = Array.from(referencedUserIds).filter(id => !profileMap.has(id));
      if (missingProfileIds.length > 0) {
        // Chunk to keep the URL bounded on PostgREST's GET-based .in() filter.
        const CHUNK = 500;
        for (let i = 0; i < missingProfileIds.length; i += CHUNK) {
          const chunk = missingProfileIds.slice(i, i + CHUNK);
          const { data: extra } = await supabase
            .from("profiles")
            .select("id, full_name, email")
            .in("id", chunk);
          (extra || []).forEach(p => profileMap.set(p.id, getDisplayName(p)));
        }
      }

      const wingMap = new Map((wings || []).map(w => [w.id, w.name]));

      // Build user -> role map
      const roleMap = new Map<string, string>();
      (allRoles || []).forEach(r => {
        // Keep highest priority role
        const existing = roleMap.get(r.user_id);
        const priority = ["super_school_admin", "school_admin", "coordinator", "teacher"];
        if (!existing || priority.indexOf(r.role) < priority.indexOf(existing)) {
          roleMap.set(r.user_id, r.role);
        }
      });

      // Build user -> wing name map
      const userWingMap = new Map<string, string>();
      (wingAssignments || []).forEach(wa => {
        const wName = wingMap.get(wa.wing_id);
        if (wName) userWingMap.set(wa.user_id, wName);
      });

      // For teachers: derive wing from class assignments -> wing_class_mappings
      const classToWing = new Map<string, string>();
      (wingClassMappings || []).forEach(wcm => {
        const wName = wingMap.get(wcm.wing_id);
        if (wName) classToWing.set(wcm.class_id, wName);
      });
      (classAssignments || []).forEach(ca => {
        if (!userWingMap.has(ca.user_id) && classToWing.has(ca.class_id)) {
          userWingMap.set(ca.user_id, classToWing.get(ca.class_id)!);
        }
      });

      // Role-based user filtering
      let visibleUserIds: Set<string>;
      const currentRole = userRole?.primaryRole;
      const isSuperSchoolAdmin = userRole?.isSuperSchoolAdmin;
      const isSchoolAdmin = userRole?.isSchoolAdmin;
      const isCoordinator = userRole?.isCoordinator;

      if (isSuperSchoolAdmin || (userRole?.isSuperAdmin)) {
        // See everyone
        visibleUserIds = new Set((allRoles || [])
          .filter(r => ["school_admin", "super_school_admin", "coordinator", "teacher"].includes(r.role))
          .map(r => r.user_id));
      } else if (isSchoolAdmin) {
        // Owners stay hidden from peer admins. Exclude by USER, not by role
        // row: a super_school_admin who also teaches has a teacher row and
        // would otherwise slip through this filter.
        const ownerIds = new Set(
          (allRoles || []).filter(r => r.role === "super_school_admin").map(r => r.user_id)
        );
        visibleUserIds = new Set(
          (allRoles || [])
            .filter(r => ["coordinator", "teacher"].includes(r.role) && !ownerIds.has(r.user_id))
            .map(r => r.user_id)
        );
      } else if (isCoordinator) {
        // Only teachers in coordinator's wing classes
        const myWingIds = (wingAssignments || [])
          .filter(wa => wa.user_id === user.id)
          .map(wa => wa.wing_id);
        const myClassIds = (wingClassMappings || [])
          .filter(wcm => myWingIds.includes(wcm.wing_id))
          .map(wcm => wcm.class_id);
        const teacherIds = (classAssignments || [])
          .filter(ca => myClassIds.includes(ca.class_id) && ca.role === "teacher")
          .map(ca => ca.user_id);
        visibleUserIds = new Set(teacherIds);
      } else {
        visibleUserIds = new Set();
      }

      const now = new Date();
      const userDataMap = new Map<string, WorkforceUser>();

      // Initialize all visible users
      visibleUserIds.forEach(uid => {
        const role = roleMap.get(uid) || "unknown";
        userDataMap.set(uid, {
          userId: uid,
          name: profileMap.get(uid) || "Unknown",
          role: role.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
          roleRaw: role,
          wing: userWingMap.get(uid) || "N/A",
          tasksAssignedByThem: 0,
          open: 0,
          inProgress: 0,
          overdue: 0,
          completed: 0,
          totalAssigned: 0,
          completionPercent: 0,
          lastActivity: null,
          workloadScore: 0,
          openTasks: [],
          overdueTasks: [],
          assignedByThem: [],
          completedTasks: [],
        });
      });

      // Process tasks
      taskRows.forEach(t => {
        const a = t.task_assignments;
        const assigneeId = a?.assignee_id;
        const assignerId = a?.assigner_id;
        const isOverdue = t.due_date && new Date(t.due_date) < now && t.status !== "completed";

        // Assignee metrics
        if (assigneeId && userDataMap.has(assigneeId)) {
          const u = userDataMap.get(assigneeId)!;
          u.totalAssigned++;
          if (t.status === "open") {
            u.open++;
            u.openTasks.push({ id: t.id, title: t.title, dueDate: t.due_date });
          }
          if (t.status === "in_progress") u.inProgress++;
          if (isOverdue) {
            u.overdue++;
            u.overdueTasks.push({
              id: t.id,
              title: t.title,
              dueDate: t.due_date,
              daysOverdue: differenceInDays(now, new Date(t.due_date)),
            });
          }
          if (t.status === "completed") {
            u.completed++;
            u.completedTasks.push({ id: t.id, title: t.title, createdAt: t.created_at, completedAt: t.updated_at });
          }

          // Track last activity
          if (t.updated_at && (!u.lastActivity || t.updated_at > u.lastActivity)) {
            u.lastActivity = t.updated_at;
          }
        }

        // Assigner metrics
        if (assignerId && userDataMap.has(assignerId)) {
          const u = userDataMap.get(assignerId)!;
          u.tasksAssignedByThem++;
          if (u.assignedByThem.length < 5) {
            u.assignedByThem.push({
              id: t.id,
              title: t.title,
              assigneeName: profileMap.get(assigneeId) || "Unknown",
              status: t.status,
            });
          }
        }
      });

      // Compute derived metrics
      const users: WorkforceUser[] = [];
      userDataMap.forEach(u => {
        u.completionPercent = u.totalAssigned > 0 ? Math.round((u.completed / u.totalAssigned) * 100) : 0;
        u.workloadScore = u.open + u.inProgress + (u.overdue * 2);
        users.push(u);
      });

      // Default sort: overdue DESC, then workload DESC
      users.sort((a, b) => b.overdue - a.overdue || b.workloadScore - a.workloadScore);

      // KPIs
      const kpis = {
        totalUsers: users.length,
        totalOpen: users.reduce((s, u) => s + u.open, 0),
        totalOverdue: users.reduce((s, u) => s + u.overdue, 0),
        completionRate: users.length > 0
          ? Math.round(users.reduce((s, u) => s + u.completionPercent, 0) / users.length)
          : 0,
      };

      // Wing comparison (SuperAdmin only)
      const wingMetrics: WingMetrics[] = [];
      if (isSuperSchoolAdmin || userRole?.isSuperAdmin) {
        const wingData = new Map<string, { total: number; open: number; overdue: number; completed: number; completionDays: number[]; }>();
        taskRows.forEach(t => {
          const assigneeId = t.task_assignments?.assignee_id;
          const wName = assigneeId ? userWingMap.get(assigneeId) : null;
          if (!wName) return;
          if (!wingData.has(wName)) wingData.set(wName, { total: 0, open: 0, overdue: 0, completed: 0, completionDays: [] });
          const w = wingData.get(wName)!;
          w.total++;
          if (t.status === "open") w.open++;
          if (t.due_date && new Date(t.due_date) < now && t.status !== "completed") w.overdue++;
          if (t.status === "completed") {
            w.completed++;
            const days = differenceInDays(new Date(t.updated_at), new Date(t.created_at));
            w.completionDays.push(days);
          }
        });
        wingData.forEach((v, wName) => {
          wingMetrics.push({
            wingName: wName,
            totalTasks: v.total,
            open: v.open,
            overdue: v.overdue,
            completionPercent: v.total > 0 ? Math.round((v.completed / v.total) * 100) : 0,
            avgCompletionDays: v.completionDays.length > 0
              ? Math.round(v.completionDays.reduce((a, b) => a + b, 0) / v.completionDays.length)
              : 0,
          });
        });
        wingMetrics.sort((a, b) => b.overdue - a.overdue);
      }

      // Admin performance (SuperAdmin only)
      const adminMetrics: AdminMetrics[] = [];
      if (isSuperSchoolAdmin || userRole?.isSuperAdmin) {
        const adminIds = (allRoles || [])
          .filter(r => r.role === "school_admin" || r.role === "super_school_admin")
          .map(r => r.user_id);
        const adminData = new Map<string, { created: number; closed: number; overdue: number; closureDays: number[]; }>();
        adminIds.forEach(id => adminData.set(id, { created: 0, closed: 0, overdue: 0, closureDays: [] }));

        taskRows.forEach(t => {
          const assignerId = t.task_assignments?.assigner_id;
          if (!assignerId || !adminData.has(assignerId)) return;
          const a = adminData.get(assignerId)!;
          a.created++;
          if (t.status === "completed") {
            a.closed++;
            const days = differenceInDays(new Date(t.updated_at), new Date(t.created_at));
            a.closureDays.push(days);
          }
          if (t.due_date && new Date(t.due_date) < now && t.status !== "completed") {
            a.overdue++;
          }
        });

        adminData.forEach((v, id) => {
          if (v.created === 0) return;
          adminMetrics.push({
            adminName: profileMap.get(id) || "Unknown",
            tasksCreated: v.created,
            tasksClosed: v.closed,
            overdueUnderThem: v.overdue,
            avgClosureDays: v.closureDays.length > 0
              ? Math.round(v.closureDays.reduce((a, b) => a + b, 0) / v.closureDays.length)
              : 0,
          });
        });
      }

      // 30-day trend data per user
      const thirtyDaysAgo = subDays(now, 30);

      // Compute available wings for filter
      const availableWings = [...new Set(users.map(u => u.wing).filter(w => w !== "N/A"))];

      return {
        users,
        kpis,
        wingMetrics,
        adminMetrics,
        availableWings,
        isSuperSchoolAdmin: isSuperSchoolAdmin || userRole?.isSuperAdmin || false,
      };
    },
    enabled: !!institutionId && !!userRole,
  });
}

export function getCompletionTrend(user: WorkforceUser): { week: string; count: number }[] {
  const now = new Date();
  const weeks: { week: string; count: number }[] = [];
  for (let i = 3; i >= 0; i--) {
    const weekStart = startOfWeek(subDays(now, i * 7));
    const weekEnd = subDays(weekStart, -7);
    const label = format(weekStart, "MMM d");
    const count = user.completedTasks.filter(t => {
      const d = new Date(t.completedAt);
      return d >= weekStart && d < weekEnd;
    }).length;
    weeks.push({ week: label, count });
  }
  return weeks;
}

export function getAvgCompletionTime(user: WorkforceUser): number {
  if (user.completedTasks.length === 0) return 0;
  const totalDays = user.completedTasks.reduce((sum, t) => {
    return sum + differenceInDays(new Date(t.completedAt), new Date(t.createdAt));
  }, 0);
  return Math.round(totalDays / user.completedTasks.length);
}
