import { useState } from "react";
import { ChevronRight, ExternalLink, Loader2, Medal } from "lucide-react";
import { NavLink } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MobileTabs } from "@/components/shared/nav/MobileTabs";
import { FilterRow, FilterChip } from "@/components/shared/nav/FilterRow";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { useOlympiadCampaignsList } from "@/hooks/olympiad/useOlympiadCampaignsList";
import { useOlympiadSchoolsByStage, type StageSchoolRow } from "@/hooks/olympiad/useOlympiadSchoolsByStage";
import { OnboardSchoolForm } from "@/components/olympiad/admin/OnboardSchoolForm";
import { NewSchoolCredentialsPanel } from "@/components/olympiad/admin/NewSchoolCredentialsPanel";
import { PublicPaymentLink } from "@/components/olympiad/admin/PublicPaymentLink";
import type { OnboardSchoolResult } from "@/hooks/olympiad/useOnboardSchool";

const SUB_TABS = [
  { value: "onboard",     label: "Onboard school" },
  { value: "in_progress", label: "Olympiad in progress" },
  { value: "done",        label: "Olympiad done" },
] as const;

type SchoolType = "all" | "new" | "existing";

const STAGE_LABEL: Record<string, string> = {
  enrollment: "Enrollment",
  exam_scheduled: "Exam scheduled",
  exam_in_progress: "In progress",
  exam_completed: "Completed",
};

const STAGE_STYLE: Record<string, string> = {
  enrollment: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300",
  exam_scheduled: "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-300",
  exam_in_progress: "bg-violet-100 text-violet-900 dark:bg-violet-500/15 dark:text-violet-300",
  exam_completed: "bg-slate-200 text-slate-800 dark:bg-slate-500/15 dark:text-slate-300",
};

function StageSchoolListRow({ row }: { row: StageSchoolRow }) {
  return (
    <NavLink
      to={`/admin/olympiad/schools/${row.id}`}
      className="flex items-center gap-3 px-4 py-3 surface-card frosted-shadow rounded-card hover:bg-surface-card/80 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-ink-900 truncate">{row.institution_name}</p>
          {row.is_existing && <ExternalLink className="h-3 w-3 text-ink-500 flex-shrink-0" />}
        </div>
        <p className="text-[11px] text-ink-500 mt-0.5">
          {row.school_short_code} · {row.enrolled_count} enrolled
          {row.city ? ` · ${row.city}` : ""}
        </p>
      </div>
      <Badge className={`text-[10px] ${STAGE_STYLE[row.derived_stage] ?? ""}`} variant="secondary">
        {STAGE_LABEL[row.derived_stage] ?? row.derived_stage}
      </Badge>
      <ChevronRight className="h-4 w-4 text-ink-500 flex-shrink-0" />
    </NavLink>
  );
}

function StageSchoolList({
  campaignId,
  bucket,
  schoolType,
}: {
  campaignId: string | undefined;
  bucket: "in_progress" | "done";
  schoolType: SchoolType;
}) {
  const q = useOlympiadSchoolsByStage(campaignId, bucket, schoolType);
  const rows = (q.data?.pages ?? []).flat();

  if (q.isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Medal className="h-7 w-7" />}
        title={bucket === "in_progress" ? "No schools in progress" : "No completed schools yet"}
        description={bucket === "in_progress" ? "Onboard a school to get started." : "Schools appear here once their Olympiad finishes."}
      />
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => <StageSchoolListRow key={row.id} row={row} />)}
      {q.hasNextPage && (
        <Button
          variant="outline"
          className="w-full"
          disabled={q.isFetchingNextPage}
          onClick={() => q.fetchNextPage()}
        >
          {q.isFetchingNextPage && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Load more
        </Button>
      )}
    </div>
  );
}

export default function OlympiadSchoolsTab() {
  const { data: campaigns } = useOlympiadCampaignsList();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const campaignId = selectedCampaignId ?? campaigns?.[0]?.id;

  const [sub, setSub] = useState<string>("onboard");
  const [type, setType] = useState<SchoolType>("all");
  const [onboardResult, setOnboardResult] = useState<OnboardSchoolResult | null>(null);

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">Schools</p>
        <Select value={campaignId ?? ""} onValueChange={setSelectedCampaignId}>
          <SelectTrigger className="h-9 w-auto min-w-[9rem]"><SelectValue placeholder="Campaign" /></SelectTrigger>
          <SelectContent>
            {(campaigns ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.campaign_year}{c.status === "archived" ? " (archived)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <MobileTabs
        value={sub}
        onValueChange={setSub}
        options={SUB_TABS.map((t) => ({ value: t.value, label: t.label }))}
      />

      {sub === "onboard" && (
        <div className="space-y-4">
          {campaignId ? (
            <OnboardSchoolForm campaignId={campaignId} onSuccess={setOnboardResult} />
          ) : (
            <EmptyState icon={<Medal className="h-7 w-7" />} title="No campaign" description="Create a campaign first." />
          )}
          {onboardResult && (
            <>
              <PublicPaymentLink schoolShortCode={onboardResult.school_short_code} />
              <NewSchoolCredentialsPanel result={onboardResult} />
            </>
          )}
        </div>
      )}

      {(sub === "in_progress" || sub === "done") && (
        <div className="space-y-3">
          <FilterRow>
            <FilterChip label="All" active={type === "all"} onClick={() => setType("all")} trailing={null} />
            <FilterChip label="New schools" active={type === "new"} onClick={() => setType("new")} trailing={null} />
            <FilterChip label="Onboarded" active={type === "existing"} onClick={() => setType("existing")} trailing={null} />
          </FilterRow>

          <StageSchoolList campaignId={campaignId} bucket={sub} schoolType={type} />
        </div>
      )}
    </div>
  );
}
