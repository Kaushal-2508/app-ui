import * as React from "react";
import { BarChart3, Building2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { PageHeader, PageShell } from "@/components/shared/page";
import { MobileTabs } from "@/components/shared/nav";
import { FilterRow } from "@/components/shared/nav";
import { EmptyState } from "@/components/shared/surfaces";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  ANALYTICS_RANGES,
  DEFAULT_ANALYTICS_RANGE,
  rangeLabel,
  useAnalyticsClassOptions,
  useAnalyticsOverview,
  type AnalyticsRange,
  type ScoreBand,
} from "@/hooks/useSchoolAnalytics";
import { getDisplaySection } from "@/lib/sectionDisplay";

import { ClassesTab } from "./ClassesTab";
import { ExamsTab } from "./ExamsTab";
import { OverviewTab } from "./OverviewTab";
import { StudentBandSheet } from "./StudentBandSheet";
import { longDate } from "./chartTokens";

// The Integrity (proctoring) tab is HIDDEN here, not deleted. Proctoring only
// records anything for exams sat online, and these schools mark overwhelmingly
// from paper (Alliance: 1,990 of 17,567 marks online), so the tab was near-empty
// for the people who open this page. IntegrityTab still backs the super-admin
// platform-wide view in AnalyticsPage; restoring it here is one line.
const TABS = [
  { value: "overview", label: "Overview" },
  { value: "classes", label: "Classes" },
  { value: "exams", label: "Exams" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

const ALL_CLASSES = "__all__";

interface Props {
  /** The institution being analysed. Null while a super admin has not picked one. */
  institutionId: string | null;
  /** Renders the institution picker as the first filter. */
  showInstitutionPicker?: boolean;
  onInstitutionChange?: (id: string) => void;
}

export function SchoolAnalyticsView({
  institutionId,
  showInstitutionPicker = false,
  onInstitutionChange,
}: Props) {
  const [tab, setTab] = React.useState<TabValue>("overview");
  const [range, setRange] = React.useState<AnalyticsRange>(DEFAULT_ANALYTICS_RANGE);
  const [classId, setClassId] = React.useState<string | null>(null);
  const [band, setBand] = React.useState<ScoreBand | null>(null);

  // A class from the previous institution is meaningless (and the RPC rejects
  // it), so drop it whenever the school changes.
  React.useEffect(() => {
    setClassId(null);
    setBand(null);
  }, [institutionId]);

  const classOptions = useAnalyticsClassOptions(institutionId);
  const overview = useAnalyticsOverview(institutionId, range, classId);

  const win = overview.data?.window;
  const schoolName = overview.data?.institution?.name;

  const subtitle = React.useMemo(() => {
    const parts: string[] = [];
    if (schoolName) parts.push(schoolName);
    if (win?.from && win?.to) {
      parts.push(`${longDate(win.from)} to ${longDate(win.to)}`);
    } else {
      parts.push(rangeLabel(range));
    }
    return parts.join(" · ");
  }, [schoolName, win, range]);

  return (
    <PageShell>
      <PageHeader
        icon={<BarChart3 className="h-5 w-5" />}
        title="School Analytics"
        subtitle={subtitle}
        density="compact"
      />

      <FilterRow className="mt-1">
        {showInstitutionPicker && (
          <InstitutionPicker value={institutionId} onChange={onInstitutionChange} />
        )}

        <Select value={range} onValueChange={(v) => setRange(v as AnalyticsRange)}>
          <SelectTrigger
            aria-label="Period"
            className="h-10 w-[164px] shrink-0 rounded-full text-sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {ANALYTICS_RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          value={classId ?? ALL_CLASSES}
          onValueChange={(v) => setClassId(v === ALL_CLASSES ? null : v)}
          disabled={!institutionId}
        >
          <SelectTrigger
            aria-label="Class"
            className="h-10 w-[168px] shrink-0 rounded-full text-sm"
          >
            <SelectValue placeholder="All classes" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL_CLASSES}>All classes</SelectItem>
              {(classOptions.data ?? []).map((c) => {
                const section = getDisplaySection(c.name, c.section);
                return (
                  <SelectItem key={c.id} value={c.id}>
                    {section ? `${c.name} ${section}` : c.name}
                  </SelectItem>
                );
              })}
            </SelectGroup>
          </SelectContent>
        </Select>
      </FilterRow>

      <div className="mt-3">
        <MobileTabs
          value={tab}
          onValueChange={(v) => setTab(v as TabValue)}
          options={TABS.map((t) => ({ value: t.value, label: t.label }))}
        />
      </div>

      <div className="mt-4">
        {!institutionId ? (
          <EmptyState
            icon={<Building2 className="h-7 w-7" />}
            title={showInstitutionPicker ? "Choose a school" : "No school linked to your account"}
            description={
              showInstitutionPicker
                ? "Pick an institution above to see its analytics."
                : "Analytics is scoped to one school, and this account is not attached to one. Ask a super admin to link it."
            }
            tone="teal"
          />
        ) : (
          <>
            {tab === "overview" && (
              <OverviewTab
                institutionId={institutionId}
                query={{
                  data: overview.data,
                  isLoading: overview.isLoading,
                  isError: overview.isError,
                  refetch: () => void overview.refetch(),
                }}
                onPickBand={setBand}
              />
            )}
            {tab === "classes" && (
              <ClassesTab institutionId={institutionId} range={range} classId={classId} />
            )}
            {tab === "exams" && (
              <ExamsTab institutionId={institutionId} range={range} classId={classId} />
            )}

            <StudentBandSheet
              institutionId={institutionId}
              range={range}
              classId={classId}
              band={band}
              onOpenChange={(open) => {
                if (!open) setBand(null);
              }}
            />
          </>
        )}
      </div>
    </PageShell>
  );
}

/** Super-admin only: which school's analytics to look at. */
function InstitutionPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange?: (id: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["school-analytics", "institutions"],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("institutions")
        .select("id, name, is_active")
        .order("name")
        .range(0, 499);
      if (error) throw error;
      return rows ?? [];
    },
  });

  return (
    <Select value={value ?? ""} onValueChange={(v) => onChange?.(v)}>
      <SelectTrigger
        aria-label="Institution"
        className="h-10 w-[220px] shrink-0 rounded-full text-sm"
      >
        <SelectValue placeholder={isLoading ? "Loading schools..." : "Select a school"} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {(data ?? []).map((inst) => (
            <SelectItem key={inst.id} value={inst.id}>
              {inst.name}
              {!inst.is_active ? " (inactive)" : ""}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
