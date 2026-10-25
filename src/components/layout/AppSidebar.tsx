import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useUserRole } from "@/hooks/useUserRole";
import { useInstitutionContext } from "@/contexts/InstitutionContext";
import { useInstitutionLogo } from "@/hooks/useInstitutionLogo";
import { GROUP_ICONS, useNavGroups } from "./useNavGroups";
import { useBottomNavItems } from "./MobileBottomNav";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { AlertTriangle, Building2, Layers, ChevronRight, CircleUserRound, LogOut, MessageSquareWarning, Settings } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { ProctoringAlertsBadge } from "@/components/proctoring/ProctoringAlertsBadge";
import { Button } from "@/components/ui/button";
import { useProfileData } from "@/hooks/useProfileData";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { NavLink } from "@/components/NavLink";

// User context component that shows logged-in user name + role.
// Only ever rendered expanded — the icon rail gives its top slot to the
// collapse toggle instead, so there is no collapsed branch to carry.
function UserContextHeader({ onNavigate }: { onNavigate: () => void }) {
  const { data: profile } = useProfileData();
  const { data: roleInfo } = useUserRole();

  // Deterministic: profile.roles is fetched without an ORDER BY, so reading
  // roles[0] made this label flip between page loads for anyone holding two
  // roles. primaryRole resolves through a fixed priority list instead.
  const roleLabel = roleInfo?.primaryRole
    ? roleInfo.primaryRole.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    : "User";
  
  // The whole card opens the profile, the way a phone app's account header
  // does; the chevron says it is tappable.
  return (
    <NavLink
      to="/profile"
      onClick={onNavigate}
      aria-label="Open my profile"
      className="-m-1 flex w-full items-center gap-3 rounded-xl p-1 transition-colors duration-200 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      activeClassName="bg-sidebar-accent"
    >
      {/* Squared brand tile rather than a round avatar — it reads as an app
          identity mark, which is what the header slot is doing here. The photo,
          when there is one, is clipped to the same squared shape by the root's
          overflow-hidden, so the tile keeps its identity either way. */}
      <UserAvatar
        name={profile?.full_name}
        email={profile?.email}
        avatarPath={profile?.avatar_path}
        className="h-10 w-10 flex-shrink-0 rounded-xl"
        fallbackClassName="rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold leading-tight">
          {profile?.full_name || "User"}
        </p>
        <p className="truncate text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {roleLabel}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </NavLink>
  );
}

interface AppSidebarProps {
  onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
}

