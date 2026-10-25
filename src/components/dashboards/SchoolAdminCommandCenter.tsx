import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useSidebar } from "@/components/ui/sidebar";
import { useProfileData } from "@/hooks/useProfileData";
import { useUserRole } from "@/hooks/useUserRole";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { StaffCheckInCard } from "@/components/attendance/StaffCheckInCard";
import { FEATURE_URL_MAP } from "@/components/admin/institution-wizard/featuresData";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NavigationHub, type NavGroup } from "./NavigationHub";
import { DashboardTopSlot } from "./actions/DashboardTopSlot";
import { useRotatingGreeting } from "@/hooks/useRotatingGreeting";

import { PageShell } from "@/components/shared/page";
import { ClayPebble, FeatureTileButton, type Tone } from "@/components/shared/surfaces";
import {
  Briefcase, IndianRupee, ClipboardCheck, MessageSquare, Activity,
  CreditCard, FileText, BookOpen, RefreshCcw, BarChart3, Layers,
  ClipboardList, Camera, Shield, Users, GraduationCap, Building,
  ArrowLeft, CalendarCheck,
} from "lucide-react";

// ── Category Definitions ──

interface CategoryDef {
  key: string;
  title: string;
  description: string;
  icon: React.ElementType;
  /** Clay tile colour (2026-09-29): the banner palette, the same tones the hub grids use. */
  tone: Tone;
}

const CATEGORIES: CategoryDef[] = [
  {
    // Renamed to "Dashboard" and moved to the front: this is the live school
    // overview an admin lands on, so it leads the grid. The `key` stays
    // "command-center" -- it drives routing, the description override and the
    // feature-gate lookup, none of which are user-visible.
    key: "command-center",
    title: "Dashboard",
    description: "Live school overview, alerts & actions",
    icon: Camera,
    tone: "violet",
  },
  {
    key: "academics",
    title: "Academics",
    description: "Exams, Syllabus, Question Bank & Analytics",
    icon: BookOpen,
    tone: "teal",
  },
  {
    key: "tasks",
    title: "Task Management",
    description: "Track, assign & manage work items",
    icon: ClipboardList,
    tone: "peach",
  },
  {
    key: "operations",
    title: "Operations",
    description: "Fees, HR & Payroll, Attendance, Communication & more",
    icon: Briefcase,
    tone: "mint",
  },
];

// Multilingual greeting now lives in @/hooks/useRotatingGreeting and is
// shared across every role's dashboard h1 for portal-wide consistency.

// ── Sub-groups per category (shown as NavigationHub grids) ──

const operationsNavGroups: NavGroup[] = [
  {
    group: "School Structure",
    gradient: "purple",
    items: [
      { title: "Manage Admins", url: "/school/admins", icon: Shield, description: "School admin accounts" },
      { title: "Coordinators", url: "/school/coordinators", icon: Users, description: "Wing coordinator management" },
      { title: "Teachers", url: "/school/teachers", icon: GraduationCap, description: "Teaching staff directory" },
      { title: "Students", url: "/school/students", icon: Users, description: "Student records & enrollment" },
      { title: "Classes", url: "/school/classes", icon: Layers, description: "Class sections & assignments" },
      { title: "Wings", url: "/school/wings", icon: Building, description: "School wing structure" },
    ],
  },
  {
    group: "Finance & HR",
    gradient: "emerald",
    items: [
      { title: "Fee Management", url: "/school/fees", icon: IndianRupee, description: "Fee collection & tracking" },
      { title: "HR & Payroll", url: "/school/hr", icon: Briefcase, description: "Staff salary & leave management" },
      { title: "Billing", url: "/school/billing", icon: CreditCard, description: "Subscription & payment info" },
    ],
  },
  {
    group: "Daily Operations",
    gradient: "blue",
    items: [
      { title: "Attendance", url: "/school/attendance", icon: ClipboardCheck, description: "Class attendance and reports" },
      // Everything staff-side: the admin's own day plus staff attendance,
      // the staff leave queue and substitutions. Attendance above is students.
      { title: "Workday", url: "/staff/workday", icon: CalendarCheck, description: "Check in, staff attendance, and leave" },
      { title: "Communication", url: "/school/communication", icon: MessageSquare, description: "Messaging, notices & PTM" },
      { title: "Activity Logs", url: "/school/activity", icon: Activity, description: "School audit trail" },
    ],
  },
];

