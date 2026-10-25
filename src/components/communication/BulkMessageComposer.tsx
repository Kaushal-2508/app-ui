import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, Users, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MobileTabs } from "@/components/shared/nav";
import { MobileSheet } from "@/components/shared/sheets";
import {
  useMessageRecipients,
  useNoticeTargetOptions,
  useSendDirectMessages,
  type MessageRecipient,
  type RecipientRole,
} from "@/hooks/notices";

interface BulkMessageComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string;
  /** A teacher may only message their own students, so the role tabs collapse. */
  isTeacherOnly: boolean;
}

const ROLE_TABS: { value: RecipientRole; label: string }[] = [
  { value: "student", label: "Students" },
  { value: "teacher", label: "Teachers" },
  { value: "coordinator", label: "Coordinators" },
];

const ANY_CLASS = "__any__";

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/**
 * Write one message to several people.
 *
 * Sending fans out into SEPARATE direct conversations — one per person, reusing
 * the existing thread where there is one. Nobody is put in a room with the
 * other recipients, and each reply comes back privately.
 *
 * There is deliberately no scope/wing/class audience here. That is the Notice
 * Board's model, and duplicating it made this form a second notice composer;
 * a message is addressed to people, so the author picks people.
 */
export function BulkMessageComposer({
  open,
  onOpenChange,
  isTeacherOnly,
}: BulkMessageComposerProps) {
  const send = useSendDirectMessages();

  const [batchId, setBatchId] = useState(() => crypto.randomUUID());
  const [body, setBody] = useState("");
  const [role, setRole] = useState<RecipientRole>("student");
  const [search, setSearch] = useState("");
  const [classId, setClassId] = useState<string>(ANY_CLASS);
  /** Keeps names for the chips, so a removed person stays labelled even after
   *  the list they came from has been filtered away. */
  const [selected, setSelected] = useState<Record<string, string>>({});

  const debouncedSearch = useDebounced(search);
  const options = useNoticeTargetOptions(open);

  const recipients = useMessageRecipients(
    role,
    debouncedSearch,
    role === "student" && classId !== ANY_CLASS ? classId : null,
    open,
  );

  const rows = useMemo(
    () => recipients.data?.pages.flatMap((p) => p.rows) ?? [],
    [recipients.data],
  );

  const selectedIds = useMemo(() => Object.keys(selected), [selected]);

  const reset = () => {
    setBatchId(crypto.randomUUID());
    setBody("");
    setRole("student");
    setSearch("");
    setClassId(ANY_CLASS);
    setSelected({});
  };

  const toggle = (person: MessageRecipient) =>
    setSelected((prev) => {
      const next = { ...prev };
      if (next[person.user_id]) delete next[person.user_id];
      else next[person.user_id] = person.full_name ?? "Unnamed";
      return next;
    });

  const selectAllShown = () =>
    setSelected((prev) => {
      const next = { ...prev };
      for (const r of rows) next[r.user_id] = r.full_name ?? "Unnamed";
      return next;
    });

  const canSend =
    body.trim().length > 0 && selectedIds.length > 0 && !send.isPending;

  const handleSend = () => {
    if (!canSend) return;
    send.mutate(
      { batchId, recipientIds: selectedIds, body: body.trim() },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      },
    );
  };

  const isDirty = body.trim().length > 0 || selectedIds.length > 0;

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New message"
      subtitle="Each person gets their own private conversation"
      primaryAction={{
        label:
          selectedIds.length > 0 ? `Send to ${selectedIds.length}` : "Send",
        onClick: handleSend,
        loading: send.isPending,
        disabled: !canSend,
      }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false) }}
    >
      {/* data-dirty suppresses the service-worker auto-reload so an update
          cannot discard a half-written message (CLAUDE.md section 17). */}
      <form className="space-y-4" data-dirty={isDirty ? "true" : undefined}>
        <div className="space-y-2">
          <Label htmlFor="dm-body">Message</Label>
          <Textarea
            id="dm-body"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type your message…"
          />
        </div>

        <div className="space-y-3 border-t border-surface-stroke pt-4">
          <div className="flex items-center justify-between gap-2">
            <Label className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-ink-500" aria-hidden />
              Send to
            </Label>
            {selectedIds.length > 0 && (
              <button
                type="button"
                onClick={() => setSelected({})}
                className="text-xs text-brand-primary hover:underline"
              >
                Clear {selectedIds.length}
              </button>
            )}
          </div>

          {selectedIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedIds.map((id) => (
                <Badge key={id} variant="secondary" className="gap-1 pr-1">
                  {selected[id]}
                  <button
                    type="button"
                    aria-label={`Remove ${selected[id]}`}
                    onClick={() =>
                      setSelected((prev) => {
                        const next = { ...prev };
                        delete next[id];
                        return next;
                      })
                    }
                    className="rounded-full p-0.5 text-ink-500 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {!isTeacherOnly && (
            <MobileTabs
              value={role}
              onValueChange={(v) => {
                setRole(v as RecipientRole);
                setSearch("");
                setClassId(ANY_CLASS);
              }}
              options={ROLE_TABS}
              density="compact"
              variant="segmented"
            />
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${role === "coordinator" ? "coordinator" : role}…`}
                className="pl-9"
              />
            </div>
            {role === "student" && (options.data?.classes.length ?? 0) > 0 && (
              <Select value={classId} onValueChange={setClassId}>
                <SelectTrigger className="sm:w-52">
                  <SelectValue placeholder="Any class" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_CLASS}>Any class</SelectItem>
                  {options.data?.classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-surface-stroke p-2">
            {recipients.isLoading ? (
              <p className="flex items-center gap-2 px-2 py-2 text-sm text-ink-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </p>
            ) : recipients.isError ? (
              <p className="px-2 py-2 text-sm text-ink-600">
                Couldn't load people. Try again in a moment.
              </p>
            ) : rows.length === 0 ? (
              <p className="px-2 py-2 text-sm text-ink-500">
                {search ? "Nobody matches that search." : "Nobody to show here."}
              </p>
            ) : (
              rows.map((r) => (
                <label
                  key={r.user_id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-stroke/40"
                >
                  <Checkbox
                    checked={Boolean(selected[r.user_id])}
                    onCheckedChange={() => toggle(r)}
                  />
                  <span className="min-w-0 flex-1 text-sm text-ink-800">
                    <span className="truncate">{r.full_name ?? "Unnamed"}</span>
                    {r.detail && (
                      <span className="text-ink-500"> · {r.detail}</span>
                    )}
                  </span>
                </label>
              ))
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            {rows.length > 0 ? (
              <button
                type="button"
                onClick={selectAllShown}
                className="text-xs text-brand-primary hover:underline"
              >
                Select all {rows.length} shown
              </button>
            ) : (
              <span />
            )}
            {recipients.hasNextPage && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={recipients.isFetchingNextPage}
                onClick={() => recipients.fetchNextPage()}
              >
                {recipients.isFetchingNextPage ? "Loading…" : "Show more"}
              </Button>
            )}
          </div>
        </div>
      </form>
    </MobileSheet>
  );
}
