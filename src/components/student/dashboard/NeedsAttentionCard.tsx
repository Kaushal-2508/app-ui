import * as React from "react";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { format, differenceInCalendarDays, differenceInMilliseconds } from "date-fns";
import {
  CalendarClock,
  ClipboardList,
  IndianRupee,
  MessageSquareText,
  ListChecks,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListRow } from "@/components/shared/surfaces";
import type { Tone } from "@/components/shared/design-system";
import { TONES } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ToneChip } from "./toneChip";
import { useStudentExams } from "@/hooks/useDashboardData";
import { useStudentHomework } from "@/hooks/useStudentHomework";
import { useStudentRemarks } from "@/hooks/useStudentRemarks";

// A week ahead, so "Due soon" reads as a plan, not only tonight's panic.
// Was 48h while this card was "What needs attention".
const DUE_SOON_MS = 7 * 24 * 60 * 60 * 1000;
/** Only surface a remark if it's reasonably recent (last 14 days). */
const REMARK_RECENT_MS = 14 * 24 * 60 * 60 * 1000;

type FeeSummaryRow = { total_overdue?: number };

interface AttentionItem {
  key: string;
  icon: React.ReactNode;
  tone: Tone;
  title: string;
  subtitle: string;
  /** When it is due; drives the trailing chip and the ordering. */
  when?: Date;
  onClick?: () => void;
}

/** "Today" / "Tomorrow" / weekday / date, toned by urgency. */
function DueChip({ when }: { when: Date }) {
  const days = differenceInCalendarDays(when, new Date());
  if (days < 0) return <ToneChip tone="rose">Overdue</ToneChip>;
  if (days === 0) return <ToneChip tone="rose">Today</ToneChip>;
  if (days === 1) return <ToneChip tone="peach">Tomorrow</ToneChip>;
  if (days < 7) return <ToneChip tone="sky">{format(when, "EEE")}</ToneChip>;
  return <ToneChip tone="sky">{format(when, "d MMM")}</ToneChip>;
}

