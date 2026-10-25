import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ClipboardList,
  Loader2,
  Lock,
} from "lucide-react";

import { PageShell, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/surfaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { useHomeworkScope } from "@/hooks/useHomeworkScope";
import { useHomeworkForEdit } from "@/hooks/useHomeworkData";
import { useSaveHomework } from "@/hooks/useHomeworkSave";
import { useUpdateHomework } from "@/hooks/useHomeworkUpdate";
import { uploadResumable } from "@/lib/storageUpload";
import { isHomeworkPhoto, prepareHomeworkImage } from "@/lib/homeworkImage";
import { supabase } from "@/integrations/supabase/client";
import { formatClassName, cn } from "@/lib/utils";
import { emptyHomeworkForm, type HomeworkFormData } from "@/types/homework";
import { HomeworkAttachmentField, type AttachmentStage } from "./HomeworkAttachmentField";
import { DateTimeField } from "./DateTimeField";

interface HomeworkCreationFlowProps {
  mode: "create" | "edit";
  homeworkId?: string;
}

/** Mime allowlist mirrors the `homework-files` bucket's allowed_mime_types so
 * the client rejects unsupported files before the upload round-trip (which the
 * bucket would reject anyway). Video/audio/zip/rar/exe are not in this set. */
const ALLOWED_MIME = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "application/rtf",
  "text/rtf",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
]);

/** Block obvious unsupported types by extension too, since some browsers report
 * an empty/generic mime for these. */
const BLOCKED_EXT = /\.(mp4|mov|avi|mkv|webm|mp3|wav|m4a|aac|ogg|zip|rar|7z|exe|msi|dmg)$/i;

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB — matches the bucket.

/** Inline shape for the edit-lock guard's lightweight fetch. */
interface LockProbe {
  status: string;
  visible_from: string;
}

