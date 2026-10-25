import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2,
  Search,
  MoreHorizontal,
  Users,
  GraduationCap,
  FileText,
  RefreshCw,
  Trash2,
  LogIn,
  CheckCircle2,
  Crown,
  Lock,
  Plus,
  Eye,
  Pencil,
  UserCog,
  Sparkles,
  AlertTriangle,
  MapPin,
  ArrowUpRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeAdminOperation } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AddInstitutionDialog } from "@/components/admin/AddInstitutionDialog";
import { ViewInstitutionSheet } from "@/components/admin/ViewInstitutionSheet";
import { EditInstitutionDialog } from "@/components/admin/EditInstitutionDialog";
import { ManageQuotasDialog } from "@/components/admin/ManageQuotasDialog";
import { useNavigate } from "react-router-dom";
import { AssignSchoolOwnerDialog } from "@/components/admin/AssignSchoolOwnerDialog";
import { InstitutionLogoUploader } from "@/components/admin/InstitutionLogoUploader";
import { useInstitutionContext } from "@/contexts/InstitutionContext";
import { formatNumber } from "@/lib/formatNumber";
import { PageShell, PageHeader } from "@/components/shared/page";
import { StatTile, EmptyState } from "@/components/shared/surfaces";
import { FilterRow, FilterChip } from "@/components/shared/nav";
import { StaggerContainer, StaggerItem } from "@/components/ui/animated-container";
import { cn } from "@/lib/utils";

// --------------------------------------------------------------
// InstitutionsPage: /admin/institutions, reachable by super_admin ONLY
// (the route is gated in App.tsx), so this treatment never leaks to a
// school admin. Companion to SuperAdminDashboard's layered look:
//   * one dark "platform pulse" panel on the hero tokens (--hero-teal-*,
//     --hero-ink), which are defined for BOTH themes, so it stays a deep
//     teal-to-navy surface with white type in light mode and pulls down a
//     notch in dark mode instead of flipping to white,
//   * three neutral StatTiles beside it for the counts that are just counts,
//   * a search + status-chip toolbar with a live result count,
//   * institution cards with a tinted corner wash, a logo tile, a status
//     dot, a tabular stat strip and a footer "Open as admin" action.
// Every other colour is a token (surface-card, ink scale, brand hues), so
// the rest of the page flips with the theme for free. The query and the
// mutation are the ones the page already ran; only presentation changed.
// --------------------------------------------------------------

type StatusFilter = "all" | "active" | "inactive" | "demo";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "demo", label: "Demo" },
];

