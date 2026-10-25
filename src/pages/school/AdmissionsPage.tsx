import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info, Link2, Loader2, Search, Settings2, UserPlus, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, PageShell } from "@/components/shared/page";
import { MobileTabs } from "@/components/shared/nav";
import { EmptyState } from "@/components/shared/surfaces";
import { supabase } from "@/integrations/supabase/client";
import { useProfileData } from "@/hooks/useProfileData";
import { useInstitutionClassGroups } from "@/hooks/useClassGroups";
import { STAGE_LABEL, STAGE_ORDER, academicYearOptions, enquiryFormUrl, type AdmissionStage } from "@/lib/admissions";
import {
  useAdmissionPipeline,
  useAdmissionSettings,
  useAdmissionStageCounts,
  useAdmissionsReady,
  useIsAdmissionsStaff,
} from "@/hooks/admissions";
import { AdmissionSettingsSheet } from "@/components/admissions/AdmissionSettingsSheet";
import { EnquiryDetailSheet } from "@/components/admissions/EnquiryDetailSheet";
import { EnquiryLinkSheet } from "@/components/admissions/EnquiryLinkSheet";
import { NewEnquirySheet } from "@/components/admissions/NewEnquirySheet";
import { AdmissionsOverview } from "@/components/admissions/parts";
import { EnquiryRow, EnquiryRowHeader } from "@/components/admissions/EnquiryRow";
import { FIELD_LIFT } from "@/components/admissions/tokens";

const ALL = "all";

/**
 * Admissions: the enquiry to admission register (spec 2026-10-09). An
 * overview card, one toolbar line, and the register of the school's
 * enquiries stage by stage; the fee and the admission are done from each
 * row's detail. Everything is server side: counts come from
 * admission_stage_counts, the list from admission_pipeline a page at a time.
 */