const academicsNavGroups: NavGroup[] = [
  {
    group: "Curriculum",
    gradient: "emerald",
    items: [
      { title: "Syllabus", url: "/school/syllabus", icon: BookOpen, description: "Curriculum & syllabus mapping" },
      { title: "Question Bank", url: "/question-bank", icon: Layers, description: "Browse & manage question pool" },
    ],
  },
  {
    group: "Examinations",
    gradient: "blue",
    items: [
      { title: "All Exams", url: "/school/exams", icon: FileText, description: "Exams across all classes" },
      { title: "Homework and Assignment", url: "/homework", icon: ClipboardList, description: "Create and grade homework" },
      { title: "Recheck Requests", url: "/school/rechecks", icon: RefreshCcw, description: "Review recheck submissions" },
    ],
  },
  {
    group: "Insights",
    gradient: "purple",
    items: [
      { title: "Analytics", url: "/school/analytics", icon: BarChart3, description: "School performance insights" },
    ],
  },
];

const tasksNavGroups: NavGroup[] = [
  {
    group: "Task Management",
    gradient: "amber",
    items: [
      { title: "All Tasks", url: "/tasks", icon: ClipboardList, description: "Track & assign work items" },
    ],
  },
];

const CATEGORY_NAV_MAP: Record<string, NavGroup[]> = {
  operations: operationsNavGroups,
  academics: academicsNavGroups,
  tasks: tasksNavGroups,
};

// ── Component ──

// Helper: filter nav groups by enabled features
function filterNavGroups(groups: NavGroup[], isFeatureEnabled: (id: string) => boolean): NavGroup[] {
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => {
        const featureId = FEATURE_URL_MAP[item.url];
        return !featureId || isFeatureEnabled(featureId);
      }),
    }))
    .filter((g) => g.items.length > 0);
}

