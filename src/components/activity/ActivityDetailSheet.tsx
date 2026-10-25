import { useState } from "react";
import { ArrowRight, ChevronDown, Copy } from "lucide-react";
import { format, formatDistanceToNowStrict } from "date-fns";

import { Button } from "@/components/ui/button";
import { MobileSheet } from "@/components/shared/sheets";
import { TONES } from "@/components/shared/design-system";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { SourceIcon } from "./SourceIcon";
import { StatusChip } from "./ActivityEventRow";
import {
  SOURCE_META,
  actionLabel,
  actionPhrase,
  humanize,
  initials,
  statusTone,
  type ActivityEvent,
  type JsonMap,
} from "./activityModel";

interface ActivityDetailSheetProps {
  event: ActivityEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Render any JSON value as one readable line. */
function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "N/A";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (ISO_DATE.test(value)) {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return format(d, "d MMM yyyy, h:mm a");
    }
    return value;
  }
  return JSON.stringify(value);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="eyebrow">{title}</p>
      {children}
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="shrink-0 text-[13px] text-ink-500">{label}</span>
      <span className={cn("min-w-0 break-words text-right text-[13px] text-ink-900", mono && "font-mono text-[12px]")}>{value}</span>
    </div>
  );
}

function CopyId({ id }: { id: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(id).then(() => toast.success("ID copied"));
      }}
      className="inline-flex max-w-full items-center gap-1 rounded-md bg-ink-400/10 px-1.5 py-0.5 font-mono text-[11px] text-ink-700 transition-colors hover:bg-ink-400/20"
      title={id}
    >
      <span className="truncate">{id.slice(0, 8)}…</span>
      <Copy className="h-3 w-3 shrink-0" aria-hidden />
    </button>
  );
}