function IconDisc({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const t = TONES[tone];
  return (
    <span className={cn("inline-flex h-10 w-10 items-center justify-center rounded-xl", t.bg, t.fg)}>
      {children}
    </span>
  );
}

/** Section 2 — a short, real, actionable to-do list. The whole card is hidden
 *  unless something genuinely needs the student's attention. */
export function NeedsAttentionCard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isFeatureEnabled } = useInstitutionFeatures();
  const homeworkOn = isFeatureEnabled("homework");
  const feesOn = isFeatureEnabled("fee_management");

  const { data: exams, isLoading: examsLoading, isError: examsError, refetch: refetchExams } = useStudentExams();
  const { data: homework, isLoading: hwLoading, isError: hwError, refetch: refetchHw } = useStudentHomework();
  const { data: remarks, isLoading: remarksLoading, isError: remarksError } = useStudentRemarks(user?.id ?? null);

  const { data: fees, isLoading: feesLoading, isError: feesError } = useQuery({
    // Shares the StatusStrip key so React Query dedups the fee summary fetch.
    queryKey: ["student-dashboard-fee-summary", user?.id],
    enabled: !!user?.id && feesOn,
    staleTime: 60_000,
    queryFn: async (): Promise<{ summary: FeeSummaryRow | null; nextDue: string | null }> => {
      const summaryP = supabase.rpc("get_student_fee_summary", { _student_id: user!.id });
      const dueP = supabase
        .from("fee_installments")
        .select("due_date, status")
        .eq("student_id", user!.id)
        .neq("status", "paid")
        .order("due_date", { ascending: true })
        .limit(1);
      const [summaryRes, dueRes] = await Promise.all([summaryP, dueP]);
      if (summaryRes.error) throw summaryRes.error;
      if (dueRes.error) throw dueRes.error;
      const summaryData = summaryRes.data as unknown as FeeSummaryRow | FeeSummaryRow[] | null;
      const summary = Array.isArray(summaryData) ? (summaryData[0] ?? null) : summaryData;
      const nextDue = (dueRes.data as { due_date: string }[] | null)?.[0]?.due_date ?? null;
      return { summary, nextDue };
    },
  });

  const items = useMemo<AttentionItem[]>(() => {
    const out: AttentionItem[] = [];
    const now = Date.now();

    // (1) Next upcoming exam — soonest scheduled, not yet started/submitted.
    const upcoming = (exams ?? [])
      .filter(
        (e) =>
          e.scheduled_date != null &&
          new Date(e.scheduled_date).getTime() > now &&
          (e.attempt_status === "available" || e.attempt_status === "not_started"),
      )
      .sort(
        (a, b) =>
          new Date(a.scheduled_date as string).getTime() -
          new Date(b.scheduled_date as string).getTime(),
      );
    const nextExam = upcoming[0];
    if (nextExam?.scheduled_date) {
      out.push({
        key: `exam-${nextExam.exam_id}`,
        icon: <CalendarClock className="h-5 w-5" />,
        tone: "sky",
        title: nextExam.title ?? "Upcoming exam",
        subtitle: `Exam on ${format(new Date(nextExam.scheduled_date), "EEE, d MMM")}`,
        when: new Date(nextExam.scheduled_date),
        onClick: () => navigate("/student/exams"),
      });
    }

    // (2) Homework due in the next 48h — not locked, not submitted (mirrors
    //     StudentHomeworkPage's dueSoon logic).
    if (homeworkOn) {
      const dueSoon = (homework ?? [])
        .filter((r) => !r.submission && r.status !== "checked" && !r.locked)
        .filter((r) => {
          const diff = differenceInMilliseconds(new Date(r.due_at), now);
          return diff > 0 && diff <= DUE_SOON_MS;
        })
        .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
      dueSoon.slice(0, 3).forEach((hw) => {
        out.push({
          key: `hw-${hw.id}`,
          icon: <ClipboardList className="h-5 w-5" />,
          tone: "peach",
          title: hw.title,
          subtitle: `Homework due ${format(new Date(hw.due_at), "EEE, d MMM, h:mm a")}`,
          when: new Date(hw.due_at),
          onClick: () => navigate(`/student/homework/${hw.id}`),
        });
      });
    }

    // (3) Overdue fee.
    if (feesOn) {
      const overdue = Number(fees?.summary?.total_overdue ?? 0);
      if (overdue > 0) {
        out.push({
          key: "fee-overdue",
          icon: <IndianRupee className="h-5 w-5" />,
          tone: "rose",
          title: `₹${overdue.toLocaleString()} in overdue fees`,
          subtitle: fees?.nextDue
            ? `Earliest due ${format(new Date(fees.nextDue), "d MMM")}`
            : "Please clear the pending amount",
          when: fees?.nextDue ? new Date(fees.nextDue) : undefined,
          onClick: () => navigate("/student/fees"),
        });
      }
    }

    // (4) Most recent actionable teacher remark (last 14 days).
    const actionable = (remarks ?? [])
      .filter(
        (r) =>
          (r.category === "improvement" || r.category === "behaviour") &&
          now - new Date(r.created_at).getTime() <= REMARK_RECENT_MS,
      )
      .slice(0, 1);
    actionable.forEach((r) => {
      out.push({
        key: `remark-${r.id}`,
        icon: <MessageSquareText className="h-5 w-5" />,
        tone: "violet",
        title: `Note from ${r.teacher?.full_name ?? "your teacher"}`,
        subtitle: r.remark_text,
      });
    });

    // Soonest first; undated items (a teacher's note) go last.
    return out.sort(
      (a, b) => (a.when?.getTime() ?? Infinity) - (b.when?.getTime() ?? Infinity),
    );
  }, [exams, homework, remarks, fees, homeworkOn, feesOn, navigate]);

  const isLoading =
    examsLoading ||
    (homeworkOn && hwLoading) ||
    (feesOn && feesLoading) ||
    remarksLoading;

  // Secondary card: render nothing at all unless there is something real to act
  // on. Staying hidden while the queries are still in flight also stops an empty
  // shell (or a skeleton) flashing on every load — for most students this card
  // has no items, so it should simply never appear.
  if (isLoading) return null;

  // Error before empty (§6): a failed read must not pass for "nothing due".
  if (examsError || (homeworkOn && hwError) || (feesOn && feesError) || remarksError) {
    return (
      <Card className="surface-card frosted-shadow rounded-card">
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <p className="text-sm text-ink-600">Couldn't load what's due.</p>
          <Button
            variant="ghost"
            size="sm"
            className="text-brand-primary"
            onClick={() => {
              void refetchExams();
              void refetchHw();
            }}
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) return null;

  return (
    <Card className="surface-card frosted-shadow rounded-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-ink-900">
          <ListChecks className="h-4 w-4 text-brand-primary" />
          Due soon
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3">
          {items.map((item) => (
            <ListRow
              key={item.key}
              as="li"
              leading={<IconDisc tone={item.tone}>{item.icon}</IconDisc>}
              title={item.title}
              subtitle={item.subtitle}
              trailing={item.when ? <DueChip when={item.when} /> : undefined}
              onClick={item.onClick}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
