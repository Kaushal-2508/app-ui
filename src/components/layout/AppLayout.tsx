import { type CSSProperties, Suspense, useCallback, useEffect, useState } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { MobileBottomNav, useBottomNavItems } from "./MobileBottomNav";
import { SectionTabs } from "./SectionTabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { PasswordExpiryWarning } from "./PasswordExpiryWarning";
import { NotificationBell } from "./NotificationBell";
import { GuidedTourProvider } from "@/components/onboarding/GuidedTourProvider";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { RoleSwitcher } from "@/components/dashboards/RoleSwitcher";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { useProfileData } from "@/hooks/useProfileData";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { LogOut, User, Settings, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isNativePlatform } from "@/lib/native";

interface AppLayoutProps {
  children: React.ReactNode;
}

/** Shown in the content area while a page's chunk downloads; the app bar stays. */
function PageChunkFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
      <p className="text-sm text-ink-500">Loading...</p>
    </div>
  );
}

export function AppLayout({ children }: AppLayoutProps) {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { data: roleInfo } = useUserRole();
  // The app-bar role chip used to be an inert primaryRole label while the
  // real Teacher / Coordinator switch sat in a strip on the dashboard body.
  // Dual-role users now switch views from the bar itself, on every page;
  // single-role users keep the plain label.
  const { activeViewRole, setActiveViewRole, hasDualRole, viewRoles } = useActiveRole();
  const [searchOpen, setSearchOpen] = useState(false);

  // Sidebar state — split into the user's persistent intent and a transient
  // hover-open flag. `effectiveOpen` is what the SidebarProvider sees. This
  // lets the desktop icon rail auto-expand on mouse-over without overwriting
  // the user's "I want it collapsed" preference. Mobile gets pure user intent.
  const isMobile = useIsMobile();
  const [userOpen, setUserOpen] = useState(true);
  const [isHovering, setIsHovering] = useState(false);
  const effectiveOpen = userOpen || (isHovering && !isMobile);

  const handleOpenChange = useCallback((newOpen: boolean) => {
    setUserOpen(newOpen);
    setIsHovering(false);
  }, []);

  const handleSidebarMouseEnter = useCallback(() => {
    if (!isMobile) setIsHovering(true);
  }, [isMobile]);

  const handleSidebarMouseLeave = useCallback(() => {
    setIsHovering(false);
  }, []);

  // Auto-hide top bar on scroll-down, reveal on scroll-up — YouTube/Chrome
  // style. The page itself is the scroll container (the column's old
  // overflow-y-auto was a no-op anyway because nothing in the chain had a
  // constrained height); the shadcn sidebar is position:fixed, so the body
  // scrolling has no effect on it. The header is sticky top-0 inside the
  // column — column uses overflow-x-clip (NOT hidden) so it doesn't become
  // a scroll container for sticky purposes, leaving the viewport as the
  // scrollport. The 4px threshold suppresses trackpad jitter; below 50px
  // we always show, so the top of every page reveals chrome immediately.
  const [headerVisible, setHeaderVisible] = useState(true);
  // Inside the app the bar is an ordinary block that scrolls off with the page,
  // like a native list screen's toolbar, and pinned page chrome takes the top
  // edge (--app-bar-offset is just the status-bar inset below). Asked for on the 2026-09-17 phone test
  // ("the top bar is not fixed"); it also means no scroll listener and one
  // composited sticky layer fewer on every screen.
  const native = isNativePlatform();

  useEffect(() => {
    // Runs in the app too, since 2026-09-23.
    //
    // It was skipped on native from 2026-09-17, on the reasoning that WKWebView
    // fires scroll events through the rubber-band bounce, so the bar flipped in
    // and out every frame. Capacitor sets `scrollView.bounces = false`
    // unconditionally (CAPBridgeViewController.swift), so there is no bounce to
    // fire through and that reasoning never applied. The cost of the skip was
    // that the bar only came back at the very top of the page: scroll down to
    // read anything and the menu, search, notifications and avatar were gone
    // until you scrolled all the way back up (reported 2026-09-23).
    //
    // The 4px threshold below is what actually stops a flip-flop, and it works
    // the same at 120Hz.
    let lastY = window.scrollY;

    const onScroll = () => {
      const current = window.scrollY;
      const delta = current - lastY;

      if (current < 50) {
        setHeaderVisible(true);
      } else if (delta > 4) {
        setHeaderVisible(false);
      } else if (delta < -4) {
        setHeaderVisible(true);
      }

      lastY = current;
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Fetch institution name + logo for the topbar
  const { data: institution } = useQuery({
    queryKey: ["header-institution", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;

      const { data: profile } = await supabase
        .from("profiles")
        .select("institution_id")
        .eq("id", user.id)
        .single();

      if (!profile?.institution_id) return null;

      const { data: institutionData } = await supabase
        .from("institutions")
        .select("name, logo_url")
        .eq("id", profile.institution_id)
        .single();

      return institutionData;
    },
    enabled: !!user?.id,
  });

  // Logic: Show School Name OR "SALCI" (if no school linked, e.g., Super Admin)
  const headerTitle = institution?.name || "SALCI";

  // --- Global Theme Initialization ---
  const { data: themePrefs } = useQuery({
    queryKey: ["global-theme-init", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from("user_preferences")
        .select("theme")
        .eq("user_id", user.id)
        .single();
      return data;
    },
    enabled: !!user?.id,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (themePrefs?.theme) {
      if (themePrefs.theme === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  }, [themePrefs]);
  // -----------------------------------

  const handleSignOut = async () => {
    // signOut() always purges the local session (even on a 403 from the server),
    // so hard-redirect to /login: a full reload guarantees a clean app boot with
    // no stale in-memory auth or cached React Query data bouncing the user back in.
    try {
      await signOut();
    } finally {
      window.location.replace("/login");
    }
  };

  // Global search handler
  const handleSearch = (searchTerm: string) => {
    setSearchOpen(false);
    navigate(`/search?q=${encodeURIComponent(searchTerm)}`);
  };

  const getRoleBadge = () => {
    if (!roleInfo?.primaryRole) return null;
    const roleLabels: Record<string, string> = {
      super_admin: "Super Admin",
      super_school_admin: "Super School Admin",
      school_admin: "School Admin",
      coordinator: "Coordinator",
      teacher: "Teacher",
      student: "Student",
    };
    return roleLabels[roleInfo.primaryRole] || roleInfo.primaryRole;
  };

  // Phone tab bar: null on desktop, in focused flows and for roles without one.
  const bottomNavItems = useBottomNavItems();

  // useProfileData is already cached by the sidebar, so this costs no extra
  // request; it is what carries avatar_path, which the auth user does not have.
  const { data: layoutProfile } = useProfileData();

  return (
    <GuidedTourProvider>
      <SidebarProvider open={effectiveOpen} onOpenChange={handleOpenChange}>
        <div className="min-h-dvh flex w-full bg-background">
          <AppSidebar
            onMouseEnter={handleSidebarMouseEnter}
            onMouseLeave={handleSidebarMouseLeave}
          />
        
        {/* --app-bar-offset is how far down the app bar currently pushes any
            pinned page chrome: its own height while it is showing, 0 while it is
            hidden. Published as a CSS variable rather than context so a page can
            pin a strip under the bar with one `top:` and no plumbing, and so the
            strip can transition on the same 300ms curve and travel with the bar
            instead of hanging in mid-air when it slides away. */}
        <div
          className={cn(
            "flex-1 flex flex-col min-w-0 overflow-x-clip",
            // The app bar is fixed in the app, so it no longer takes space in
            // the flow. Without this the first thing on every page starts
            // underneath it.
            native && "pt-[var(--app-bar-height,61px)]",
          )}
          style={{
            // How far down pinned page chrome has to start. It follows the bar
            // on both surfaces now, so a strip pinned under it rides with it
            // instead of hanging below an empty band.
            //
            // The hidden value differs: on the web the bar leaves nothing
            // behind, so 0. In the app the WebView is edge to edge and the
            // status bar is drawn over the page, so chrome still has to clear
            // the inset or it sits under the clock (2026-09-17 phone test).
            "--app-bar-offset": headerVisible
              ? "var(--app-bar-height, 61px)"
              : native ? "env(safe-area-inset-top, 0px)" : "0px",
          } as CSSProperties}
        >
          {/* The app is edge to edge: iOS draws the clock and the battery over
              the page, and in the app the bar above scrolls away, so once it
              has gone there is nothing behind the status bar but whatever
              content happens to be passing. Headings and table labels read
              straight through it (2026-09-23 phone screenshot).

              Until now one page solved this for itself: the dashboard's pinned
              tab strip carried `native-status-scrim`, which extended its own
              surface up behind the clock. That strip is a bottom bar now, so
              the trick went with it, and every other app page never had it at
              all. This is the same band, owned by the layout instead, so it
              covers every page.

              Fixed, not sticky: it must not move with anything. Behind the app
              bar's own top padding at rest, and the two share --native-chrome,
              so at the top of a page the seam is invisible. Nothing on the web,
              where the inset is 0 and the element has no height. */}
          {native && (
            <div
              aria-hidden
              className="native-status-scrim-fixed pointer-events-none fixed inset-x-0 top-0 z-30"
            />
          )}
          {/* Phase 9: app-bar-frost replaces the hard white seam — header now
              blends into the .surface-gradient backdrop with saturated blur.
              The column is the scroll container, so sticky pins the header at
              the top while content scrolls under it; translateY slides it off
              when scrolling down without leaving a layout gap (sticky is an
              overlay — content underneath is still in flow). */}
          <header
            className={cn(
              // Height is the --app-bar-height token (61px + the top safe
              // area; 44px inside the native shell, see index.css) and the
              // safe area is taken as top padding, so the controls sit below
              // the notch in the app and nothing changes in a browser, where
              // the inset is 0.
              "h-[var(--app-bar-height,61px)] pt-[env(safe-area-inset-top,0px)] app-bar-frost flex items-center justify-between px-2 sm:px-4 z-20 shrink-0",
              // Web: pinned, and slides away on scroll-down (effect above).
              // App: FIXED, and does the same. It used to be in flow and simply
              // scrolled away with the page, so the only way back to the menu,
              // search, notifications and avatar was to scroll to the very top.
              // Fixed rather than sticky on purpose: on iOS a fixed element is
              // held still by the compositor while content scrolls beneath, and
              // that is the one arrangement that does not tremble (index.css,
              // .native-shell .native-bottom-bar, 2026-09-23). Leaving the flow
              // is why the column pads its top by the bar's height in the app.
              native ? "fixed inset-x-0 top-0" : "sticky top-0",
              "transition-transform duration-300 ease-in-out will-change-transform",
              !headerVisible && "-translate-y-full",
            )}
          >
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              {/* The toggle now lives inside the sidebar header (AppSidebar).
                  Below md the sidebar is an off-canvas sheet, so a trigger
                  inside it is unreachable once closed — this one stays as the
                  only way back in on phones. md matches useIsMobile's 768px.
                  Same 36px hit box as every other icon in the bar. */}
              <SidebarTrigger className="md:hidden h-9 w-9 [&_svg]:h-5 [&_svg]:w-5" />
              <div className="hidden sm:flex min-w-0 items-center gap-2">
                {institution?.logo_url && (
                  <img
                    src={institution.logo_url}
                    alt=""
                    className="h-7 w-7 rounded-md object-cover border"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                )}
                <h1 className="text-lg font-semibold">{headerTitle}</h1>
              </div>
            </div>

            {/* Global Search - Hidden on mobile */}
            <div className="flex-1 max-w-md mx-2 sm:mx-4 hidden md:block">
              <div 
                className="relative cursor-pointer"
                onClick={() => setSearchOpen(true)}
              >
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by ID, name, or exam..."
                  className="pl-10 cursor-pointer bg-muted/50"
                  readOnly
                />
                <kbd className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
                  <span className="text-xs">⌘</span>K
                </kbd>
              </div>
            </div>

            {/* Phone: search, bell and avatar sit together on the right with
                one rhythm. The search glyph used to be its own flex item, so
                justify-between floated it alone in the middle of the bar. */}
            <div className="flex shrink-0 items-center gap-1 sm:gap-3">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Search"
                className="md:hidden h-9 w-9 rounded-full"
                onClick={() => setSearchOpen(true)}
              >
                <Search className="h-5 w-5" />
              </Button>

              {hasDualRole ? (
                <RoleSwitcher
                  variant="compact"
                  activeRole={activeViewRole}
                  onRoleChange={setActiveViewRole}
                  roles={viewRoles}
                />
              ) : (
                roleInfo?.primaryRole && (
                  <Badge variant="outline" className="hidden lg:inline-flex text-xs">
                    {getRoleBadge()}
                  </Badge>
                )
              )}
              
              <div data-tour="notifications">
                <NotificationBell />
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-8 w-8 sm:h-9 sm:w-9 rounded-full" data-tour="profile">
                    <UserAvatar
                      name={layoutProfile?.full_name}
                      email={layoutProfile?.email ?? user?.email}
                      avatarPath={layoutProfile?.avatar_path}
                      className="h-8 w-8 sm:h-9 sm:w-9"
                      fallbackClassName="bg-primary text-primary-foreground text-xs sm:text-sm"
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56 bg-popover" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none truncate">{user?.email}</p>
                      <p className="text-xs leading-none text-muted-foreground">
                        {getRoleBadge()}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/profile")}>
                    <User className="mr-2 h-4 w-4" />
                    Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/settings")}>
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {/* Password Expiry Warning */}
          <PasswordExpiryWarning />

          {/* Main Content — no overflow-y here; scrolling lives on the column
              wrapper above so sticky on the header actually activates. */}
          <main
            className={cn(
              "flex-1 p-3 sm:p-4 md:p-6",
              // Keep the last card clear of the fixed tab bar and home indicator.
              bottomNavItems && "pb-[calc(5rem+env(safe-area-inset-bottom,0px))]",
            )}
          >
            <div className="max-w-full">
              {/* Pages are lazy chunks. Without a boundary here the nearest one
                  is above the router, so moving to a page not yet downloaded
                  replaced the whole app bar and sidebar with the boot fallback.
                  Now only the content area waits and the chrome stays put. */}
              {/* Phone only: the current section's other pages as tabs. */}
              <SectionTabs />
              <Suspense fallback={<PageChunkFallback />}>
                {children}
              </Suspense>
            </div>
          </main>
        </div>
        </div>

        {/* Inside SidebarProvider: its "More" tab opens the sidebar sheet. */}
        {bottomNavItems && <MobileBottomNav items={bottomNavItems} />}

        {/* Global Search Dialog */}
        <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <CommandInput placeholder="Search exams, students, users by ID or name..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Quick Actions">
            <CommandItem onSelect={() => { setSearchOpen(false); navigate("/exams/create"); }}>
              Create New Exam
            </CommandItem>
            <CommandItem onSelect={() => { setSearchOpen(false); navigate("/dashboard"); }}>
              Go to Dashboard
            </CommandItem>
            <CommandItem onSelect={() => { setSearchOpen(false); navigate("/tasks"); }}>
              View Tasks
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Navigation">
            <CommandItem onSelect={() => { setSearchOpen(false); navigate("/exams"); }}>
              Exams
            </CommandItem>
            <CommandItem onSelect={() => { setSearchOpen(false); navigate("/evaluations"); }}>
              Evaluations
            </CommandItem>
            {/* Reports retired 2026-09-10. This palette entry was the only way a
                school admin could reach /reports at all: that role never had a
                sidebar entry for it. */}
            <CommandItem onSelect={() => { setSearchOpen(false); navigate("/settings"); }}>
              Settings
            </CommandItem>
          </CommandGroup>
        </CommandList>
        </CommandDialog>
      </SidebarProvider>
    </GuidedTourProvider>
  );
}
