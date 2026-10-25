import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { CoordinatorDashboard } from "./CoordinatorDashboard";
import { ComprehensiveStudentDashboard } from "./ComprehensiveStudentDashboard";
import { NavigationHub, type NavGroup } from "./NavigationHub";
import { TeacherMyDay } from "./TeacherMyDay";
import { SuperAdminDashboard } from "./SuperAdminDashboard";
import { SchoolAdminCommandCenter } from "./SchoolAdminCommandCenter";
import { useUserRole } from "@/hooks/useUserRole";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { useAuth } from "@/hooks/useAuth";
import { useIsOlympiadOnlyInstitution, olympiadHomePath } from "@/hooks/olympiad/useIsOlympiadOnlyInstitution";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertTriangle, Sparkles, Building2, Users, Shield, Brain, Layers,
  BookOpen, BarChart3, CreditCard, Lock, FileText, GraduationCap,
  Activity, ClipboardList, Plus, Inbox,
  Trophy, Medal, RefreshCcw, Camera, ClipboardCheck,
  MessageSquare, CalendarCheck,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Progress } from "@/components/ui/progress";

// ── Role-specific nav groups ──

const superAdminNavGroups: NavGroup[] = [
  {
    group: "Administration",
    gradient: "purple",
    items: [
      { title: "Institutions", url: "/admin/institutions", icon: Building2, description: "Manage all registered schools" },
      { title: "Non-SALCI Schools", url: "/admin/non-salci-schools", icon: Building2, description: "Olympiad-only onboarded schools: students & teachers" },
      { title: "Users", url: "/admin/users", icon: Users, description: "User accounts & role management" },
      { title: "AI Quotas", url: "/admin/ai-quotas", icon: Brain, description: "Configure AI usage limits" },
      { title: "Employee Levels", url: "/admin/employee-levels", icon: Shield, description: "Define staff hierarchy levels" },
      { title: "Syllabus", url: "/admin/syllabus", icon: BookOpen, description: "Global syllabus management" },
      { title: "Question Bank", url: "/admin/question-bank", icon: Layers, description: "Platform-wide question pool" },
      { title: "Analytics", url: "/admin/analytics", icon: BarChart3, description: "Platform-wide insights" },
      { title: "Payments", url: "/admin/payments", icon: CreditCard, description: "Billing & payment tracking" },
      { title: "Access Control", url: "/admin/access", icon: Lock, description: "Permissions & access rules" },
    ],
  },
  {
    group: "Monitoring",
    gradient: "amber",
    items: [
      { title: "Support Inbox", url: "/admin/issues", icon: Inbox, description: "Tickets by priority, turnaround and who is on them" },
      { title: "All Exams", url: "/admin/exams", icon: FileText, description: "View exams across all schools" },
      { title: "All Teachers", url: "/admin/teachers", icon: GraduationCap, description: "Teacher directory & stats" },
      { title: "All Students", url: "/admin/students", icon: Users, description: "Student directory & stats" },
      { title: "Activity Logs", url: "/admin/activity", icon: Activity, description: "System-wide audit trail" },
    ],
  },
];

const schoolAdminNavGroups: NavGroup[] = [
  {
    group: "School Management",
    gradient: "purple",
    items: [
      { title: "Snapshot", url: "/school/snapshot", icon: Camera, description: "Live school overview with charts & KPIs" },
      { title: "Manage Admins", url: "/school/admins", icon: Shield, description: "School admin accounts" },
      { title: "Coordinators", url: "/school/coordinators", icon: Users, description: "Wing coordinator management" },
      { title: "Teachers", url: "/school/teachers", icon: GraduationCap, description: "Teaching staff directory" },
      { title: "Students", url: "/school/students", icon: Users, description: "Student records & enrollment" },
      { title: "Classes", url: "/school/classes", icon: Layers, description: "Class sections & assignments" },
      { title: "Wings", url: "/school/wings", icon: Building2, description: "School wing structure" },
      { title: "Syllabus", url: "/school/syllabus", icon: BookOpen, description: "Curriculum & syllabus mapping" },
      { title: "Attendance", url: "/school/attendance", icon: ClipboardCheck, description: "Daily attendance tracking & analytics" },
    ],
  },
  {
    group: "Academic",
    gradient: "blue",
    items: [
      { title: "All Exams", url: "/school/exams", icon: FileText, description: "Exams across all classes" },
      { title: "Syllabus", url: "/school/syllabus", icon: BookOpen, description: "Curriculum & syllabus mapping" },
      { title: "Recheck Requests", url: "/school/rechecks", icon: RefreshCcw, description: "Review recheck submissions" },
      { title: "Analytics", url: "/school/analytics", icon: BarChart3, description: "School performance insights" },
      { title: "Question Bank", url: "/question-bank", icon: Layers, description: "Browse & manage question pool" },
    ],
  },
  {
    group: "Operations",
    gradient: "emerald",
    items: [
      { title: "Task Management", url: "/tasks", icon: ClipboardList, description: "Track & assign work items" },
      { title: "Communication", url: "/school/communication", icon: MessageSquare, description: "Messaging, notices & PTM" },
      { title: "Activity Logs", url: "/school/activity", icon: Activity, description: "School audit trail" },
      { title: "Billing", url: "/school/billing", icon: CreditCard, description: "Subscription & payment info" },
    ],
  },
];

