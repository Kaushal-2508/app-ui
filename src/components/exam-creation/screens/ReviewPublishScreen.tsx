import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  Printer,
  Eye,
  Loader2,
  Save as SaveIcon,
  CalendarClock,
  KeyRound,
  AlertCircle,
  AlertTriangle,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AnimatedContainer } from "@/components/ui/animated-container";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ExamPaperDocument,
  buildExamPaperHtml,
  fromExamFormData,
  loadLogoDataUrl,
  printExamPaper,
} from "@/components/exam/paper";
import { useInstitutionBranding } from "@/hooks/useInstitutionBranding";
import { useExamDraftLabels } from "@/hooks/useExamDraftLabels";
import {
  validateExamForReview,
  type ReviewIssue,
} from "../lib/examReviewValidation";
import {
  DEFAULT_LATE_ENTRY_MINUTES,
  clampLateEntryMinutes,
  computeExamSchedule,
  formatClock,
} from "@/lib/examSchedule";
import { isExamSlotConflictError, type ExamSlotBooking } from "@/lib/examSlots";
import { StickyBottomCTA } from "../components/StickyBottomCTA";
import { ExamStepIndicator, type ExamWizardStep } from "../components/ExamStepIndicator";
import { ExamSchedulePlanner } from "../components/ExamSchedulePlanner";
import { MobileSheet } from "@/components/shared/sheets";
import { useSaveExamTemplate } from "@/hooks/useExamTemplates";
import { useExamSlotPlan } from "@/hooks/useExamSlotPlan";
import type {
  ExamFormData,
  ExamStats,
  ResultVisibility,
  ProctoringConfig,
} from "@/types/exam";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";

interface ReviewPublishScreenProps {
  /** Steps the teacher may jump to from the header indicator. */
  reachableSteps?: ExamWizardStep[];
  onNavigateStep?: (step: ExamWizardStep) => void;
  formData: ExamFormData;
  /** Computed by useExamForm; feeds the paper header (totals) for print. */
  stats: ExamStats;
  updateMetadata: (patch: Partial<ExamFormData["metadata"]>) => void;
  onBack: () => void;
  onPublish: () => void;
  isPublishing: boolean;
  /** Error of the last publish attempt, if it failed. A slot clash the server
   * caught (someone booked the time first) is shown inside the sheet. */
  publishError?: unknown;
  /** Persists the draft. The old "Save draft" here only went back a step. */
  onSaveDraft: () => void;
  isSavingDraft: boolean;
  /** Opens the Questions step on the given section. */
  onEditSection: (sectionTempId: string) => void;
}