/** Before/after table over the union of keys; changed keys are tinted. */
function ChangesTable({ before, after }: { before: JsonMap | null; after: JsonMap | null }) {
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])).sort();
  if (keys.length === 0) return null;
  const twoSided = Boolean(before && after);

  return (
    <div className="overflow-hidden rounded-xl border border-ink-400/50">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-ink-400/5 text-left text-[11px] uppercase tracking-[0.04em] text-ink-500">
            <tr>
              <th className="px-3 py-2 font-medium">Field</th>
              {twoSided ? (
                <>
                  <th className="px-3 py-2 font-medium">Before</th>
                  <th className="px-3 py-2 font-medium">After</th>
                </>
              ) : (
                <th className="px-3 py-2 font-medium">{before ? "Value before" : "Value"}</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-400/30">
            {keys.map((k) => {
              const b = before?.[k];
              const a = after?.[k];
              const changed = twoSided && JSON.stringify(b) !== JSON.stringify(a);
              return (
                <tr key={k} className={cn(changed && "bg-brand-primary/5")}>
                  <td className="px-3 py-2 align-top font-medium text-ink-700">{humanize(k)}</td>
                  {twoSided ? (
                    <>
                      <td className={cn("px-3 py-2 align-top break-words text-ink-600", changed && "line-through decoration-ink-400")}>{formatValue(b)}</td>
                      <td className={cn("px-3 py-2 align-top break-words", changed ? "font-medium text-ink-900" : "text-ink-600")}>{formatValue(a)}</td>
                    </>
                  ) : (
                    <td className="px-3 py-2 align-top break-words text-ink-900">{formatValue(before ? b : a)}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Everything the sources recorded about one event: who, what, when, the
 * status move, the reason, a before/after diff, extra metadata, and the
 * client that made the request. A collapsed raw view at the end shows the
 * exact stored payload for anyone who needs to quote it.
 */
export function ActivityDetailSheet({ event, open, onOpenChange }: ActivityDetailSheetProps) {
  const [rawOpen, setRawOpen] = useState(false);

  if (!event) return null;
  const meta = SOURCE_META[event.source];
  const t = TONES[meta.tone];
  const when = new Date(event.createdAt);
  const extraMeta = Object.entries(event.metadata).filter(([k]) => k !== "institution_id");
  const hasChanges = Boolean(event.before || event.after);

  return (
    <MobileSheet
      open={open}
      onOpenChange={(o) => {
        if (!o) setRawOpen(false);
        onOpenChange(o);
      }}
      placement="center"
      title={actionLabel(event.action)}
      subtitle={`${meta.label} · ${format(when, "d MMM yyyy, h:mm:ss a")}`}
      icon={<SourceIcon source={event.source} className="h-5 w-5" />}
      secondaryAction={{ label: "Close", onClick: () => onOpenChange(false) }}
    >
      <div className="space-y-6 pb-2">
        {/* Headline sentence with the actor monogram, so the sheet opens on the
            same words the row showed and nothing has to be re-found. */}
        <div className="flex items-start gap-3 rounded-xl bg-ink-400/5 p-4">
          <span className={cn("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold", t.bg, t.fg)}>
            {initials(event.actor.name)}
          </span>
          <div className="min-w-0">
            <p className="text-[15px] leading-[22px] text-ink-900">
              <span className="font-semibold">{event.actor.name}</span>{" "}
              <span className="text-ink-600">{actionPhrase(event.action)}</span>{" "}
              <span className="font-semibold">{event.entity.name}</span>
            </p>
            <p className="mt-0.5 text-[12px] text-ink-500">
              {formatDistanceToNowStrict(when, { addSuffix: true })}
            </p>
          </div>
        </div>

        {(event.fromStatus || event.toStatus) && (
          <Section title="Status change">
            <div className="flex items-center gap-2">
              {event.fromStatus ? <StatusChip status={event.fromStatus} /> : <span className="text-[13px] text-ink-500">None</span>}
              <ArrowRight className="h-4 w-4 text-ink-400" aria-hidden />
              {event.toStatus && <StatusChip status={event.toStatus} tone={statusTone(event.toStatus)} />}
            </div>
          </Section>
        )}

        {event.reason && (
          <Section title="Reason">
            <p className="rounded-xl border border-ink-400/50 p-3 text-[14px] italic leading-6 text-ink-700">"{event.reason}"</p>
          </Section>
        )}

        <Section title="Who">
          <div className="divide-y divide-ink-400/30">
            <Row label="Name" value={event.actor.name} />
            {event.actor.email && <Row label="Email" value={event.actor.email} />}
            {event.actor.id && <Row label="User ID" value={<CopyId id={event.actor.id} />} />}
          </div>
        </Section>

        <Section title="What">
          <div className="divide-y divide-ink-400/30">
            <Row label="Action" value={<span className="font-mono text-[12px]">{event.action}</span>} />
            <Row label="Source" value={meta.label} />
            <Row label="Entity type" value={<span className="capitalize">{humanize(event.entity.type)}</span>} />
            <Row label="Entity" value={event.entity.name} />
            {event.entity.id && <Row label="Entity ID" value={<CopyId id={event.entity.id} />} />}
          </div>
        </Section>

        <Section title="When">
          <div className="divide-y divide-ink-400/30">
            <Row label="Date" value={format(when, "EEEE, d MMMM yyyy")} />
            <Row label="Time" value={format(when, "h:mm:ss a")} />
            <Row label="Recorded" value={<span className="font-mono text-[12px]">{event.createdAt}</span>} />
          </div>
        </Section>

        {hasChanges && (
          <Section title={event.before && event.after ? "Changes" : event.before ? "Values before" : "Values recorded"}>
            <ChangesTable before={event.before} after={event.after} />
          </Section>
        )}

        {extraMeta.length > 0 && (
          <Section title="Details">
            <div className="divide-y divide-ink-400/30">
              {extraMeta.map(([k, v]) => (
                <Row key={k} label={humanize(k)} value={formatValue(v)} mono={typeof v === "string" && /^[0-9a-f-]{36}$/.test(v)} />
              ))}
            </div>
          </Section>
        )}

        {(event.ipAddress || event.userAgent) && (
          <Section title="Client">
            <div className="divide-y divide-ink-400/30">
              {event.ipAddress && <Row label="IP address" value={event.ipAddress} mono />}
              {event.userAgent && <Row label="Browser" value={event.userAgent} />}
            </div>
          </Section>
        )}

        <div className="border-t border-ink-400/30 pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRawOpen((v) => !v)}
            className="h-8 px-2 text-[12px] text-ink-600"
          >
            <ChevronDown className={cn("mr-1 h-3.5 w-3.5 transition-transform", rawOpen && "rotate-180")} aria-hidden />
            {rawOpen ? "Hide raw record" : "Show raw record"}
          </Button>
          {rawOpen && (
            <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-ink-400/5 p-3 text-[11px] leading-relaxed text-ink-700">
              {JSON.stringify(
                {
                  id: event.id,
                  source: event.source,
                  action: event.action,
                  created_at: event.createdAt,
                  actor_id: event.actor.id,
                  entity_type: event.entity.type,
                  entity_id: event.entity.id,
                  entity_name: event.entity.name,
                  from_status: event.fromStatus,
                  to_status: event.toStatus,
                  reason: event.reason,
                  old_values: event.before,
                  new_values: event.after,
                  metadata: event.metadata,
                  ip_address: event.ipAddress,
                  user_agent: event.userAgent,
                },
                null,
                2,
              )}
            </pre>
          )}
        </div>
      </div>
    </MobileSheet>
  );
}
