import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2, Paperclip, Send, Users, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MobileSheet } from "@/components/shared/sheets";
import { toastError } from "@/lib/toast";
import {
  formatFileSize,
  removeNoticeAttachments,
  uploadNoticeAttachment,
} from "@/lib/noticeAttachments";
import {
  useNoticeAudiencePreview,
  usePublishNotice,
  type NoticeAttachment,
  type NoticePriority,
  type NoticeType,
  type RecipientRole,
} from "@/hooks/notices";

import { NoticeAudienceFields, type AudienceState } from "./NoticeAudienceFields";

interface NoticeComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isTeacherOnly: boolean;
  canSendInstitutionWide: boolean;
  canSendWingWide: boolean;
}

const TYPES: { value: NoticeType; label: string }[] = [
  { value: "general", label: "General" },
  { value: "academic", label: "Academic" },
  { value: "event", label: "Event" },
  { value: "ptm", label: "PTM" },
];

const PRIORITIES: { value: NoticePriority; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "important", label: "Important" },
  { value: "urgent", label: "Urgent" },
];

const ROLE_NOUN: Record<string, [string, string]> = {
  coordinator: ["coordinator", "coordinators"],
  teacher: ["teacher", "teachers"],
  student: ["student", "students"],
};

function initialAudience(
  isTeacherOnly: boolean,
  canSendInstitutionWide: boolean,
): AudienceState {
  return {
    scope: isTeacherOnly || !canSendInstitutionWide ? "class" : "institution",
    classIds: [],
    wingIds: [],
    audienceRoles: isTeacherOnly ? ["student"] : ["student"],
    teacherIds: [],
    allTeachers: true,
  };
}