export default function InstitutionsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const { toast } = useToast();
  const navigate = useNavigate();
  const { startManaging } = useInstitutionContext();

  const queryClient = useQueryClient();

  // Dialog states
  const [viewInstId, setViewInstId] = useState<string | null>(null);
  const [editInstId, setEditInstId] = useState<string | null>(null);
  const [deleteInst, setDeleteInst] = useState<{ id: string; name: string } | null>(null);
  const [quotasInst, setQuotasInst] = useState<{ id: string; name: string } | null>(null);
  const [ownerInst, setOwnerInst] = useState<{ id: string; name: string } | null>(null);

  // Handle accessing institution as admin
  const handleAccessAsAdmin = (institutionId: string) => {
    startManaging(institutionId);
    navigate("/school/teachers");
    toast({
      title: "Managing Institution",
      description: "You are now managing this institution as an admin. Use the sidebar to navigate.",
    });
  };

  const { data: institutions, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-institutions"],
    // Platform-wide roster counts change slowly; a minute of staleness is
    // fine and the refresh button forces a refetch on demand.
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("institutions")
        .select(`
          id, name, code, is_active, is_system, is_demo, contact_email, contact_phone, address, created_at, logo_url,
          institution_subscriptions (plan_name, status, monthly_amount)
        `)
        .order("name");

      if (error) throw error;

      // One grouped count per school, computed on the server
      // (admin_institution_counts, 20260928161000): no row download and no
      // 1000-row cap. Students come from the platform's canonical roster
      // (institution_student_ids), so this grid shows the same total as the
      // Command Center; it used to count student ROLE rows.
      const { data: counts, error: countsError } = await supabase.rpc("admin_institution_counts");
      if (countsError) throw countsError;
      const tally = new Map<string, { teachers: number; students: number; exams: number }>(
        (counts ?? []).map((c) => [c.institution_id, { teachers: c.teachers, students: c.students, exams: c.exams }] as const),
      );

      return (data || []).map(inst => ({
        ...inst,
        stats: tally.get(inst.id) ?? { teachers: 0, students: 0, exams: 0 },
      }));
    },
  });

  const handleManageUsers = (institutionId: string) => {
    navigate(`/admin/users?institutionId=${institutionId}`);
  };

  const deleteInstitutionMutation = useMutation({
    mutationFn: async (institutionId: string) => {
      return invokeAdminOperation<{ message?: string }>({
        action: "delete_institution",
        data: { institutionId },
      });
    },
    onSuccess: (data) => {
      toast({
        title: "Institution deleted",
        description: data?.message || "The institution and all related data have been permanently removed.",
      });
      queryClient.invalidateQueries({ queryKey: ["admin-institutions"] });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setDeleteInst(null);
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't delete this institution.", context: "deleteInstitution" }),
  });

  // Platform-owned containers (SALCI Support) are not schools. They stay out
  // of the school grid and its counts and are listed read-only below with no
  // actions at all. On 2026-09-02 the support container sat in this grid as an
  // "Inactive" school and was deleted in a cleanup sweep, which took every
  // support task with it and broke intake for a week. The database now refuses
  // that delete (guard_system_institution); this keeps the button away too.
  const schoolInstitutions = useMemo(
    () => institutions?.filter((inst) => !inst.is_system) || [],
    [institutions],
  );
  const systemInstitutions = institutions?.filter((inst) => inst.is_system) || [];

  const filteredInstitutions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return schoolInstitutions.filter((inst) => {
      if (status === "active" && !inst.is_active) return false;
      if (status === "inactive" && inst.is_active) return false;
      if (status === "demo" && !inst.is_demo) return false;
      if (!q) return true;
      return inst.name.toLowerCase().includes(q) || inst.code.toLowerCase().includes(q);
    });
  }, [schoolInstitutions, search, status]);

  if (isLoading) {
    return <PageSkeleton />;
  }

  const activeCount = schoolInstitutions.filter(i => i.is_active).length;
  const inactiveCount = schoolInstitutions.length - activeCount;
  const demoCount = schoolInstitutions.filter(i => i.is_demo).length;
  const totalTeachers = schoolInstitutions.reduce((sum, i) => sum + i.stats.teachers, 0);
  const totalStudents = schoolInstitutions.reduce((sum, i) => sum + i.stats.students, 0);
  const totalExams = schoolInstitutions.reduce((sum, i) => sum + i.stats.exams, 0);
  const activePct = schoolInstitutions.length
    ? Math.round((activeCount / schoolInstitutions.length) * 100)
    : 0;

  const hasFilter = status !== "all" || search.trim().length > 0;

  const addTrigger = (
    <Button className="h-10 rounded-full bg-brand-primary px-4 text-sm font-medium text-white shadow-card hover:bg-brand-primary/90">
      <Plus className="mr-1.5 h-4 w-4" />
      Add institution
    </Button>
  );

  return (
    <PageShell>
      <PageHeader
        title="Institutions"
        subtitle="Every school on the platform, with who runs it and how busy it is."
        icon={<Building2 className="h-5 w-5" />}
        extras={
          <>
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-10 w-10 rounded-full border-surface-stroke bg-surface-card text-ink-700 shadow-card-sm hover:bg-ink-400/5 hover:text-ink-900"
            >
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            </Button>
            <AddInstitutionDialog trigger={addTrigger} />
          </>
        }
      />

      {error ? (
        // Error state renders BEFORE anything that could read as "zero
        // schools": a failed query must never show an empty grid and zeroed
        // tiles as if the platform were empty.
        <div className="surface-card frosted-shadow rounded-card p-6">
          <EmptyState
            icon={<AlertTriangle className="h-7 w-7" />}
            tone="rose"
            title="Couldn't load institutions"
            description="The list did not come back from the server. Check your connection and try again."
            reason="error"
            action={{ label: "Try again", onClick: () => refetch(), icon: <RefreshCw className="h-4 w-4" /> }}
          />
        </div>
      ) : (
        <>
          {/* Overview row: one dark pulse panel + three neutral tiles */}
          <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-5">
            <section
              aria-label="Platform pulse"
              className="hero-card hero-card--teal p-5 sm:p-6 lg:col-span-2"
            >
              <div className="relative z-[1] flex h-full flex-col justify-between gap-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="hero-eyebrow">Platform pulse</p>
                    <p className="mt-2 text-[40px] leading-none font-bold tabular-nums tracking-tight sm:text-[48px]">
                      {formatNumber(schoolInstitutions.length)}
                    </p>
                    <p className="mt-2 text-sm text-white/80">
                      {schoolInstitutions.length === 1 ? "institution" : "institutions"} on SALCI
                    </p>
                  </div>
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
                    <Building2 className="h-5 w-5" />
                  </span>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs text-white/80">
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                      {activeCount} active
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white/40" />
                      {inactiveCount} inactive
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                      {demoCount} demo
                    </span>
                  </div>
                  <div
                    className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/15"
                    role="progressbar"
                    aria-label="Share of active institutions"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={activePct}
                  >
                    <div
                      className="h-full rounded-full bg-emerald-300 transition-[width] duration-500"
                      style={{ width: `${activePct}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-white/70">{activePct}% of schools are live</p>
                </div>
              </div>
            </section>

            {/* Three tiles share one row at every width; on a phone that
                means tighter padding rather than one tile stranded alone
                on a full-width row. */}
            <div className="grid grid-cols-3 gap-3 sm:gap-4 lg:col-span-3">
              <StatTile
                label="Active"
                value={formatNumber(activeCount)}
                icon={<CheckCircle2 className="h-5 w-5" />}
                tone="mint"
                className="p-4 sm:p-5"
              />
              <StatTile
                label="Teachers"
                value={formatNumber(totalTeachers)}
                icon={<GraduationCap className="h-5 w-5" />}
                tone="violet"
                className="p-4 sm:p-5"
              />
              <StatTile
                label="Students"
                value={formatNumber(totalStudents)}
                icon={<Users className="h-5 w-5" />}
                tone="peach"
                className="p-4 sm:p-5"
              />
            </div>
          </div>

          {/* Toolbar: search + status chips + live count */}
          <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-md">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
              <Input
                placeholder="Search by name or code"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-11 rounded-full border-surface-stroke bg-surface-card pl-10 text-ink-900 shadow-card-sm placeholder:text-ink-500"
              />
            </div>
            <div className="flex items-center gap-3">
              <FilterRow
                activeCount={hasFilter ? 1 : 0}
                onClear={() => {
                  setSearch("");
                  setStatus("all");
                }}
                className="flex-1 lg:flex-none"
              >
                {STATUS_FILTERS.map((f) => (
                  <FilterChip
                    key={f.key}
                    label={f.label}
                    active={status === f.key}
                    onClick={() => setStatus(f.key)}
                    /* Toggle chips, not select triggers: no chevron. */
                    trailing={<></>}
                  />
                ))}
              </FilterRow>
              <span className="hidden shrink-0 text-sm tabular-nums text-ink-500 sm:inline">
                {filteredInstitutions.length} of {schoolInstitutions.length}
              </span>
            </div>
          </div>

          {systemInstitutions.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-dashed border-surface-stroke bg-surface-card/60 px-4 py-3 text-sm">
              <span className="inline-flex items-center gap-1.5 font-medium text-ink-900">
                <Lock className="h-4 w-4 text-ink-500" />
                System
              </span>
              <span className="text-ink-600">Platform-owned containers, not schools. They cannot be edited or deleted.</span>
              <div className="flex flex-wrap gap-2 sm:ml-auto">
                {systemInstitutions.map((inst) => (
                  <span
                    key={inst.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-ink-400/10 px-2.5 py-1 text-xs font-medium text-ink-700"
                  >
                    <Lock className="h-3 w-3" />
                    {inst.name}
                    <span className="text-ink-500">{inst.code}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Institutions grid */}
          {filteredInstitutions.length === 0 ? (
            <div className="surface-card frosted-shadow rounded-card mt-6 p-6">
              <EmptyState
                icon={<Building2 className="h-7 w-7" />}
                title={hasFilter ? "No institutions match" : "No institutions yet"}
                description={
                  hasFilter
                    ? "Try a different name or code, or clear the status filter."
                    : "Add the first school to start onboarding teachers and students."
                }
                reason={hasFilter ? "noResults" : "noData"}
                action={
                  hasFilter
                    ? {
                        label: "Clear filters",
                        onClick: () => {
                          setSearch("");
                          setStatus("all");
                        },
                      }
                    : undefined
                }
              />
              {!hasFilter && (
                <div className="flex justify-center pb-4">
                  <AddInstitutionDialog trigger={addTrigger} />
                </div>
              )}
            </div>
          ) : (
            <StaggerContainer
              className="mt-6 grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3"
              staggerDelay={0.04}
            >
              {filteredInstitutions.map((institution) => (
                <StaggerItem key={institution.id} className="h-full">
                  <InstitutionCard
                    institution={institution}
                    onAccess={() => handleAccessAsAdmin(institution.id)}
                    onView={() => setViewInstId(institution.id)}
                    onEdit={() => setEditInstId(institution.id)}
                    onUsers={() => handleManageUsers(institution.id)}
                    onQuotas={() => setQuotasInst({ id: institution.id, name: institution.name })}
                    onOwner={() => setOwnerInst({ id: institution.id, name: institution.name })}
                    onDelete={() => setDeleteInst({ id: institution.id, name: institution.name })}
                  />
                </StaggerItem>
              ))}
            </StaggerContainer>
          )}

          <p className="mt-6 text-center text-xs text-ink-500">
            {formatNumber(totalExams)} exams created across all schools
          </p>
        </>
      )}

      {/* Dialogs */}
      <ViewInstitutionSheet
        open={!!viewInstId}
        onOpenChange={(open) => !open && setViewInstId(null)}
        institutionId={viewInstId}
      />
      <EditInstitutionDialog
        open={!!editInstId}
        onOpenChange={(open) => !open && setEditInstId(null)}
        institutionId={editInstId}
      />
      <ManageQuotasDialog
        open={!!quotasInst}
        onOpenChange={(open) => !open && setQuotasInst(null)}
        institutionId={quotasInst?.id || null}
        institutionName={quotasInst?.name || ""}
      />
      <AssignSchoolOwnerDialog
        open={!!ownerInst}
        onOpenChange={(open) => !open && setOwnerInst(null)}
        institutionId={ownerInst?.id || null}
        institutionName={ownerInst?.name || ""}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteInst} onOpenChange={(open) => !open && setDeleteInst(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Permanently Delete Institution</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Are you sure you want to <strong className="text-foreground">permanently delete</strong> <strong className="text-foreground">{deleteInst?.name}</strong>?
                </p>
                <p className="font-medium text-foreground">This will irreversibly remove:</p>
                <ul className="list-disc ml-6 space-y-1 text-sm">
                  <li>All user accounts and their login credentials (emails/passwords)</li>
                  <li>All exams, questions, and student results</li>
                  <li>All classes, subjects, and syllabi</li>
                  <li>All associated data, files, and configurations</li>
                </ul>
                <p className="text-destructive font-semibold pt-2">
                  ⚠️ This action cannot be undone!
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteInstitutionMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteInst && deleteInstitutionMutation.mutate(deleteInst.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteInstitutionMutation.isPending}
            >
              {deleteInstitutionMutation.isPending ? "Deleting..." : "Delete Permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

// --------------------------------------------------------------
// Institution card
// --------------------------------------------------------------

interface InstitutionCardData {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  is_demo: boolean | null;
  address: string | null;
  logo_url: string | null;
  // The generated types call this join an object while PostgREST returns an
  // array for it; accept both and pick the first row.
  institution_subscriptions: Subscription | Subscription[] | null;
  stats: { teachers: number; students: number; exams: number };
}

type Subscription = { plan_name: string | null };

const pickOne = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

interface InstitutionCardProps {
  institution: InstitutionCardData;
  onAccess: () => void;
  onView: () => void;
  onEdit: () => void;
  onUsers: () => void;
  onQuotas: () => void;
  onOwner: () => void;
  onDelete: () => void;
}

function InstitutionCard({
  institution,
  onAccess,
  onView,
  onEdit,
  onUsers,
  onQuotas,
  onOwner,
  onDelete,
}: InstitutionCardProps) {
  const plan = pickOne(institution.institution_subscriptions)?.plan_name;
  const active = institution.is_active;

  return (
    <article
      className={cn(
        "group relative flex h-full flex-col overflow-hidden surface-card frosted-shadow rounded-card",
        "ring-1 ring-surface-stroke transition-[transform,box-shadow] duration-200",
        "hover:-translate-y-0.5 hover:shadow-card-lg",
      )}
    >
      {/* Tinted corner wash: active schools glow teal, dormant ones stay
          neutral so the grid reads status at a glance. Full literal class
          strings so Tailwind's scanner emits them. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-gradient-to-br to-transparent",
          active ? "from-brand-primary/20" : "from-ink-400/15",
        )}
      />

      <div className="relative flex items-start gap-3 p-5 pb-4">
        <InstitutionLogoUploader
          institutionId={institution.id}
          logoUrl={institution.logo_url ?? null}
          institutionName={institution.name}
          readOnly
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[17px] font-semibold leading-[22px] text-ink-900" title={institution.name}>
            {institution.name}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-ink-400/10 px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide text-ink-700">
              {institution.code}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                active
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-ink-400/10 text-ink-600",
              )}
            >
              <span
                aria-hidden
                className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-emerald-500" : "bg-ink-400")}
              />
              {active ? "Active" : "Inactive"}
            </span>
            {institution.is_demo && (
              <span
                className="rounded-full bg-brand-accent/10 px-2 py-0.5 text-[11px] font-medium text-brand-accent"
                title="Left out of SALCI turnaround figures"
              >
                Demo
              </span>
            )}
            {plan && (
              <span className="rounded-full bg-brand-secondary/10 px-2 py-0.5 text-[11px] font-medium capitalize text-brand-secondary">
                {plan}
              </span>
            )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${institution.name}`}
              className="h-8 w-8 shrink-0 rounded-full text-ink-500 hover:bg-ink-400/10 hover:text-ink-900"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={onAccess} className="font-medium text-brand-primary focus:text-brand-primary">
              <LogIn className="mr-2 h-4 w-4" />
              Open as admin
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onView}>
              <Eye className="mr-2 h-4 w-4" />
              View details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onUsers}>
              <UserCog className="mr-2 h-4 w-4" />
              Manage users
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onQuotas}>
              <Sparkles className="mr-2 h-4 w-4" />
              Manage AI quotas
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOwner}>
              <Crown className="mr-2 h-4 w-4" />
              Assign school owner
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 h-4 w-4" />
              Delete institution
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="relative flex items-start gap-1.5 px-5 text-[13px] leading-[18px] text-ink-500">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="line-clamp-2">{institution.address || "No address on file"}</span>
      </p>

      <dl className="relative mx-5 mt-4 grid grid-cols-3 divide-x divide-surface-stroke rounded-2xl bg-ink-400/[0.06] ring-1 ring-surface-stroke">
        <StatCell icon={<GraduationCap className="h-3.5 w-3.5" />} label="Teachers" value={institution.stats.teachers} />
        <StatCell icon={<Users className="h-3.5 w-3.5" />} label="Students" value={institution.stats.students} />
        <StatCell icon={<FileText className="h-3.5 w-3.5" />} label="Exams" value={institution.stats.exams} />
      </dl>

      <div className="relative mt-auto px-5 pb-5 pt-4">
        <Button
          variant="outline"
          onClick={onAccess}
          className={cn(
            "h-10 w-full justify-between rounded-full border-surface-stroke bg-surface-card text-sm font-medium text-ink-900",
            "transition-colors duration-200 hover:border-brand-primary/40 hover:bg-brand-primary/5 hover:text-brand-primary",
          )}
        >
          <span className="inline-flex items-center gap-2">
            <LogIn className="h-4 w-4" />
            Open as admin
          </span>
          <ArrowUpRight className="h-4 w-4 text-ink-400 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Button>
      </div>
    </article>
  );
}