const teacherNavGroups: NavGroup[] = [
  {
    group: "Exams",
    gradient: "blue",
    items: [
      // Teachers only: this scoped snapshot IS the teacher dashboard. The
      // sidebar entry for /dashboard is labelled "Home" to match.
      { title: "Dashboard", url: "/school/snapshot", icon: Camera, description: "Live overview of your classes with charts & KPIs" },
      { title: "My Exams", url: "/exams", icon: FileText, description: "View & manage your exams" },
      { title: "Create Exam", url: "/exams/create", icon: Plus, description: "Start building a new exam" },
      { title: "Homework and Assignment", url: "/homework", icon: ClipboardList, description: "Create and grade homework" },
    ],
  },
  {
    group: "Work",
    gradient: "emerald",
    items: [
      { title: "My Students", url: "/teacher/students", icon: Users, description: "Students in your classes" },
      { title: "Syllabus", url: "/school/syllabus", icon: BookOpen, description: "Curriculum & syllabus mapping" },
      { title: "Question Bank", url: "/question-bank", icon: Layers, description: "Browse & manage question pool" },
      { title: "Attendance", url: "/school/attendance", icon: ClipboardCheck, description: "Mark daily class attendance" },
      { title: "Workday", url: "/staff/workday", icon: CalendarCheck, description: "Check in, your attendance, and leave" },
      { title: "Tasks", url: "/tasks", icon: Inbox, description: "Track assigned work items" },
      { title: "Communication", url: "/school/communication", icon: MessageSquare, description: "Messaging, notices & PTM" },
      // No Reports tile for teachers — see the matching note in AppSidebar's
      // teacher "Work" group. Both lists are hand-maintained, so they must be
      // changed together.
    ],
  },
  {
    group: "Growth",
    gradient: "amber",
    items: [
      { title: "Achievements", url: "/achievements", icon: Trophy, description: "Badges & milestones earned" },
      { title: "Leaderboard", url: "/leaderboard", icon: Medal, description: "Rankings & standings" },
    ],
  },
];

const TAGLINES = [
  "Brewing your dashboard...",
  "Counting the pixels...",
  "Almost there, hang tight!",
  "Sprinkling some magic...",
  "Loading awesomeness...",
  "Setting things up for you...",
];

function FullScreenLoader() {
  const [progress, setProgress] = useState(0);
  const [taglineIndex, setTaglineIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => (prev >= 100 ? 100 : prev + 1));
    }, 40);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setTaglineIndex((prev) => (prev + 1) % TAGLINES.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-6 w-full max-w-xs">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="p-4 rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg"
        >
          <motion.div
            animate={{ scale: [1, 1.18, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <Sparkles className="h-8 w-8" />
          </motion.div>
        </motion.div>

        <div className="w-full">
          <Progress value={progress} className="h-2 rounded-full bg-muted" />
        </div>

        <div className="h-6 relative w-full flex justify-center">
          <AnimatePresence mode="wait">
            <motion.p
              key={taglineIndex}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3 }}
              className="text-sm text-muted-foreground absolute"
            >
              {TAGLINES[taglineIndex]}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export function RoleBasedDashboard() {
  const { data: roleInfo, isLoading } = useUserRole();
  const { user } = useAuth();
  const { activeViewRole, hasDualRole } = useActiveRole();
  const { isOlympiadOnly, isLoading: olyLoading } = useIsOlympiadOnlyInstitution();

  if (isLoading || !roleInfo?.primaryRole || olyLoading) {
    return <FullScreenLoader />;
  }

  // Onboarded (net-new) Olympiad-only schools: every non-super role lands
  // directly in their Olympiad workspace — there is no general dashboard.
  if (isOlympiadOnly && !roleInfo.isSuperAdmin) {
    return <Navigate to={olympiadHomePath(roleInfo)} replace />;
  }

  // Determine which dashboard to show. The "admin" view maps back to the
  // concrete admin role so the switch below keeps its existing cases untouched.
  const getEffectiveRole = () => {
    if (!hasDualRole) return roleInfo.primaryRole;
    if (activeViewRole === "admin") return roleInfo.primaryRole;
    return activeViewRole;
  };

  const effectiveRole = getEffectiveRole();

  // Render dashboard based on effective role
  const renderDashboard = () => {
    switch (effectiveRole) {
      case "super_admin":
        // Super admin only: the layered showcase treatment. Every other role
        // keeps NavigationHub / its own dashboard untouched.
        return <SuperAdminDashboard navGroups={superAdminNavGroups} />;
      case "super_school_admin":
      case "school_admin":
        return <SchoolAdminCommandCenter />;
      case "coordinator":
        return <CoordinatorDashboard />;
      case "teacher":
        // showCheckIn: today's self check-in card sits under the greeting so a
        // teacher can mark attendance from the first screen on a phone.
        // actionsView: the day's action cards replace the banner when something is due.
        // showMedal: the small medal chip under the greeting (2026-10-12).
        return (
          <NavigationHub
            roleName="Teacher"
            navGroups={teacherNavGroups}
            showCheckIn
            actionsView="teacher"
            showMedal
            today={<TeacherMyDay />}
          />
        );
      case "student":
        return <ComprehensiveStudentDashboard />;
      default:
        return (
          <Card>
            <CardContent className="py-12 text-center">
              <AlertTriangle className="h-12 w-12 mx-auto text-amber-500 mb-4" />
              <h3 className="text-lg font-medium">Unknown Role</h3>
              <p className="text-muted-foreground mt-2">
                Role "{roleInfo.primaryRole}" is not recognized.
              </p>
            </CardContent>
          </Card>
        );
    }
  };

  // The Teacher / Coordinator switch lives in the app bar (AppLayout) since
  // 2026-09-09, so it is reachable on every page rather than only here.
  return <div className="space-y-4">{renderDashboard()}</div>;
}
