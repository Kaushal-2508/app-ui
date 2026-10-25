import * as React from "react";
import { useLocation } from "react-router-dom";
import { MessageSquareWarning } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { MobileSheet } from "@/components/shared/sheets";
import { useProfileData } from "@/hooks/useProfileData";
import { useUserRole } from "@/hooks/useUserRole";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_URGENCIES,
  useCreateSupportRequest,
} from "@/hooks/useSupportRequest";

/**
 * What a follow-up carries over from the request it came from. There is no
 * column linking one ticket to another, so the ancestry is a sentence in the
 * description, which is what SALCI reads anyway.
 */
export interface SupportRequestPrefill {
  subject: string;
  category: string;
  urgency: string;
  description: string;
}

interface SupportRequestSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Seeds the form each time it opens. Used by "Raise this again". */
  prefill?: SupportRequestPrefill | null;
}

/**
 * Salci Support intake. Mirrors CreateTaskDialog's field grammar (subject =
 * title, category = task type, urgency = priority) because a support request
 * becomes a real task, just one nobody in the reporter's school can see and
 * only SALCI can close.
 *
 * There is no assignee picker: support always routes to the configured support
 * owner. No due date and no supervisor either, since SALCI owns the timeline.
 *
 * Opened from SupportPage (/support) behind "New request", not from the
 * sidebar. The ticket the reporter creates here appears in the list directly
 * behind this sheet the moment it is sent, which is why the success toast
 * points at this page rather than at /tasks.
 */
export function SupportRequestSheet({ open, onOpenChange, prefill }: SupportRequestSheetProps) {
  const location = useLocation();
  const { data: profile } = useProfileData();
  const { data: roleInfo } = useUserRole();
  const createRequest = useCreateSupportRequest();

  const [category, setCategory] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [urgency, setUrgency] = React.useState("2");

  const reset = () => {
    setCategory("");
    setSubject("");
    setDescription("");
    setUrgency("2");
  };

  // Seed the form on each open, so "Raise this again" lands the reporter in a
  // half-written request rather than an empty one. Only the transition into
  // open seeds anything: once the sheet is up the fields are theirs, and a
  // prefill arriving late must not overwrite what they have typed.
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    const justOpened = open && !wasOpen.current;
    wasOpen.current = open;
    if (!justOpened) return;
    setCategory(prefill?.category ?? "");
    setSubject(prefill?.subject ?? "");
    setDescription(prefill?.description ?? "");
    setUrgency(prefill?.urgency ?? "2");
  }, [open, prefill]);

  const canSubmit =
    category !== "" && subject.trim().length > 0 && description.trim().length > 0;

  const handleSubmit = () => {
    // Single flight: the RPC also throttles per caller, but a double tap must
    // not fire twice from here.
    if (!canSubmit || createRequest.isPending) return;

    createRequest.mutate(
      {
        subject: subject.trim(),
        description: description.trim(),
        category,
        priority: Number(urgency),
        pageUrl: location.pathname,
      },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      },
    );
  };

  // Service-worker dirty-form contract: while there is unsaved input, an
  // update must toast rather than silently reload the page.
  const isDirty = subject.trim().length > 0 || description.trim().length > 0;

  // Auto-captured, shown so the reporter can see exactly what is attached.
  // The RPC re-reads all of it server-side; this is display only.
  const context = [
    profile?.full_name,
    roleInfo?.primaryRole?.replace(/_/g, " "),
    profile?.institution?.name,
  ].filter((value): value is string => Boolean(value));

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Salci Support"
      subtitle="Tell us what went wrong and we will pick it up."
      icon={<MessageSquareWarning className="h-4 w-4" />}
      primaryAction={{
        label: "Send to SALCI",
        onClick: handleSubmit,
        loading: createRequest.isPending,
        disabled: !canSubmit,
      }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false) }}
    >
      <form
        data-dirty={isDirty ? "true" : undefined}
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="space-y-4"
      >
        <div className="grid gap-2">
          <Label>What is this about?</Label>
          <SearchableSelect
            value={category}
            onValueChange={setCategory}
            placeholder="Pick a category"
            searchPlaceholder="Search categories..."
            options={SUPPORT_CATEGORIES.map((name) => ({ value: name, label: name }))}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="support-subject">Subject</Label>
          <Input
            id="support-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Attendance not saving for Class 8B"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="support-description">What happened?</Label>
          <Textarea
            id="support-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell us what you were doing and what went wrong."
            rows={5}
          />
        </div>

        <div className="grid gap-2">
          <Label>Urgency</Label>
          <SearchableSelect
            value={urgency}
            onValueChange={setUrgency}
            placeholder="How urgent is it?"
            searchPlaceholder="Search..."
            options={SUPPORT_URGENCIES.map((u) => ({ value: u.value, label: u.label }))}
          />
        </div>

        {context.length > 0 && (
          <div className="rounded-card border border-surface-stroke bg-surface-base/60 p-3">
            <p className="eyebrow">Sent with your request</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {context.map((item) => (
                <span
                  key={item}
                  className="rounded-full bg-ink-400/10 px-2.5 py-1 text-xs capitalize text-ink-600"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}
      </form>
    </MobileSheet>
  );
}