export function ReviewPublishScreen({
  reachableSteps,
  onNavigateStep,
  formData,
  stats,
  updateMetadata,
  onBack,
  onPublish,
  isPublishing,
  publishError,
  onSaveDraft,
  isSavingDraft,
  onEditSection,
}: ReviewPublishScreenProps) {
  const proctoring: ProctoringConfig = formData.metadata.proctoringConfig ?? {
    webcam: false,
    tabSwitchLock: false,
    fullscreenLock: false,
    copyPasteDisable: false,
  };
  const resultVisibility: ResultVisibility =
    formData.metadata.resultVisibility ?? "after_teacher_releases";

  const isHybridMode = formData.metadata.examMode === "hybrid";

  // Hybrid is marked by hand — never allow "immediate". If the teacher picked it
  // for another mode and then switched to hybrid, correct it on entry.
  useEffect(() => {
    if (isHybridMode && resultVisibility === "immediate") {
      updateMetadata({ resultVisibility: "after_teacher_releases" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHybridMode, resultVisibility]);

  // The full paper lives behind a button: inline, a long paper pushed the
  // publish settings far below the fold. Answer key is a teacher-only overlay.
  const [paperOpen, setPaperOpen] = useState(false);
  const [showAnswerKey, setShowAnswerKey] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState(formData.metadata.title);
  const [templateDesc, setTemplateDesc] = useState("");
  const [templateShared, setTemplateShared] = useState(false);

  // Publish confirmation dialog — schedule fields were removed from the
  // details screen and are only collected here, right before publish, so
  // teachers don't fill them in before they're sure they want to publish.
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const lateEntryMinutes =
    formData.metadata.lateEntryMinutes ?? DEFAULT_LATE_ENTRY_MINUTES;

  // Booked slots for the selected sections, so two teachers can't pick the
  // same time for one class. Read only while the sheet is open; the server
  // guard (migration 20260928170000) is the real check.
  const slotPlan = useExamSlotPlan(formData, scheduleOpen);
  // A failed refetch keeps the previous data, so a stale clash must not block
  // publishing while the sheet says "You can still publish": the server check
  // decides then.
  const hasSlotClash =
    slotPlan.checksTime && !slotPlan.isError && slotPlan.clashes.length > 0;
  const [checkingSlot, setCheckingSlot] = useState(false);

  // A clash the server caught (someone published into this time after the
  // sheet loaded). Remembered with the slot it was raised for, so it clears
  // the moment the teacher picks a different time. Adjusted during render
  // rather than in an effect, the React pattern for "derive from a change".
  const slotKey = `${slotPlan.selectedKey}|${formData.metadata.startTime}|${
    formData.metadata.durationMinutes ?? ""
  }|${lateEntryMinutes}`;
  // The slot actually sent with the last publish, so a refusal is tied to that
  // slot and not to whatever the fields show when the error comes back.
  const [submittedSlot, setSubmittedSlot] = useState<string | null>(null);
  const [serverClash, setServerClash] = useState<{ error: unknown; slot: string } | null>(null);
  if (isExamSlotConflictError(publishError) && serverClash?.error !== publishError) {
    setServerClash({ error: publishError, slot: submittedSlot ?? slotKey });
  }
  const serverClashMessage =
    serverClash && serverClash.error === publishError && serverClash.slot === slotKey
      ? String((publishError as { message?: unknown }).message ?? "This time was just booked.")
      : null;

  const handleDateChange = (key: string) => {
    updateMetadata({ scheduledDate: key ? new Date(key) : null });
  };

  const recalcEndTime = (start: string, duration: number, lateEntry: number) => {
    const next = computeExamSchedule({
      scheduledDate: formData.metadata.scheduledDate ?? new Date(),
      startTime: start,
      durationMinutes: duration,
      lateEntryMinutes: lateEntry,
    });
    return next.end ? formatClock(next.end) : "";
  };

  const handleStartTimeChange = (v: string) => {
    const end = recalcEndTime(v, formData.metadata.durationMinutes ?? 60, lateEntryMinutes);
    updateMetadata({ startTime: v, endTime: end });
  };

  const handleDurationChange = (v: number) => {
    const end = recalcEndTime(formData.metadata.startTime, v, lateEntryMinutes);
    updateMetadata({ durationMinutes: v, endTime: end });
  };

  // Late entry moves the end too — without this the stored end_time kept the
  // old window whenever only the late-entry field was edited.
  const handleLateEntryChange = (raw: number) => {
    const next = clampLateEntryMinutes(raw);
    const end = recalcEndTime(
      formData.metadata.startTime,
      formData.metadata.durationMinutes ?? 60,
      next,
    );
    updateMetadata({ lateEntryMinutes: next, endTime: end });
  };

  const isOfflineMode = formData.metadata.examMode === "offline";

  // Pre-publish checks. Blocking issues disable Publish; warnings only show.
  const validation = useMemo(() => validateExamForReview(formData), [formData]);

  const jumpToIssue = (issue: ReviewIssue) => {
    if (issue.sectionTempId) {
      onEditSection(issue.sectionTempId);
    } else {
      onNavigateStep?.("details");
    }
  };

  const scheduleValid = isOfflineMode
    ? !!formData.metadata.scheduledDate
    : !!formData.metadata.scheduledDate &&
      !!formData.metadata.startTime &&
      (formData.metadata.durationMinutes ?? 0) > 0;

  const handlePublishClick = () => {
    if (validation.blocking.length > 0) {
      const n = validation.blocking.length;
      toast.error(`Fix ${n} issue${n === 1 ? "" : "s"} in the paper before publishing.`);
      return;
    }
    setScheduleOpen(true);
  };

  // The publish below resumes after an await, in the closure of the tap. By
  // then the teacher may have closed the sheet or left the screen, so it reads
  // these live values instead, and publishes through the LATEST onPublish
  // (current form data, current single-flight state).
  const latestRef = useRef({ open: scheduleOpen, slotKey, onPublish });
  useEffect(() => {
    latestRef.current = { open: scheduleOpen, slotKey, onPublish };
  });
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The sheet stays open while publishing: on success the flow navigates away,
  // and a failure (a slot booked a moment ago) is shown right here instead of
  // in a toast behind a closed sheet.
  const handleConfirmPublish = async () => {
    if (!scheduleValid) {
      toast.error(
        isOfflineMode
          ? "Pick the date the exam was conducted"
          : "Fill in the exam date, timing, and availability window"
      );
      return;
    }
    if (hasSlotClash || checkingSlot) return;
    const clickedSlot = slotKey;
    if (slotPlan.checksTime && !slotPlan.isError) {
      // Re-read right before publishing: the list may be a minute old.
      setCheckingSlot(true);
      let fresh: ExamSlotBooking[] | null = null;
      try {
        fresh = await slotPlan.recheck();
      } finally {
        if (mountedRef.current) setCheckingSlot(false);
      }
      if (fresh && fresh.length > 0) return;
      const latest = latestRef.current;
      if (!mountedRef.current || !latest.open || latest.slotKey !== clickedSlot) return;
    }
    setSubmittedSlot(clickedSlot);
    latestRef.current.onPublish();
  };

  const { mutate: saveTemplate, isPending: savingTemplate } =
    useSaveExamTemplate();

  const setProctoring = (patch: Partial<ProctoringConfig>) => {
    updateMetadata({
      proctoringConfig: { ...proctoring, ...patch },
    });
  };

  // One source for the paper total: the same stats the printed header uses.
  const totalMarks = stats.totalMarks;
  useEffect(() => {
    if (
      (formData.metadata.passMarks === null ||
        formData.metadata.passMarks === undefined) &&
      totalMarks > 0
    ) {
      updateMetadata({ passMarks: totalMarks * 0.33 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalMarks]);

  // Print goes through the shared paper renderer (src/components/exam/paper),
  // the same one the DB-backed preview and PDF download use. The screen used
  // to build its own HTML string here, which dropped every question-level and
  // sub-question diagram, had no letterhead, did not escape text, and called
  // print() before any image had loaded. Do not reintroduce a local builder.
  const { branding } = useInstitutionBranding(formData.context.institutionId || null);
  const { className, subjectName } = useExamDraftLabels(
    formData.context.classIds,
    formData.context.subjectIds,
  );
  const paperData = useMemo(
    () => fromExamFormData(formData, stats, branding, { className, subjectName }),
    [formData, stats, branding, className, subjectName],
  );

  // The logo is inlined as a data: URL so it renders inside the print popup
  // without depending on network access or auth.
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadLogoDataUrl(branding?.logoUrl ?? null).then((url) => {
      if (!cancelled) setLogoDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [branding?.logoUrl]);

  const handlePrint = (withAnswerKey: boolean) => {
    const html = buildExamPaperHtml(paperData, {
      logoDataUrl,
      isOffline: isOfflineMode,
      showStudentDetailsBox: isOfflineMode,
      answerKey: withAnswerKey,
    });
    printExamPaper(html);
  };

  const handleSaveTemplate = () => {
    if (!templateName.trim()) {
      toast.error("Template name is required");
      return;
    }
    saveTemplate(
      {
        name: templateName.trim(),
        description: templateDesc.trim() || null,
        formData,
        isShared: templateShared,
      },
      {
        onSuccess: () => {
          toast.success("Saved as template");
          setTemplateOpen(false);
        },
        onError: (err: unknown) => {
          toastError(err, { fallback: "Couldn't save the template.", context: "saveExamTemplate" });
        },
      }
    );
  };

  return (
    <AnimatedContainer className="mx-auto max-w-4xl pb-28">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:px-8">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11"
            onClick={onBack}
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="text-xs text-muted-foreground">Review & publish</div>
            <div className="text-sm font-semibold md:text-base">
              {formData.metadata.title || "Untitled exam"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Desktop step indicator */}
          <ExamStepIndicator
            className="mr-4"
            current="review"
            reachable={reachableSteps ?? []}
            onNavigate={onNavigateStep ?? (() => {})}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => setPaperOpen(true)}
          >
            <Eye className="h-4 w-4" />
            Review paper
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                aria-label="Print the question paper"
              >
                <Printer className="h-4 w-4" />
                Print
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => handlePrint(false)}>
                <Printer className="mr-2 h-4 w-4" />
                Question paper
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handlePrint(true)}>
                <KeyRound className="mr-2 h-4 w-4" />
                With answer key
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="space-y-4 p-4 md:p-8">

        {/* Only when something needs fixing. A clean paper shows nothing here;
            the full paper is behind the header's "Review paper" button. */}
        {validation.all.length > 0 && (
          <section className="surface-card frosted-shadow rounded-card space-y-3 p-4 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="eyebrow">Paper check</p>
              <span className="text-xs text-ink-600">
                {validation.blocking.length} blocking · {validation.warnings.length} warning
                {validation.warnings.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="space-y-2" aria-label="Issues found in this paper">
              {validation.all.map((issue) => (
                <li
                  key={issue.id}
                  className="flex items-start justify-between gap-2 rounded-lg border border-border p-3"
                >
                  <div className="flex items-start gap-2 text-sm">
                    {issue.severity === "blocking" ? (
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-label="Blocks publishing" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" aria-label="Warning" />
                    )}
                    <span className="text-ink-900">{issue.message}</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 gap-1"
                    onClick={() => jumpToIssue(issue)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Fix
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Desktop 2-column grid for settings */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Proctoring */}
          {formData.metadata.examMode === "online" && (
            <section className="rounded-xl border border-border bg-card p-4 space-y-3 md:p-5 md:shadow-sm">
              <div className="text-sm font-semibold md:text-base">Proctoring</div>
              <ProctoringToggle
                label="Webcam monitoring"
                description="Snapshot students every 30s during the exam."
                checked={proctoring.webcam}
                onChange={(v) => setProctoring({ webcam: v })}
              />
              <ProctoringToggle
                label="Lock on tab switch"
                description="Warn and flag the attempt on tab switches."
                checked={proctoring.tabSwitchLock}
                onChange={(v) => setProctoring({ tabSwitchLock: v })}
              />
              <ProctoringToggle
                label="Fullscreen only"
                description="Require fullscreen for the entire attempt."
                checked={proctoring.fullscreenLock}
                onChange={(v) => setProctoring({ fullscreenLock: v })}
              />
              <ProctoringToggle
                label="Disable copy / paste"
                description="Block clipboard operations on the attempt page."
                checked={proctoring.copyPasteDisable}
                onChange={(v) => setProctoring({ copyPasteDisable: v })}
              />
            </section>
          )}

          {/* Result visibility */}
          <section className="rounded-xl border border-border bg-card p-4 space-y-3 md:p-5 md:shadow-sm">
            <div className="text-sm font-semibold md:text-base">Result visibility</div>
            <RadioGroup
              value={resultVisibility}
              onValueChange={(v) =>
                updateMetadata({ resultVisibility: v as ResultVisibility })
              }
              className="space-y-2"
            >
              {!isHybridMode && (
                <RadioOption
                  value="immediate"
                  title="Immediately after submission"
                  description="Score appears as soon as the attempt is graded."
                />
              )}
              <RadioOption
                value="after_teacher_releases"
                title="After teacher releases"
                description="Results stay hidden until you explicitly publish them."
              />
              <RadioOption
                value="hidden"
                title="Hidden from students"
                description="Internal record only; students never see marks."
              />
            </RadioGroup>
            {isHybridMode && (
              <p className="text-[11px] text-muted-foreground">
                Hybrid exams are marked by hand, so results can't be shown instantly.
              </p>
            )}
          </section>
        </div>

        {/* Pass marks + Save as template — side by side on desktop */}
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-border bg-card p-4 space-y-3 md:p-5 md:shadow-sm">
            <div className="text-sm font-semibold md:text-base">Scoring</div>
            <div>
              <Label className="mb-1 block">Pass percentage</Label>
              <div className="relative">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  className="min-h-[44px] pr-10"
                  value={
                    formData.metadata.passMarks != null && totalMarks > 0
                      ? Number(
                          ((formData.metadata.passMarks / totalMarks) * 100).toFixed(2)
                        )
                      : ""
                  }
                  onChange={(e) => {
                    const pct = e.target.value ? Number(e.target.value) : null;
                    updateMetadata({
                      passMarks:
                        pct != null && totalMarks > 0
                          ? (totalMarks * pct) / 100
                          : null,
                    });
                  }}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                  %
                </span>
              </div>
            </div>
          </section>

          {/* Save as template */}
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              className="min-h-[48px] w-full gap-2 md:min-h-[52px]"
              onClick={() => setTemplateOpen(true)}
            >
              <SaveIcon className="h-4 w-4" /> Save as template
            </Button>
          </div>
        </div>
      </div>

      <StickyBottomCTA
        label={
          isPublishing ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Publishing…
            </span>
          ) : (
            "Publish exam"
          )
        }
        disabled={isPublishing || isSavingDraft || validation.blocking.length > 0}
        helperText={
          validation.blocking.length > 0
            ? `Fix ${validation.blocking.length} issue${validation.blocking.length === 1 ? "" : "s"} listed above before publishing.`
            : undefined
        }
        onClick={handlePublishClick}
        secondary={
          isSavingDraft ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </span>
          ) : (
            "Save draft"
          )
        }
        onSecondaryClick={onSaveDraft}
      />

      {/* Schedule & publish sheet: exam date, timing and late entry, collected
          right before publish, next to the times already booked for the
          selected sections so an overlapping slot can't be picked by accident.
          desktopWidth="md" puts it on the surface-card token (the default
          bottom sheet is literal white and unreadable in dark mode). */}
      <MobileSheet
        open={scheduleOpen}
        onOpenChange={(next) => {
          if (!isPublishing && !checkingSlot) setScheduleOpen(next);
        }}
        icon={<CalendarClock className="h-4 w-4" />}
        title={isOfflineMode ? "Publish offline exam" : "Schedule & publish"}
        subtitle={[className, subjectName].filter(Boolean).join(" · ") || undefined}
        desktopWidth="md"
        primaryAction={{
          label: "Publish exam",
          onClick: () => void handleConfirmPublish(),
          loading: isPublishing || checkingSlot,
          disabled:
            isPublishing ||
            checkingSlot ||
            !scheduleValid ||
            hasSlotClash ||
            (slotPlan.checksTime && slotPlan.isLoading),
        }}
        secondaryAction={{
          label: "Cancel",
          onClick: () => setScheduleOpen(false),
          disabled: isPublishing || checkingSlot,
        }}
      >
        <ExamSchedulePlanner
          plan={slotPlan}
          isOfflineExam={isOfflineMode}
          examMode={formData.metadata.examMode}
          disabled={isPublishing || checkingSlot}
          startTime={formData.metadata.startTime}
          durationMinutes={formData.metadata.durationMinutes ?? 60}
          lateEntryMinutes={lateEntryMinutes}
          onDateChange={handleDateChange}
          onStartTimeChange={handleStartTimeChange}
          onDurationChange={handleDurationChange}
          onLateEntryChange={handleLateEntryChange}
          serverClashMessage={serverClashMessage}
        />
      </MobileSheet>

      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="mb-1 block">Template name</Label>
              <Input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                className="min-h-[44px]"
              />
            </div>
            <div>
              <Label className="mb-1 block">Description</Label>
              <Textarea
                rows={2}
                value={templateDesc}
                onChange={(e) => setTemplateDesc(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="pr-2">
                <div className="text-sm font-medium">Share within school</div>
                <div className="text-xs text-muted-foreground">
                  Other teachers will see this template.
                </div>
              </div>
              <Switch
                checked={templateShared}
                onCheckedChange={setTemplateShared}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTemplateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={savingTemplate}
              onClick={handleSaveTemplate}
            >
              {savingTemplate ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Save template"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Full paper, on demand. Same renderer as print, so what the teacher
          checks here is exactly what the printer and the PDF produce. */}
      {/* Dialog rather than MobileSheet: the paper is an 800px A4-style page,
          which a bottom sheet cannot show. Same choice as ExamPreviewDialog.
          No max-h / overflow / flex on DialogContent or DialogHeader: the
          project's DialogContent fork already scrolls its children
          (ui-invariants skill). */}
      <Dialog open={paperOpen} onOpenChange={setPaperOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader className="text-left">
            <DialogTitle>{formData.metadata.title || "Exam paper"}</DialogTitle>
            <p className="text-xs text-ink-600">
              Every question and diagram as it will print. The answer key is visible only to you.
            </p>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm text-ink-900">
            <Switch
              checked={showAnswerKey}
              onCheckedChange={setShowAnswerKey}
              aria-label="Show answer key"
            />
            Show answer key
          </label>
          <div className="overflow-x-auto rounded-md border border-border">
            <ExamPaperDocument
              data={paperData}
              isOffline={isOfflineMode}
              showStudentDetailsBox={isOfflineMode}
              showAnswerKey={showAnswerKey}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPaperOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnimatedContainer>
  );
}

function ProctoringToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border p-3">
      <div className="pr-2">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function RadioOption({
  value,
  title,
  description,
}: {
  value: string;
  title: string;
  description: string;
}) {
  return (
    <label
      htmlFor={`rv-${value}`}
      className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:border-primary/40"
    >
      <RadioGroupItem id={`rv-${value}`} value={value} className="mt-0.5" />
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </label>
  );
}
