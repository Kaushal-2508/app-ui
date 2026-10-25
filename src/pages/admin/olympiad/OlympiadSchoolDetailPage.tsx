import { useState } from "react";
import { useParams, NavLink, useNavigate } from "react-router-dom";
import { ArrowLeft, Archive, Banknote, CreditCard, Loader2, LogIn, UserCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { useOlympiadSchool } from "@/hooks/olympiad/useOlympiadSchool";
import { useOlympiadSchoolOverview } from "@/hooks/olympiad/useOlympiadSchoolOverview";
import { useOlympiadSchoolResultSummary } from "@/hooks/olympiad/useOlympiadSchoolResultSummary";
import { PublicPaymentLink } from "@/components/olympiad/admin/PublicPaymentLink";
import { RefundConfirmDialog } from "@/components/olympiad/admin/RefundConfirmDialog";
import { ImpersonateDialog } from "@/components/olympiad/admin/ImpersonateDialog";
import { ArchiveCampaignDialog } from "@/components/olympiad/admin/ArchiveCampaignDialog";
import { SchoolPaymentDrilldownSheet } from "@/components/olympiad/admin/SchoolPaymentDrilldownSheet";
import { SchoolResultSummaryCard } from "@/components/olympiad/admin/SchoolResultSummaryCard";
import { SchoolAdminLoginCard } from "@/components/olympiad/admin/SchoolAdminLoginCard";
import { useInstitutionContext } from "@/contexts/InstitutionContext";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/toast";

const rupees = (amount: number) => `₹${amount.toLocaleString("en-IN")}`;

const STAGE_LABEL: Record<string, string> = {
  enrollment: "Enrollment",
  exam_scheduled: "Exam scheduled",
  exam_in_progress: "Exam in progress",
  exam_completed: "Exam completed",
};

const STAGE_STYLE: Record<string, string> = {
  enrollment: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300",
  exam_scheduled: "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-300",
  exam_in_progress: "bg-violet-100 text-violet-900 dark:bg-violet-500/15 dark:text-violet-300",
  exam_completed: "bg-slate-200 text-slate-800 dark:bg-slate-500/15 dark:text-slate-300",
};

export default function OlympiadSchoolDetailPage() {
  const { olySchoolId } = useParams();
  const { data: school, isLoading } = useOlympiadSchool(olySchoolId);
  const overview = useOlympiadSchoolOverview(olySchoolId);
  const derivedStage = overview.data?.derived_stage;
  const isDone = derivedStage === "exam_completed";
  // Server-accurate (oly_school_overview). The detail page must NOT client-count
  // students/payments — that capped at 1000 rows and contradicted these tiles.
  const totalStudents = overview.data?.total_students ?? 0;
  const resultSummary = useOlympiadSchoolResultSummary(olySchoolId, isDone);
  const [refundOpen, setRefundOpen] = useState(false);
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [drillChannel, setDrillChannel] = useState<"cash" | "online" | null>(null);
  const navigate = useNavigate();
  const { startManaging } = useInstitutionContext();
  const { toast } = useToast();

  const handleAccessAsAdmin = () => {
    if (!school?.institution_id) {
      toastError(new Error("School is not linked to an institution"), {
        fallback: "This school has no linked institution to manage.",
        context: "olyAccessAsAdmin",
      });
      return;
    }
    startManaging(school.institution_id);
    navigate("/school/teachers");
    toast({
      title: "Managing school",
      description: "You are now managing this school as an admin. Use the sidebar to navigate.",
    });
  };

  if (isLoading) {
    return (
      <PageShell>
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
      </PageShell>
    );
  }

  if (!school) {
    return (
      <PageShell>
        <div className="py-6 text-sm text-ink-600">
          School not found. <NavLink to="/admin/olympiad/schools" className="underline">Back to schools</NavLink>.
        </div>
      </PageShell>
    );
  }

  const cashTile = (
    <button type="button" onClick={() => setDrillChannel("cash")} className="text-left">
      <StatTile
        label="Cash collected"
        value={rupees(overview.data?.cash_rupees ?? 0)}
        icon={<Banknote className="h-5 w-5" />}
        tone="mint"
      />
    </button>
  );
  const onlineTile = (
    <button type="button" onClick={() => setDrillChannel("online")} className="text-left">
      <StatTile
        label="Online collected"
        value={rupees(overview.data?.online_rupees ?? 0)}
        icon={<CreditCard className="h-5 w-5" />}
        tone="sky"
      />
    </button>
  );

  return (
    <PageShell>
      <NavLink to="/admin/olympiad/schools" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2">
        <ArrowLeft className="h-4 w-4" /> All schools
      </NavLink>
      <PageHeader
        title={school.institution_name}
        subtitle={`${school.school_short_code} · ${school.city ?? "N/A"}, ${school.state ?? "N/A"}`}
      />

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <Button size="sm" onClick={handleAccessAsAdmin}>
          <LogIn className="h-4 w-4 mr-1" />
          Access school admin dashboard
        </Button>
        <Button size="sm" variant="outline" onClick={() => setImpersonateOpen(true)}>
          <UserCog className="h-4 w-4 mr-1" />
          View as Admin
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={school.status !== "results_published"}
          onClick={() => setArchiveOpen(true)}
        >
          <Archive className="h-4 w-4 mr-1" />
          Archive
        </Button>
      </div>

      <div className="space-y-4 py-4">
        {overview.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
        ) : overview.data ? (
          <>
            <div className="flex items-center gap-2">
              <p className="eyebrow">Stage</p>
              <Badge
                className={`text-[11px] ${STAGE_STYLE[overview.data.derived_stage] ?? ""}`}
                variant="secondary"
              >
                {STAGE_LABEL[overview.data.derived_stage] ?? overview.data.derived_stage}
              </Badge>
            </div>

            {isDone ? (
              <>
                <StatTileGrid>
                  <StatTile label="Total students" value={overview.data.total_students.toString()} tone="teal" />
                  {cashTile}
                  {onlineTile}
                </StatTileGrid>
                {resultSummary.isLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
                ) : resultSummary.data ? (
                  <SchoolResultSummaryCard summary={resultSummary.data} />
                ) : null}
              </>
            ) : (
              <StatTileGrid>
                <StatTile label="Total students" value={overview.data.total_students.toString()} tone="teal" />
                {derivedStage === "exam_in_progress" && (
                  <StatTile label="Attempted" value={overview.data.attempted_count.toString()} tone="violet" />
                )}
                {cashTile}
                {onlineTile}
              </StatTileGrid>
            )}
          </>
        ) : (
          <StatTileGrid>
            <StatTile label="Status" value={school.status.replace(/_/g, " ")} tone="violet" />
          </StatTileGrid>
        )}

        <PublicPaymentLink schoolShortCode={school.school_short_code} />

        <SchoolAdminLoginCard
          olySchoolId={school.id}
          loginEmail={school.primary_contact_email}
          isExisting={school.is_existing_salci_school}
        />

        <section className="surface-card frosted-shadow rounded-card p-4 space-y-2">
          <p className="eyebrow">Primary contact</p>
          <p className="text-sm text-ink-900">{school.primary_contact_name}</p>
          <p className="text-xs text-ink-600">{school.primary_contact_email}</p>
          <p className="text-xs text-ink-600">{school.primary_contact_phone}</p>
        </section>

        <section className="surface-card frosted-shadow rounded-card p-4 space-y-2 border border-destructive/20">
          <p className="eyebrow text-destructive">Danger zone</p>
          <p className="text-xs text-ink-600">
            Cancel this school and refund every active student. Cash enrollments are flagged &quot;offline&quot; for the school to
            refund physically.
          </p>
          <Button
            variant="destructive"
            disabled={totalStudents === 0}
            onClick={() => setRefundOpen(true)}
          >
            Cancel school + refund {totalStudents} student{totalStudents === 1 ? "" : "s"}
          </Button>
        </section>
      </div>

      <RefundConfirmDialog
        open={refundOpen}
        onOpenChange={setRefundOpen}
        input={{ scope: "school_wide", oly_school_id: school.id }}
        contextLabel={`Cancel ${school.institution_name} and refund ${totalStudents} students?`}
        confirmWord="REFUND"
      />

      <ImpersonateDialog
        open={impersonateOpen}
        onOpenChange={setImpersonateOpen}
        olySchoolId={school.id}
        schoolName={school.institution_name}
      />

      <ArchiveCampaignDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        olySchoolId={school.id}
        schoolName={school.institution_name}
      />

      {drillChannel && olySchoolId && (
        <SchoolPaymentDrilldownSheet
          open={!!drillChannel}
          onOpenChange={(o) => !o && setDrillChannel(null)}
          olySchoolId={olySchoolId}
          channel={drillChannel}
        />
      )}
    </PageShell>
  );
}