export default function AdmissionsPage() {
  const navigate = useNavigate();
  const { data: profile, isLoading: profileLoading } = useProfileData();
  const institutionId = profile?.institution_id ?? null;
  const probe = useAdmissionsReady(!!institutionId);
  const access = useIsAdmissionsStaff(probe.ready);
  const enabled = probe.ready && access.allowed && !!institutionId;
  const settings = useAdmissionSettings(institutionId, enabled);
  const school = useQuery({
    queryKey: ["institution-code", institutionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("institutions").select("code, name").eq("id", institutionId as string).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
  const groups = useInstitutionClassGroups(enabled ? institutionId : null);

  const [stage, setStage] = useState<AdmissionStage | typeof ALL>(ALL);
  const [year, setYear] = useState<string>(ALL);
  const [groupId, setGroupId] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState<string | null>(null);
  // One server query per pause in typing, not per keystroke (CLAUDE.md section 23).
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim().length >= 2 ? search.trim() : null), 300);
    return () => clearTimeout(t);
  }, [search]);

  const filters = useMemo(
    () => ({
      stage: stage === ALL ? null : stage,
      classGroupId: groupId === ALL ? null : groupId,
      academicYearLabel: year === ALL ? null : year,
      q,
    }),
    [stage, groupId, year, q],
  );
  const pipeline = useAdmissionPipeline(institutionId, filters, enabled);
  const counts = useAdmissionStageCounts(institutionId, filters.academicYearLabel, enabled);
  const rows = useMemo(() => pipeline.data?.pages.flat() ?? [], [pipeline.data]);
  const filtered = stage !== ALL || year !== ALL || groupId !== ALL || !!q;
  const clearFilters = () => {
    setStage(ALL);
    setYear(ALL);
    setGroupId(ALL);
    setSearch("");
  };

  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  // This year and the next two; the list only changes at a new year.
  const years = useMemo(() => academicYearOptions(), []);

  if (profileLoading || probe.isLoading || (probe.ready && access.isLoading)) {
    return (
      <PageShell>
        <PageHeader title="Admissions" subtitle="Enquiries, registration and admission" />
        <div className="mt-6 space-y-6" aria-busy="true">
          <Skeleton className="h-40 rounded-card" />
          <Skeleton className="h-10 w-2/3 rounded-md" />
          <Skeleton className="h-64 rounded-card" />
        </div>
      </PageShell>
    );
  }

  if (!institutionId) {
    return (
      <PageShell>
        <PageHeader title="Admissions" />
        <EmptyState icon={<AlertTriangle className="h-7 w-7" />} tone="rose" reason="error" title="No school on this account" description="Sign in with a school admin account." />
      </PageShell>
    );
  }

  if (!probe.ready) {
    return (
      <PageShell>
        <PageHeader title="Admissions" subtitle="Enquiries, registration and admission" />
        <EmptyState
          icon={<Info className="h-7 w-7" />}
          tone="sky"
          reason="noData"
          title="Admissions switches on soon"
          description="Enquiries, the registration fee and admissions appear here once this school's setup is finished."
        />
      </PageShell>
    );
  }

  if (!access.allowed) {
    return (
      <PageShell>
        <PageHeader title="Admissions" />
        <EmptyState
          icon={<AlertTriangle className="h-7 w-7" />}
          tone="peach"
          reason="noData"
          title={access.isError ? "Couldn't check your access" : "No access to admissions"}
          description={access.isError ? "Check your connection and reload." : "Ask a school admin to name you as admissions staff in Admissions settings."}
        />
      </PageShell>
    );
  }

  const c = counts.data;
  const link = school.data?.code ? enquiryFormUrl(school.data.code) : "";
  const total = c ? Object.values(c).reduce((n, v) => n + v, 0) : null;
  const listHeading = stage === ALL ? "All enquiries" : STAGE_LABEL[stage];
  const listCount = c ? (stage === ALL ? total : c[stage]) : null;

  return (
    <PageShell>
      <PageHeader
        title="Admissions"
        subtitle={year === ALL ? "Enquiries, registration and admission" : `Academic year ${year}`}
        primaryAction={{ label: "New enquiry", onClick: () => setNewOpen(true), icon: <UserPlus className="h-4 w-4" /> }}
        secondaryActions={[
          { label: "Enquiry link", onClick: () => setLinkOpen(true), icon: <Link2 className="h-4 w-4" /> },
          ...(access.isAdmin ? [{ label: "Settings", onClick: () => setSettingsOpen(true), icon: <Settings2 className="h-4 w-4" /> }] : []),
        ]}
      />

      <div className="space-y-5">
        {counts.isError ? (
          <div className="surface-card frosted-shadow rounded-card flex flex-wrap items-center gap-3 p-4 text-sm text-ink-700">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            <p className="min-w-0 flex-1">The counts could not be loaded.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => counts.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <AdmissionsOverview counts={c} yearLabel={year === ALL ? null : year} loading={counts.isLoading} />
        )}

        {/* One toolbar line from lg: the stage tabs left, the filters and the search right. */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <MobileTabs
            value={stage}
            onValueChange={(v) => setStage(v as AdmissionStage | typeof ALL)}
            options={[{ value: ALL, label: "All" }, ...STAGE_ORDER.map((s) => ({ value: s, label: STAGE_LABEL[s] }))]}
            variant="segmented"
            density="compact"
          />
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger id="adm-year" aria-label="Academic year" className={`h-9 w-[8.5rem] shrink-0 focus:ring-inset focus:ring-offset-0 ${FIELD_LIFT}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All years</SelectItem>
                {years.map((y) => (
                  <SelectItem key={y} value={y}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger id="adm-class" aria-label="Class" className={`h-9 w-[9.5rem] shrink-0 focus:ring-inset focus:ring-offset-0 ${FIELD_LIFT}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All classes</SelectItem>
                {(groups.data ?? []).map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search child or parent phone"
                aria-label="Search enquiries"
                className={`h-9 pl-9 ${FIELD_LIFT}`}
              />
            </div>
            {filtered && (
              <Button type="button" variant="ghost" size="sm" className="h-9 text-ink-600" onClick={clearFilters}>
                Clear
              </Button>
            )}
          </div>
        </div>

        {pipeline.isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 rounded-card" />
            ))}
          </div>
        ) : pipeline.isError ? (
          <EmptyState
            icon={<AlertTriangle className="h-7 w-7" />}
            tone="rose"
            reason="error"
            title="Couldn't load the enquiries"
            description="Check your connection and try again."
            action={{ label: "Retry", onClick: () => pipeline.refetch() }}
          />
        ) : rows.length === 0 ? (
          filtered ? (
            <EmptyState icon={<Users className="h-7 w-7" />} reason="noResults" title="No enquiry matches" description="Try another stage, year or class." action={{ label: "Clear filters", onClick: clearFilters }} />
          ) : (
            <EmptyState
              icon={<UserPlus className="h-7 w-7" />}
              reason="noData"
              title="No enquiries yet"
              description="Enter the first one from the front desk, or share the enquiry link with parents."
              action={{ label: "New enquiry", onClick: () => setNewOpen(true) }}
            />
          )
        ) : (
          <div className="space-y-3">
            <div className="surface-card frosted-shadow rounded-card overflow-hidden">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-surface-stroke px-4 py-3">
                <h2 className="text-sm font-semibold text-ink-900">
                  {listHeading}
                  {listCount !== null && (
                    <span className="ml-2 text-xs font-normal tabular-nums text-ink-500">
                      {listCount} in {year === ALL ? "all years" : year}
                    </span>
                  )}
                </h2>
                <p className="text-xs text-ink-500">Newest first · open a row for its details and actions</p>
              </div>
              <EnquiryRowHeader />
              <ul className="divide-y divide-surface-stroke" data-enquiry-list="">
                {rows.map((r) => (
                  <EnquiryRow key={r.id} r={r} now={now} today={today} onOpen={() => setOpenId(r.id)} />
                ))}
              </ul>
            </div>
            {pipeline.hasNextPage && (
              <div className="flex justify-center">
                <Button type="button" variant="outline" size="sm" disabled={pipeline.isFetchingNextPage} onClick={() => pipeline.fetchNextPage()}>
                  {pipeline.isFetchingNextPage && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
                  Show more
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <NewEnquirySheet open={newOpen} onOpenChange={setNewOpen} institutionId={institutionId} questions={settings.data?.form_schema ?? []} />
      <EnquiryDetailSheet
        enquiryId={openId}
        institutionId={institutionId}
        settings={settings.data}
        onClose={() => setOpenId(null)}
        onOpenStudent={() => navigate("/school/students")}
      />
      {access.isAdmin && <AdmissionSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} institutionId={institutionId} settings={settings.data} />}
      <EnquiryLinkSheet open={linkOpen} onOpenChange={setLinkOpen} url={link} enabled={settings.data?.enquiry_form_enabled ?? true} />
    </PageShell>
  );
}