/** Debounces a value so the live audience preview does not fire per keystroke
 *  or per checkbox tick. */
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function NoticeComposer({
  open,
  onOpenChange,
  isTeacherOnly,
  canSendInstitutionWide,
  canSendWingWide,
}: NoticeComposerProps) {
  const publish = usePublishNotice();

  // Generated up front so attachments can upload to {notice_id}/... before the
  // row exists -- which is also what makes publish_notice idempotent.
  const [noticeId, setNoticeId] = useState(() => crypto.randomUUID());

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState<NoticeType>("general");
  const [priority, setPriority] = useState<NoticePriority>("normal");
  const [requiresAck, setRequiresAck] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [audience, setAudience] = useState<AudienceState>(() =>
    initialAudience(isTeacherOnly, canSendInstitutionWide),
  );
  const [attachments, setAttachments] = useState<NoticeAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setNoticeId(crypto.randomUUID());
    setTitle("");
    setContent("");
    setType("general");
    setPriority("normal");
    setRequiresAck(false);
    setExpiresAt("");
    setAudience(initialAudience(isTeacherOnly, canSendInstitutionWide));
    setAttachments([]);
  };

  /** Class scope carries its own audience list. A teacher reaches students
   *  only; for anyone else, teachers are included when "All teachers" is on or
   *  at least one is ticked -- so choosing "specific" and ticking nobody means
   *  no teachers, rather than silently meaning all of them. */
  const classAudienceRoles = useMemo<RecipientRole[]>(() => {
    if (isTeacherOnly) return ["student"];
    const includeTeachers =
      audience.allTeachers || audience.teacherIds.length > 0;
    return includeTeachers ? ["student", "teacher"] : ["student"];
  }, [isTeacherOnly, audience.allTeachers, audience.teacherIds]);

  const previewArgs = useMemo(
    () => ({
      scope: audience.scope,
      classIds: audience.classIds,
      wingIds: audience.wingIds,
      audienceRoles:
        audience.scope === "class" ? classAudienceRoles : audience.audienceRoles,
      teacherIds: audience.allTeachers ? undefined : audience.teacherIds,
    }),
    [audience, classAudienceRoles],
  );
  const debouncedArgs = useDebounced(previewArgs);

  const audienceChosen =
    (audience.scope === "class" && audience.classIds.length > 0) ||
    (audience.scope === "wing" &&
      audience.wingIds.length > 0 &&
      audience.audienceRoles.length > 0) ||
    (audience.scope === "institution" && audience.audienceRoles.length > 0);

  const preview = useNoticeAudiencePreview(debouncedArgs, open && audienceChosen);

  const previewText = useMemo(() => {
    if (!preview.data) return null;
    const parts = Object.entries(preview.data)
      .filter(([, n]) => n > 0)
      .map(([role, n]) => {
        const [one, many] = ROLE_NOUN[role] ?? [role, role];
        return `${n} ${n === 1 ? one : many}`;
      });
    return parts.length > 0 ? parts.join(", ") : null;
  }, [preview.data]);

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(
        files.map((f) => uploadNoticeAttachment(noticeId, f)),
      );
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (err) {
      toastError(err, {
        fallback: "Couldn't upload that file.",
        context: "uploadNoticeAttachment",
      });
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (index: number) => {
    const target = attachments[index];
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    if (target?.path) void removeNoticeAttachments([target.path]);
  };

  const canPublish =
    title.trim().length > 0 &&
    content.trim().length > 0 &&
    audienceChosen &&
    !publish.isPending &&
    !uploading;

  const handlePublish = () => {
    if (!canPublish) return;
    publish.mutate(
      {
        noticeId,
        title: title.trim(),
        content: content.trim(),
        type,
        priority,
        scope: audience.scope,
        classIds: audience.scope === "class" ? audience.classIds : undefined,
        wingIds: audience.scope === "wing" ? audience.wingIds : undefined,
        audienceRoles:
          audience.scope === "class" ? classAudienceRoles : audience.audienceRoles,
        teacherIds:
          audience.scope === "class" && !audience.allTeachers
            ? audience.teacherIds
            : undefined,
        requiresAcknowledgement: requiresAck,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        attachments,
      },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      },
    );
  };

  const isDirty =
    title.trim().length > 0 || content.trim().length > 0 || attachments.length > 0;

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      desktopWidth="lg"
      icon={<Send className="h-4 w-4" />}
      title="New notice"
      subtitle="Everyone you pick sees it on their Notice Board"
      primaryAction={{
        label: "Publish",
        onClick: handlePublish,
        loading: publish.isPending,
        disabled: !canPublish,
      }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false) }}
    >
      {/* data-dirty suppresses the service-worker auto-reload so an update
          cannot discard a half-written notice (CLAUDE.md section 17). */}
      <form className="space-y-6" data-dirty={isDirty ? "true" : undefined}>
        {/* ---- 1. Message ---- */}
        <section className="space-y-4" aria-labelledby="notice-section-message">
          <p id="notice-section-message" className="eyebrow">
            Message
          </p>

          <div className="space-y-2">
            <Label htmlFor="notice-title">Title</Label>
            <Input
              id="notice-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Half-yearly exam datesheet"
              maxLength={160}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="notice-content">Message</Label>
              <span className="text-[11px] tabular-nums text-ink-500">
                {content.length.toLocaleString()} characters
              </span>
            </div>
            <Textarea
              id="notice-content"
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write the notice. Recipients see it exactly as typed, line breaks included."
              className="min-h-[140px] resize-y"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as NoticeType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as NoticePriority)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        {/* ---- 2. Audience ---- */}
        <section
          className="space-y-4 border-t border-surface-stroke pt-5"
          aria-labelledby="notice-section-audience"
        >
          <p id="notice-section-audience" className="eyebrow">
            Audience
          </p>

          <NoticeAudienceFields
            value={audience}
            onChange={setAudience}
            isTeacherOnly={isTeacherOnly}
            canSendInstitutionWide={canSendInstitutionWide}
            canSendWingWide={canSendWingWide}
          />

          {audienceChosen && (
            <div className="flex items-center gap-2.5 rounded-xl bg-brand-primary/5 px-4 py-3 text-sm">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10 text-brand-primary">
                <Users className="h-4 w-4" aria-hidden />
              </span>
              {preview.isLoading ? (
                <span className="text-ink-600">Counting who this reaches…</span>
              ) : preview.isError ? (
                <span className="text-ink-600">
                  Couldn't preview the audience. Publishing still works.
                </span>
              ) : previewText ? (
                <span className="text-ink-800">
                  Reaches <span className="font-semibold text-ink-900">{previewText}</span>
                </span>
              ) : (
                <span className="text-ink-600">Nobody matches this selection yet.</span>
              )}
            </div>
          )}
        </section>

        {/* ---- 3. Options ---- */}
        <section
          className="space-y-4 border-t border-surface-stroke pt-5"
          aria-labelledby="notice-section-options"
        >
          <p id="notice-section-options" className="eyebrow">
            Options
          </p>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-surface-stroke px-4 py-3">
            <div className="min-w-0">
              <Label htmlFor="notice-ack" className="cursor-pointer">
                Require acknowledgement
              </Label>
              <p className="mt-0.5 text-xs text-ink-500">
                Recipients get an "I have read this" button, and you see who pressed it.
              </p>
            </div>
            <Switch
              id="notice-ack"
              checked={requiresAck}
              onCheckedChange={setRequiresAck}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="notice-expiry">Valid until (optional)</Label>
              <Input
                id="notice-expiry"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
              <p className="text-xs text-ink-500">
                After this date the notice leaves everyone's board.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Attachments</Label>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFiles}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="h-auto w-full justify-start gap-3 rounded-xl border-dashed border-surface-stroke px-4 py-3 text-left font-normal text-ink-700 hover:bg-surface-stroke/40"
              >
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10 text-brand-primary">
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Paperclip className="h-4 w-4" aria-hidden />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink-900">
                    {uploading ? "Uploading…" : "Attach files"}
                  </span>
                  <span className="block text-xs text-ink-500">
                    PDFs, images and documents
                  </span>
                </span>
              </Button>
            </div>
          </div>

          {attachments.length > 0 && (
            <ul className="divide-y divide-surface-stroke overflow-hidden rounded-xl border border-surface-stroke">
              {attachments.map((a, i) => (
                <li
                  key={a.path ?? i}
                  className="flex items-center gap-3 px-3 py-2 text-sm"
                >
                  <FileText className="h-4 w-4 shrink-0 text-ink-500" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-ink-800">{a.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-500">
                    {formatFileSize(a.size)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeAttachment(i)}
                    aria-label={`Remove ${a.name}`}
                    className="h-7 w-7 shrink-0 rounded-full text-ink-500 hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </form>
    </MobileSheet>
  );
}