export function AppSidebar({ onMouseEnter, onMouseLeave }: AppSidebarProps = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { state, isMobile, setOpenMobile, setOpen } = useSidebar();
  const collapsed = !isMobile && state === "collapsed";

  // Auto-close sidebar drawer when a nav item is clicked
  const handleNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    } else {
      setOpen(false);
    }
  };
  const { data: roleInfo } = useUserRole();
  const { isManagingInstitution, managedInstitution, stopManaging } =
    useInstitutionContext();
  const { logoUrl: managedLogoUrl } = useInstitutionLogo(
    isManagingInstitution ? managedInstitution?.id : null,
  );
  // One shared list (useNavGroups): the phone bar, More and section tabs
  // read the same groups this sidebar renders.
  const navGroups = useNavGroups();
  // Phone: the bottom bar already carries Home and the first sections, so this
  // sheet ("More") lists only the sections left over, one row each; a
  // section's pages appear as tabs inside the page (SectionTabs). Where the bar
  // is hidden (a focused flow) every section is listed. Desktop is unchanged.
  const barItems = useBottomNavItems();
  const phoneSections = isMobile ? navGroups.slice(barItems?.length ?? 0) : null;


  // Handle exiting institution management mode
  const handleExitManagement = () => {
    stopManaging();
    navigate("/admin/institutions");
  };


  // Exactly ONE row may be highlighted: the most specific match. Nav urls
  // nest ("My Exams" = /exams, "Create Exam" = /exams/create), so a plain
  // startsWith test lights up both rows at once on /exams/create. The longest
  // matching url is the real destination; everything else loses.
  const activeUrl = navGroups.reduce<string | null>(
    (best, group) =>
      group.items.reduce<string | null>((inner, item) => {
        const matches =
          location.pathname === item.url ||
          location.pathname.startsWith(item.url + "/");
        if (!matches) return inner;
        return inner === null || item.url.length > inner.length
          ? item.url
          : inner;
      }, best),
    null,
  );

  const isItemActive = (item: { url: string }) => item.url === activeUrl;

  // ProtectedRoute remounts the sidebar on every route change, and the flat
  // list is long enough that the current page can sit below the fold. Bring
  // it into view whenever it mounts (also when the phone sheet opens).
  const revealActive = useCallback((el: HTMLLIElement | null) => {
    el?.scrollIntoView({ block: "nearest" });
  }, []);

  return (
    <Sidebar
      collapsible="icon"
      data-tour="sidebar"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <SidebarHeader className={`border-b py-3 ${collapsed ? "px-0" : "px-4"}`}>
        {/* The collapse/expand toggle lives HERE, not in the app header.
            Expanded: trailing edge of the header row, beside the user block.
            Collapsed: it takes the rail's top slot outright — the avatar is
            suppressed so the rail opens with the toggle, not an initial.
            The app header keeps its own trigger below md, where the sidebar
            is an off-canvas sheet and an in-sidebar toggle is unreachable
            once it closes. */}
        <div className={collapsed ? "flex flex-col items-center gap-2" : "flex items-start gap-2"}>
          {/* On the rail the toggle is one of the icon column's targets, so it
              matches them exactly: 40px box, 20px glyph, same rounding. Button's
              base [&_svg]:size-4 is what would otherwise render it a size down. */}
          {collapsed && <SidebarTrigger className="h-10 w-10 rounded-lg [&_svg]:size-5" />}

          <div className="min-w-0 flex-1">
            {/* Institution Management Mode Banner */}
            {roleInfo?.isSuperAdmin &&
            isManagingInstitution &&
            managedInstitution ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-orange-500 flex items-center justify-center overflow-hidden">
                    {managedLogoUrl ? (
                      <img
                        src={managedLogoUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <Building2 className="h-4 w-4 text-white" />
                    )}
                  </div>
                  {!collapsed && (
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">
                        {managedInstitution.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Managing as Admin
                      </p>
                    </div>
                  )}
                </div>
                {!collapsed && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    onClick={handleExitManagement}
                  >
                    <LogOut className="h-3 w-3 mr-1" />
                    Exit Management
                  </Button>
                )}
                {collapsed && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={handleExitManagement}
                    title="Exit institution management"
                  >
                    <LogOut className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ) : collapsed ? null : (
              <UserContextHeader onNavigate={handleNavClick} />
            )}
          </div>

          {!collapsed && <SidebarTrigger className="h-8 w-8 shrink-0" />}
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        {/* Flat sections, every page one tap away (2026-10-14). The groups
            used to be collapsible dropdowns; now each is a heading over its
            links, always open. On the icon rail the headings fade out
            (SidebarGroupLabel's own collapsed style) and the item icons stand
            in a single column. The rule under the last section separates
            destinations from the footer utilities; suppressed on the rail. */}
        <div className={collapsed ? undefined : "border-b border-sidebar-border/70 pb-3"}>
          {phoneSections && phoneSections.length > 0 && (
            <SidebarGroup className="py-1">
              <SidebarGroupLabel className="h-7 text-[11px] font-semibold uppercase tracking-[0.06em] text-sidebar-foreground/50">
                More
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {phoneSections.map((group) => {
                    const Icon = GROUP_ICONS[group.group] ?? Layers;
                    const active = group.items.some(isItemActive);
                    return (
                      <SidebarMenuItem key={group.group}>
                        <SidebarMenuButton asChild isActive={active} className="h-12">
                          <NavLink
                            to={group.items[0].url}
                            className="flex items-center gap-3"
                            onClick={handleNavClick}
                          >
                            <Icon className="h-5 w-5" />
                            <span className="flex-1 truncate">
                              {group.items.length === 1 ? group.items[0].title : group.group}
                            </span>
                            {group.items.length > 1 && (
                              <span className="text-[12px] text-sidebar-foreground/50">
                                {group.items.length} pages
                              </span>
                            )}
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
          {!phoneSections && navGroups.map((group) => (
            <SidebarGroup key={group.group} className="py-1">
              {/* A one-link group (Dashboard, the Olympiad-only tab) needs no
                  heading over it. */}
              {group.items.length > 1 && (
                <SidebarGroupLabel className="h-7 text-[11px] font-semibold uppercase tracking-[0.06em] text-sidebar-foreground/50">
                  {group.group}
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                {/* On the icon rail the buttons are a fixed 40px, so the column
                    centers them instead of leaving them hard against the left. */}
                <SidebarMenu className="gap-0.5 group-data-[collapsible=icon]:items-center">
                  {group.items.map((item) => {
                    const active = isItemActive(item);
                    return (
                      <SidebarMenuItem key={item.title} ref={active ? revealActive : undefined}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.title}
                          data-tour={item.tourId}
                          className="h-10"
                        >
                          {/* No activeClassName here: the selected look already
                              comes from isActive above, and a second active fill
                              would put a grey accent under the teal. */}
                          <NavLink
                            to={item.url}
                            className="flex items-center gap-2"
                            onClick={handleNavClick}
                          >
                            <item.icon className="h-4 w-4" />
                            {!collapsed && <span className="truncate">{item.title}</span>}
                            {!collapsed && item.hasBadge && <ProctoringAlertsBadge />}
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </div>
      </SidebarContent>

      <SidebarFooterWithReportIssue collapsed={collapsed} isSuperAdmin={!!roleInfo?.isSuperAdmin} />
    </Sidebar>
  );
}

function SidebarFooterWithReportIssue({ collapsed, isSuperAdmin }: { collapsed: boolean; isSuperAdmin: boolean }) {
  const { isMobile, setOpenMobile, setOpen } = useSidebar();

  const handleNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    } else {
      setOpen(false);
    }
  };

  const { signOut } = useAuth();
  // Same as the avatar menu in AppLayout: signOut() always purges the local
  // session, then a hard redirect boots the app clean (CLAUDE.md §11 Misc,
  // never simplify to a bare signOut()).
  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      window.location.replace("/login");
    }
  };

  return (
    <SidebarFooter className="border-t p-2">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild tooltip="My Profile">
            <NavLink
              to="/profile"
              className="flex items-center gap-2"
              activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
              onClick={handleNavClick}
            >
              <CircleUserRound className="h-4 w-4" />
              {!collapsed && <span>My Profile</span>}
            </NavLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {/* Salci Support is a PAGE now, not a sheet that opened a form and
            then dropped the reporter off a cliff. /support lists the caller's
            own tickets, holds the conversation, and mounts the intake form
            itself behind "New request". Every authenticated role can open it:
            the route carries no allowedRoles and is not feature-gated, which
            is what makes this button honest for students and employees.

            Hidden for a super admin. SALCI RECEIVES support requests, it does
            not raise them, and their queue is the Issues entry directly below.
            The route itself stays open rather than role-gated: the two tickets
            a super admin already filed are still reachable, and /support is
            deliberately the one page in the app no gate can shut. */}
        {!isSuperAdmin && (
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <NavLink
                to="/support"
                className="flex items-center gap-2"
                activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
                onClick={handleNavClick}
              >
                <MessageSquareWarning className="h-4 w-4" />
                {!collapsed && <span>Salci Support</span>}
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
        {isSuperAdmin && (
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <NavLink
                to="/admin/issues"
                className="flex items-center gap-2"
                activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
                onClick={handleNavClick}
              >
                <AlertTriangle className="h-4 w-4" />
                {!collapsed && <span>Issues</span>}
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
        <SidebarMenuItem>
          <SidebarMenuButton asChild>
            <NavLink
              to="/settings"
              className="flex items-center gap-2"
              activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
              onClick={handleNavClick}
            >
              <Settings className="h-4 w-4" />
              {!collapsed && <span>Settings</span>}
            </NavLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Sign out"
            onClick={handleSignOut}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && <span>Sign out</span>}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
}