export function SchoolAdminCommandCenter() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const { data: profile } = useProfileData();
  const { setOpen: setSidebarOpen } = useSidebar();
  const navigate = useNavigate();
  const { isFeatureEnabled, isLoading: featuresLoading } = useInstitutionFeatures();
  const { data: roleInfo } = useUserRole();
  const greeting = useRotatingGreeting();
  // Same rule as the Attendance tile (FEATURE_URL_MAP["/school/attendance"]),
  // so the button and the tile appear and disappear together.
  const checkInVisible = !roleInfo?.isSuperAdmin && isFeatureEnabled("attendance");

  const firstName = profile?.full_name?.split(" ")[0] || "there";
  const initials = profile?.full_name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
  const institutionName = profile?.institution?.name;

  // Hide sidebar only on initial mount (command center landing)
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      if (!selectedCategory) {
        setSidebarOpen(false);
      }
    }
  }, [selectedCategory, setSidebarOpen]);

  const handleCategoryClick = (key: string) => {
    if (key === "command-center") {
      setSidebarOpen(true);
      navigate("/school/command-center");
      return;
    }
    if (key === "tasks") {
      setSidebarOpen(true);
      navigate("/tasks");
      return;
    }
    setSelectedCategory(key);
    setSidebarOpen(true);
  };

  const handleBack = () => {
    setSelectedCategory(null);
    setSidebarOpen(false);
  };

  // Filter nav groups by enabled features
  const filteredCategoryNavMap = useMemo(() => {
    const map: Record<string, NavGroup[]> = {};
    for (const [key, groups] of Object.entries(CATEGORY_NAV_MAP)) {
      const filtered = filterNavGroups(groups, isFeatureEnabled);
      if (filtered.length > 0) map[key] = filtered;
    }
    return map;
  }, [isFeatureEnabled]);

  // Build dynamic descriptions from enabled items per category
  const categoryDescriptions = useMemo(() => {
    const descs: Record<string, string> = {};
    for (const [key, groups] of Object.entries(filteredCategoryNavMap)) {
      const names = groups.flatMap((g) => g.items.map((i) => i.title));
      descs[key] = names.length > 3
        ? names.slice(0, 3).join(", ") + " & more"
        : names.join(", ");
    }
    descs["command-center"] = "Live school overview, alerts & actions";
    return descs;
  }, [filteredCategoryNavMap]);

  // Hide categories that have no enabled items
  const visibleCategories = useMemo(() => {
    return CATEGORIES.filter((cat) => {
      if (cat.key === "command-center") return true; // always show command center
      return filteredCategoryNavMap[cat.key] !== undefined;
    });
  }, [filteredCategoryNavMap]);

  // ── Sub-grid view ──
  if (selectedCategory && filteredCategoryNavMap[selectedCategory]) {
    const cat = CATEGORIES.find((c) => c.key === selectedCategory)!;
    return (
      <div className="space-y-6">
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-3"
        >
          <Button variant="ghost" size="icon" onClick={handleBack} className="rounded-xl">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <ClayPebble tone={cat.tone} size="sm">
            <cat.icon />
          </ClayPebble>
          <div>
            <h1 className="text-xl font-bold tracking-tight">{cat.title}</h1>
            <p className="text-xs text-muted-foreground">{cat.description}</p>
          </div>
        </motion.div>
        <NavigationHub
          roleName="School Admin"
          navGroups={filteredCategoryNavMap[selectedCategory]}
        />
      </div>
    );
  }

  // ── Landing: 4 category cards ──
  return (
    <PageShell>
      {/* The day's action cards when something is due, else the Clay School banner. */}
      <DashboardTopSlot view="admin" />

      {/* CoachPro-style header: small eyebrow + bold h1 + subtle subtitle.
          The greeting rotates inline with the user's name ('Hello, Salci! /
          नमस्ते, Salci! / Hola, Salci! / …') so the multilingual greeting is
          part of the headline, not a separate caption. */}
      <header className="pt-3 pb-2 sm:pt-4 sm:pb-3 lg:pt-6 lg:pb-6">
        {/* The same small teal check-in button the teacher hub and the
            coordinator dashboard carry (2026-09-26), at the right end of the
            eyebrow row. Admins check in too; until now their only button was
            on Workday. Gated like the Attendance tile, and hidden from a
            super admin managing a school: they are not on its staff. */}
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow">Welcome back</p>
          {checkInVisible && <StaffCheckInCard compact view="admin" />}
        </div>
        <h1 className="text-[28px] sm:text-[34px] lg:text-[42px] xl:text-[46px] leading-tight font-bold tracking-tight text-ink-900 mt-1.5">
          <AnimatePresence mode="wait">
            <motion.span
              key={greeting}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.3 }}
              className="inline-block"
            >
              {greeting}
            </motion.span>
          </AnimatePresence>
          , {firstName}!
        </h1>
        <p className="mt-2 text-sm sm:text-[15px] text-ink-600">
          School Admin
          {institutionName && <span> · {institutionName}</span>}
        </p>
      </header>

      <p className="mt-4 text-xs font-medium uppercase tracking-wider text-ink-400">MY SCHOOL</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {visibleCategories.map((cat, idx) => {
          const Icon = cat.icon;
          return (
            // The entrance animation lives on a wrapper: framer writes an inline
            // transform when it settles, which would cancel the clay tile's own
            // hover lift and press squish if it sat on the tile itself.
            <motion.div
              key={cat.key}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 + idx * 0.06, duration: 0.4 }}
              className="h-full"
            >
              <FeatureTileButton
                onClick={() => handleCategoryClick(cat.key)}
                icon={<Icon className="h-5 w-5" />}
                title={cat.title}
                description={categoryDescriptions[cat.key] || cat.description}
                tone={cat.tone}
                className="h-full"
              />
            </motion.div>
          );
        })}
      </div>
    </PageShell>
  );
}
