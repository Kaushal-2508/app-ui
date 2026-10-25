import { createContext, useContext, useState, useMemo, ReactNode } from "react";
import { useUserRole } from "@/hooks/useUserRole";

export type ViewRole = "admin" | "teacher" | "coordinator";

const ROLE_PREFERENCE_KEY = "salci_dashboard_role_preference";

interface ActiveRoleContextType {
  activeViewRole: ViewRole;
  setActiveViewRole: (role: ViewRole) => void;
  /** True when this user can switch views at all. */
  hasDualRole: boolean;
  /** The views this user may choose between, in display order. */
  viewRoles: ViewRole[];
}

const ActiveRoleContext = createContext<ActiveRoleContextType | undefined>(undefined);

function isViewRole(value: string | null): value is ViewRole {
  return value === "admin" || value === "teacher" || value === "coordinator";
}

export function ActiveRoleProvider({ children }: { children: ReactNode }) {
  const { data: roleInfo, isLoading: roleLoading } = useUserRole();

  const isSchoolAdmin = Boolean(roleInfo?.isSchoolAdmin);
  const isTeacher = Boolean(roleInfo?.isTeacher);
  const isCoordinator = Boolean(roleInfo?.isCoordinator);

  /**
   * Which views this account may wear.
   *
   * "admin" is offered ONLY to a school admin who also holds the teacher role,
   * so a plain admin, and an admin+coordinator, are completely unaffected and
   * keep today's behaviour. "teacher" and "coordinator" reproduce the exact
   * teacher+coordinator pairing that shipped in 607aeca.
   *
   * super_admin is deliberately absent: platform admins are never scoped.
   */
  const viewRoles = useMemo<ViewRole[]>(() => {
    const isAdminTeacher = isSchoolAdmin && isTeacher;
    const isTeacherCoordinator = isTeacher && isCoordinator;
    const list: ViewRole[] = [];
    if (isAdminTeacher) list.push("admin");
    if (isAdminTeacher || isTeacherCoordinator) list.push("teacher");
    if (isTeacherCoordinator) list.push("coordinator");
    return list;
  }, [isSchoolAdmin, isTeacher, isCoordinator]);

  const hasDualRole = viewRoles.length > 1;

  // The first entry is the default: "teacher" for a teacher+coordinator, which
  // is exactly today's default, and "admin" for an admin+teacher, so gaining
  // the teacher role never silently drops a principal into teacher view.
  const defaultViewRole: ViewRole = viewRoles[0] ?? "teacher";

  // What this browser last chose, or null when nothing (valid) is saved. Read
  // from storage at mount rather than after the roles load, so a dual-role
  // user who prefers the non-default view does not get one frame in the
  // default one on every cold start: that frame fired wrongly-scoped queries
  // and, now that the two Students pages hand over to each other by hat
  // (SchoolStudentsPage <-> TeacherStudentsPage), would bounce between their
  // routes. It must NOT fall back to defaultViewRole here: at mount the roles
  // have not loaded, so that default is still the "teacher" placeholder, and
  // an admin who also teaches with nothing saved would open in teacher view.
  const [preferredViewRole, setPreferredViewRole] = useState<ViewRole | null>(() => {
    try {
      const saved = localStorage.getItem(ROLE_PREFERENCE_KEY);
      if (isViewRole(saved)) return saved;
    } catch { /* storage unavailable */ }
    return null;
  });

  // The preference is saved per BROWSER, not per user (Tushar's review,
  // 2026-09-28): on a shared staff-room computer an admin who also teaches
  // could inherit "coordinator" from the last person, and TeacherStudentsPage
  // would send them to /coordinator/students, which they cannot open. So the
  // role handed out is validated here, in render, never in an effect that
  // runs a frame late: once the roles are known, the saved role counts only
  // if this account holds it, otherwise the default. While they load,
  // viewRoles is empty and hasDualRole is false, and every consumer checks
  // hasDualRole before reading the role, so nothing can act on it yet.
  const activeViewRole: ViewRole =
    preferredViewRole && (roleLoading || viewRoles.includes(preferredViewRole))
      ? preferredViewRole
      : defaultViewRole;

  const setActiveViewRole = (role: ViewRole) => {
    setPreferredViewRole(role);
    try { localStorage.setItem(ROLE_PREFERENCE_KEY, role); } catch { /* noop */ }
  };

  const value = useMemo<ActiveRoleContextType>(
    () => ({ activeViewRole, setActiveViewRole, hasDualRole, viewRoles }),
    [activeViewRole, hasDualRole, viewRoles],
  );

  return (
    <ActiveRoleContext.Provider value={value}>
      {children}
    </ActiveRoleContext.Provider>
  );
}

export function useActiveRole() {
  const context = useContext(ActiveRoleContext);
  if (!context) {
    throw new Error("useActiveRole must be used within ActiveRoleProvider");
  }
  return context;
}