export function HomeworkCreationFlow({ mode, homeworkId }: HomeworkCreationFlowProps) {
  const navigate = useNavigate();
  const { institutionId } = useEffectiveInstitution();

  const [form, setForm] = useState<HomeworkFormData>(() => emptyHomeworkForm(institutionId));
  const [hydrated, setHydrated] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  // Compressing happens on the device before the upload; the two stages are
  // named apart so the button never says "Uploading" while nothing is leaving.
  const [attachmentStage, setAttachmentStage] = useState<AttachmentStage>(null);
  const uploading = attachmentStage !== null;

  const save = useSaveHomework();
  const update = useUpdateHomework();
  const pending = save.isPending || update.isPending || uploading;

  // Seed institutionId into the form once it resolves (create mode mainly;
  // edit mode overwrites this on hydrate with the assignment's own institution).
  useEffect(() => {
    if (!institutionId) return;
    setForm((prev) => (prev.institutionId ? prev : { ...prev, institutionId }));
  }, [institutionId]);

  // ── Edit-lock guard: a lightweight status/visible_from probe (does NOT touch
  // useHomeworkData.ts). If the assignment is published AND already visible to
  // students, edits are locked. ──
  const lock = useQuery({
    queryKey: ["homework", homeworkId, "lock-probe"],
    enabled: mode === "edit" && !!homeworkId,
    staleTime: 30_000,
    queryFn: async (): Promise<LockProbe> => {
      const { data, error } = await supabase
        .from("homework_assignments")
        .select("status, visible_from")
        .eq("id", homeworkId!)
        .single();
      if (error) throw error;
      return { status: data.status, visible_from: data.visible_from };
    },
  });

  const isLocked = useMemo(() => {
    if (mode !== "edit" || !lock.data) return false;
    return lock.data.status !== "draft" && new Date(lock.data.visible_from) <= new Date();
  }, [mode, lock.data]);

  // ── Edit-mode hydrate (only when not locked — the form is hidden if locked). ──
  const loaded = useHomeworkForEdit(mode === "edit" && !isLocked ? homeworkId : undefined);
  useEffect(() => {
    if (mode === "edit" && loaded.data && !hydrated) {
      setForm(loaded.data);
      setHydrated(true);
    }
  }, [mode, loaded.data, hydrated]);

  // ── Role-scoped class + subject options. ──
  const scope = useHomeworkScope(form.classIds);

  // Helper to patch the form and mark dirty.
  const patch = (updates: Partial<HomeworkFormData>) => {
    setForm((prev) => ({ ...prev, ...updates }));
    setDirty(true);
  };

  const toggleClass = (classId: string) => {
    const next = form.classIds.includes(classId)
      ? form.classIds.filter((id) => id !== classId)
      : [...form.classIds, classId];
    patch({ classIds: next });
  };

  const toggleSubject = (subjectId: string) => {
    const next = form.subjectIds.includes(subjectId)
      ? form.subjectIds.filter((id) => id !== subjectId)
      : [...form.subjectIds, subjectId];
    patch({ subjectIds: next });
  };

  const classTriggerLabel = useMemo(() => {
    if (scope.isLoading) return "Loading classes…";
    if (scope.classes.length === 0) return "No classes available";
    if (form.classIds.length === 0) return "Pick one or more classes";
    const picked = scope.classes.filter((c) => form.classIds.includes(c.id));
    const labels = picked.map((c) => formatClassName(c.name, c.section));
    const visible = labels.slice(0, 2).join(", ");
    const more = labels.length > 2 ? ` (+${labels.length - 2})` : "";
    return `${visible}${more}`;
  }, [scope.isLoading, scope.classes, form.classIds]);

  const subjectTriggerLabel = useMemo(() => {
    if (scope.isLoading) return "Loading subjects…";
    if (form.classIds.length === 0) return "Pick a class first";
    if (scope.subjects.length === 0) return "No subjects for this class";
    if (form.subjectIds.length === 0) return "Pick one or more subjects";
    const picked = scope.subjects.filter((s) => form.subjectIds.includes(s.id));
    const labels = picked.map((s) => s.name);
    const visible = labels.slice(0, 2).join(", ");
    const more = labels.length > 2 ? ` (+${labels.length - 2})` : "";
    return `${visible}${more}`;
  }, [scope.isLoading, scope.subjects, form.classIds.length, form.subjectIds]);

  // Prune stale subject selections no longer valid for the chosen classes.
  // Reads `subjectIds` from the functional updater so the effect only depends
  // on the (possibly changed) subject list. Skips pruning while the subject
  // list is still resolving for picked classes (empty list + classes present),
  // so an edit-hydrated selection isn't wrongly cleared before subjects load.
  useEffect(() => {
    if (scope.isLoading) return;
    setForm((prev) => {
      if (prev.subjectIds.length === 0) return prev;
      if (scope.subjects.length === 0 && prev.classIds.length > 0) return prev;
      const valid = new Set(scope.subjects.map((s) => s.id));
      const filtered = prev.subjectIds.filter((id) => valid.has(id));
      if (filtered.length === prev.subjectIds.length) return prev;
      return { ...prev, subjectIds: filtered };
    });
  }, [scope.subjects, scope.isLoading]);

  // ── Attachment upload ──
  const handleFile = async (picked: File | undefined) => {
    setAttachmentError(null);
    if (!picked) return;
    const inst = form.institutionId ?? institutionId;
    if (!inst) {
      setAttachmentError("Institution context isn't ready yet. Try again in a moment.");
      return;
    }

    // Photos (camera or gallery, HEIC included) are compressed on the device
    // BEFORE the size and type checks: a 6 MB phone photo becomes a 1 MB JPEG,
    // and an iPhone HEIC becomes a type the bucket accepts. Documents skip this.
    let file = picked;
    if (isHomeworkPhoto(picked)) {
      setAttachmentStage("compressing");
      try {
        file = await prepareHomeworkImage(picked);
      } catch (err) {
        setAttachmentError(err instanceof Error ? err.message : "Couldn't read that photo.");
        setAttachmentStage(null);
        return;
      }
    }

    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachmentError("File is too large. The limit is 10 MB.");
      setAttachmentStage(null);
      return;
    }
    const mimeOk = file.type ? ALLOWED_MIME.has(file.type) : !BLOCKED_EXT.test(file.name);
    if (!mimeOk || BLOCKED_EXT.test(file.name)) {
      setAttachmentError(
        "That file type isn't supported. Use an image, PDF, or Office/text document (no video, audio, or archives).",
      );
      setAttachmentStage(null);
      return;
    }
    const path = `${inst}/attachments/${crypto.randomUUID()}/${file.name}`;
    setAttachmentStage("uploading");
    try {
      await uploadResumable({
        bucket: "homework-files",
        path,
        file,
        contentType: file.type || "application/octet-stream",
      });
      patch({
        attachmentPath: path,
        attachmentName: file.name,
        attachmentMime: file.type || "application/octet-stream",
      });
    } catch {
      setAttachmentError("Couldn't upload that file. Please try again.");
    } finally {
      setAttachmentStage(null);
    }
  };

  const clearAttachment = () => {
    patch({ attachmentPath: null, attachmentName: null, attachmentMime: null });
    setAttachmentError(null);
  };

  // ── Validation ──
  const validate = (): string | null => {
    if (!form.title.trim()) return "Please enter a title.";
    if (form.subjectIds.length === 0) return "Please pick at least one subject.";
    if (form.classIds.length === 0) return "Pick at least one class.";
    if (form.dueAt <= form.visibleFrom) return "The due date must be after the visible-from date.";
    if (form.carriesMarks && (!form.maxMarks || form.maxMarks <= 0))
      return "Enter the maximum marks (greater than 0) for a graded assignment.";
    return null;
  };

  const submit = (publish: boolean) => {
    const err = validate();
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);

    if (mode === "edit" && homeworkId) {
      update.mutate(
        { homeworkId, formData: form, publish },
        {
          onSuccess: () => {
            if (publish) navigate("/homework");
          },
        },
      );
      return;
    }

    save.mutate(
      { formData: form, publish },
      {
        onSuccess: (result) => {
          if (publish) {
            navigate("/homework");
          } else {
            // Keep the same draft id so subsequent saves upsert instead of
            // creating a second draft.
            setForm((prev) => ({ ...prev, homeworkId: result.homeworkId }));
          }
        },
      },
    );
  };

  // ── Locked: read-only state instead of the form. ──
  if (mode === "edit" && isLocked) {
    return (
      <PageShell>
        <PageHeader
          title="Edit homework"
          subtitle="This assignment can no longer be edited."
        />
        <div className="surface-card frosted-shadow rounded-card">
          <EmptyState
            icon={<Lock className="h-7 w-7" />}
            tone="rose"
            title="This assignment is locked"
            description="It's already visible to students and can no longer be edited."
            action={{ label: "Back to homework", onClick: () => navigate("/homework") }}
          />
        </div>
      </PageShell>
    );
  }

  const subjectDisabled = scope.isLoading || form.classIds.length === 0 || scope.subjects.length === 0;

  return (
    <PageShell>
      <PageHeader
        title={mode === "edit" ? "Edit homework" : "Create homework & assignment"}
        subtitle={
          mode === "edit"
            ? "Update the details, schedule, or attachment."
            : "Set the details, pick who it's for, and schedule when students see it."
        }
        icon={<ClipboardList className="h-6 w-6" />}
      />

      <form
        data-dirty={dirty ? "true" : undefined}
        onSubmit={(e) => e.preventDefault()}
        className="space-y-4 pb-28"
      >
        {/* ── Details ── */}
        <section className="surface-card frosted-shadow rounded-card p-4 sm:p-6 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="hw-title">Title</Label>
            <Input
              id="hw-title"
              value={form.title}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder="Chapter 4: practice problems"
            />
          </div>

          {/* grid-cols-1 is NOT redundant. Without an explicit phone column,
              the single implicit track is sized to max-content, so the
              Class(es) trigger measured 424px inside a 283px card at 375px:
              the selected-class text ran off the screen AND the popover
              inherited that 424px through --radix-popover-trigger-width, so it
              was wider than the phone and got collision-shifted off its own
              anchor. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Class(es) multi-select */}
            <div className="space-y-1.5">
              <Label>Class(es)</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={scope.isLoading || scope.classes.length === 0}
                    className="flex min-h-[44px] w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span
                      className={cn(
                        "truncate",
                        form.classIds.length === 0 ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {classTriggerLabel}
                    </span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0"
                >
                  <div className="max-h-64 overflow-y-auto py-1">
                    {scope.classes.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-muted-foreground">
                        No classes available.
                      </p>
                    ) : (
                      scope.classes.map((c) => (
                        <label
                          key={c.id}
                          className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-muted/40"
                        >
                          <Checkbox
                            checked={form.classIds.includes(c.id)}
                            onCheckedChange={() => toggleClass(c.id)}
                          />
                          <span className="truncate text-sm text-foreground">
                            {formatClassName(c.name, c.section)}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                  {form.classIds.length > 0 && (
                    <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
                      {form.classIds.length} selected
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>

            {/* Subject(s) multi-select */}
            <div className="space-y-1.5">
              <Label>Subject(s)</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={subjectDisabled}
                    className="flex min-h-[44px] w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span
                      className={cn(
                        "truncate",
                        form.subjectIds.length === 0 ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {subjectTriggerLabel}
                    </span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0"
                >
                  <div className="max-h-64 overflow-y-auto py-1">
                    {scope.subjects.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-muted-foreground">
                        {form.classIds.length === 0
                          ? "Pick a class first."
                          : "No subjects for this class."}
                      </p>
                    ) : (
                      scope.subjects.map((s) => (
                        <label
                          key={s.id}
                          className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-muted/40"
                        >
                          <Checkbox
                            checked={form.subjectIds.includes(s.id)}
                            onCheckedChange={() => toggleSubject(s.id)}
                          />
                          <span className="truncate text-sm text-foreground">{s.name}</span>
                        </label>
                      ))
                    )}
                  </div>
                  {form.subjectIds.length > 0 && (
                    <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
                      {form.subjectIds.length} selected
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hw-description">Homework</Label>
            <Textarea
              id="hw-description"
              value={form.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="What should students do? Add the homework and any instructions here."
              rows={4}
            />
          </div>
        </section>

        {/* ── Marks ── */}
        <section className="surface-card frosted-shadow rounded-card p-4 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Label htmlFor="hw-carries-marks">Carries marks</Label>
              <p className="mt-0.5 text-[13px] text-ink-500">
                Turn on to grade this assignment out of a maximum score.
              </p>
            </div>
            <Switch
              id="hw-carries-marks"
              checked={form.carriesMarks}
              onCheckedChange={(v) => patch({ carriesMarks: v })}
            />
          </div>
          {form.carriesMarks && (
            <div className="space-y-4">
              <div className="space-y-1.5 max-w-[200px]">
                <Label htmlFor="hw-max-marks">Maximum marks</Label>
                <Input
                  id="hw-max-marks"
                  type="number"
                  min={1}
                  step={1}
                  value={form.maxMarks ?? ""}
                  onChange={(e) => {
                    const n = Number.parseFloat(e.target.value);
                    patch({ maxMarks: Number.isFinite(n) ? n : null });
                  }}
                  placeholder="e.g. 20"
                />
              </div>
              <div className="flex items-start justify-between gap-3 border-t border-surface-stroke pt-4">
                <div>
                  <Label htmlFor="hw-offline-marks">
                    Assignment submitted offline, ready to assign marks
                  </Label>
                  <p className="mt-0.5 text-[13px] text-ink-500">
                    Students hand this in on paper. Skips online submission. You'll enter each
                    student's marks yourself.
                  </p>
                </div>
                <Switch
                  id="hw-offline-marks"
                  checked={form.offlineMarks}
                  onCheckedChange={(v) => patch({ offlineMarks: v })}
                />
              </div>
            </div>
          )}
        </section>

        {/* ── Schedule ── */}
        <section className="surface-card frosted-shadow rounded-card p-4 sm:p-6 space-y-5">
          <DateTimeField
            label="Visible from"
            helper="When students start seeing this assignment."
            value={form.visibleFrom}
            onChange={(d) => patch({ visibleFrom: d })}
          />
          <DateTimeField
            label="Due at"
            helper="Must be after the visible-from time."
            value={form.dueAt}
            onChange={(d) => patch({ dueAt: d })}
          />
        </section>

        {/* ── Attachment (optional): take a photo or pick a file ── */}
        <HomeworkAttachmentField
          attachmentName={form.attachmentPath && form.attachmentName ? form.attachmentName : null}
          stage={attachmentStage}
          disabled={pending}
          error={attachmentError}
          onPick={(file) => void handleFile(file)}
          onClear={clearAttachment}
        />

        {validationError && (
          <p className="text-sm text-rose-600">{validationError}</p>
        )}
      </form>

      {/* ── Sticky footer ── */}
      <div
        data-sticky-bottom
        className="sticky bottom-0 left-0 right-0 z-20 -mx-4 border-t border-border bg-background/95 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 xl:-mx-14 xl:px-14"
      >
        <div className="mx-auto flex max-w-7xl items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-[48px] flex-1 font-semibold"
            disabled={pending}
            onClick={() => submit(false)}
          >
            {(save.isPending || update.isPending) && !uploading && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Save as draft
          </Button>
          <Button
            type="button"
            className="min-h-[48px] flex-1 bg-brand-primary font-semibold text-white hover:bg-brand-primary/90"
            disabled={pending}
            onClick={() => submit(true)}
          >
            Publish
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