function StatCell({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-2 py-3">
      <dd className="text-[18px] font-semibold leading-6 tabular-nums text-ink-900">{formatNumber(value)}</dd>
      <dt className="inline-flex items-center gap-1 text-[11px] text-ink-500">
        {icon}
        {label}
      </dt>
    </div>
  );
}

// --------------------------------------------------------------
// Loading skeleton: mirrors the layout so the page does not jump on load
// --------------------------------------------------------------

function PageSkeleton() {
  return (
    <PageShell>
      <div className="flex items-start justify-between gap-4 py-4 sm:py-6 lg:py-8">
        <div className="flex items-start gap-3">
          <Skeleton className="h-10 w-10 rounded-2xl lg:h-12 lg:w-12" />
          <div>
            <Skeleton className="h-8 w-44 rounded-lg" />
            <Skeleton className="mt-2 h-4 w-64 rounded-lg" />
          </div>
        </div>
        <Skeleton className="h-10 w-36 rounded-full" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-5">
        <Skeleton className="h-44 rounded-card lg:col-span-2" />
        <div className="grid grid-cols-3 gap-3 sm:gap-4 lg:col-span-3">
          <Skeleton className="h-32 rounded-card" />
          <Skeleton className="h-32 rounded-card" />
          <Skeleton className="h-32 rounded-card" />
        </div>
      </div>
      <Skeleton className="mt-6 h-11 w-full rounded-full lg:max-w-md" />
      <div className="mt-6 grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-64 rounded-card" />
        ))}
      </div>
    </PageShell>
  );
}
