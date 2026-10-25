import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { format } from "date-fns";
import { AlertTriangle, ArrowLeft, Download, ExternalLink, FileText, RefreshCw, UserX } from "lucide-react";

import { PageShell } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/surfaces";
import { MobileTabs } from "@/components/shared/nav";
import { TONES } from "@/components/shared/design-system";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchDuaExport,
  getDuaFileUrl,
  useDuaDetail,
  type DuaDetail,
  type DuaHeader,
} from "@/hooks/deletedUsers/useDeletedUsers";
import { ArchivedTableSection, KeptLinkSection } from "@/components/deletedUsers/ArchivedTableSection";
import {
  CATEGORY_ORDER,
  ENTRY_META,
  deletedWhen,
  formatBytes,
  formatValue,
  humanize,
  initials,
  roleLabel,
  sourceLabel,
} from "@/components/deletedUsers/duaModel";
import { buildDeletedUserWorkbook } from "@/lib/deletedUserExport";
import { openExternal, saveBlob } from "@/lib/native";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

const numberFormat = new Intl.NumberFormat("en-IN");
type Tab = "overview" | "records" | "kept" | "files" | "evidence";

const when = (iso: string | null | undefined) => (iso ? format(new Date(iso), "d MMM yyyy, HH:mm") : "N/A");

export default function DeletedUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const detail = useDuaDetail(id);
  const [tab, setTab] = useState<Tab>("overview");
  const [exporting, setExporting] = useState(false);

  const d = detail.data;
  const recordCount = useMemo(() => (d?.tables ?? []).reduce((n, t) => n + t.row_count, 0), [d]);
  const keptCount = useMemo(() => (d?.links ?? []).reduce((n, l) => n + l.row_count, 0), [d]);
  const evidenceCount = (d?.audit_rows.length ?? 0) + (d?.log_events.length ?? 0) + (d?.class_assignment_deletions.length ?? 0) + (d?.traces.length ?? 0);

  const download = async () => {
    if (!id || exporting) return;
    setExporting(true);
    try {
      const data = await fetchDuaExport(id);
      const blob = await buildDeletedUserWorkbook(data);
      const name = (d?.header.full_name ?? "deleted-user").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      saveBlob(blob, `${name}-archive.xlsx`);
    } catch (err) {
      toastError(err, { fallback: "Couldn't build the Excel file.", context: "deletedUserExport" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <PageShell>
      <Link to="/admin/deleted-users" className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-600 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Deleted Users
      </Link>

      {detail.error && !d ? (
        <div className="surface-card frosted-shadow rounded-card">
          <EmptyState
            icon={<AlertTriangle className="h-7 w-7" />}
            tone="rose"
            reason="error"
            title="Couldn't open this entry"
            description="Try again. If it keeps failing, the archive may be closed to this account."
            action={{ label: "Retry", icon: <RefreshCw className="h-4 w-4" />, onClick: () => void detail.refetch() }}
          />
        </div>
      ) : !d ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-card" />
          <Skeleton className="h-64 w-full rounded-card" />
        </div>
      ) : (
        <>
          <Header header={d.header} exporting={exporting} onDownload={() => void download()} />

          <div className="mt-4">
            <MobileTabs
              value={tab}
              onValueChange={(v) => setTab(v as Tab)}
              options={[
                { value: "overview", label: "Overview" },
                { value: "records", label: "Records", count: recordCount },
                { value: "kept", label: "Kept with school", count: keptCount },
                { value: "files", label: "Files", count: d.file_count },
                { value: "evidence", label: "Evidence", count: evidenceCount },
              ]}
            />
          </div>

          <div className="mt-3">
            {tab === "overview" && <Overview detail={d} />}
            {tab === "records" && <Records detail={d} />}
            {tab === "kept" && <Kept detail={d} />}
            {tab === "files" && <Files detail={d} />}
            {tab === "evidence" && <Evidence detail={d} />}
          </div>
        </>
      )}
    </PageShell>
  );
}

function Badge({ label, tone }: { label: string; tone: keyof typeof TONES }) {
  const t = TONES[tone];
  return <span className={cn("inline-flex h-6 items-center rounded-full px-2 text-[11px] font-semibold", t.bg, t.fg)}>{label}</span>;
}

function Header({ header, exporting, onDownload }: { header: DuaHeader; exporting: boolean; onDownload: () => void }) {
  const entry = ENTRY_META[header.entry];
  const name = header.full_name ?? (header.entry === "on_request" ? "Deleted at their request" : "Name not recorded");
  return (
    <div className="surface-card frosted-shadow rounded-card p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ink-400/10 text-lg font-semibold text-ink-700">
          {initials(header.full_name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-bold text-ink-900 sm:text-[26px]">{name}</h1>
            <Badge label={entry.label} tone={entry.tone} />
            {header.live_again_user_id && <Badge label="Live again" tone="mint" />}
            {header.is_test_account && <Badge label="Test account" tone="sky" />}
          </div>
          {header.email && <p className="break-all text-[14px] text-ink-600">{header.email}</p>}
          <p className="mt-1 text-[13px] text-ink-500">
            {deletedWhen(header)}
            {header.deleted_by_name ? ` · by ${header.deleted_by_name}` : ""} · {sourceLabel(header.source)}
          </p>
        </div>
        <Button variant="outline" onClick={onDownload} disabled={exporting} className="h-10 w-full rounded-lg sm:w-auto">
          <Download className="mr-2 h-4 w-4" aria-hidden />
          {exporting ? "Preparing…" : "Download Excel"}
        </Button>
      </div>
    </div>
  );
}

function Fact({ label, value, source }: { label: string; value: React.ReactNode; source?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-[0.05em] text-ink-500">{label}</dt>
      <dd className="break-words text-[14px] text-ink-900">{value}</dd>
      {source && <dd className="text-[11px] text-ink-400">{source}</dd>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="surface-card frosted-shadow rounded-card p-4 sm:p-6">
      <h2 className="mb-3 text-[15px] font-semibold text-ink-900">{title}</h2>
      {children}
    </section>
  );
}

function Overview({ detail }: { detail: DuaDetail }) {
  const h = detail.header;
  const src = h.field_sources ?? {};
  const mismatches = h.completeness?.mismatches ?? [];
  const expected = h.completeness?.expected ?? [];
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title="Identity">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact label="Name" value={h.full_name ?? "N/A"} source={src.full_name} />
          <Fact label="Email" value={h.email ?? "N/A"} source={src.email} />
          <Fact label="Phone" value={h.phone ?? "N/A"} />
          <Fact label="Admission number" value={h.admission_number ?? "N/A"} source={src.admission_number} />
          <Fact label="Roll number" value={h.roll_number ?? "N/A"} />
          <Fact label="School" value={h.institution_name ?? "N/A"} source={src.institution} />
        </dl>
      </Card>

      <Card title="Timeline">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact label="Account created" value={when(h.account_created_at)} source={src.account_created_at} />
          <Fact label="Last sign-in" value={when(h.last_sign_in_at)} />
          <Fact label="Last active" value={when(h.last_active_at)} source={src.last_active_at} />
          <Fact label="Deleted" value={h.deleted_at ? when(h.deleted_at) : deletedWhen(h)} source={src.deleted_at ?? src.deleted_at_range} />
          <Fact label="Deleted by" value={h.deleted_by_name ?? (h.deleted_by ? h.deleted_by : "Not recorded")} source={src.deleted_by} />
          <Fact label="How" value={sourceLabel(h.source)} />
        </dl>
      </Card>

      <Card title="Roles and classes">
        <dl className="grid gap-3">
          <Fact
            label="Roles"
            value={h.roles.length === 0 ? "N/A" : h.roles.map((r) => `${roleLabel(r.role)}${r.institution_name ? `, ${r.institution_name}` : ""}`).join(" · ")}
            source={src.roles}
          />
          <Fact
            label="Classes"
            value={h.class_sections.length === 0 ? "N/A" : h.class_sections.map((c) => [c.name, c.section].filter(Boolean).join(" ")).join(", ")}
            source={src.class_sections}
          />
          {h.wings.length > 0 && <Fact label="Wings" value={h.wings.map((w) => w.name).join(", ")} />}
        </dl>
      </Card>

      <Card title="Completeness">
        {h.entry === "complete" ? (
          <p className="text-[14px] text-ink-700">Every row the delete removed is in this archive.</p>
        ) : h.entry === "on_request" ? (
          <p className="text-[14px] text-ink-700">Deleted at their request. Only this entry is kept, by design.</p>
        ) : h.entry === "capture_failed" ? (
          <p className="break-words text-[14px] text-rose-600">The copy failed: {h.error}</p>
        ) : h.kind === "legacy" ? (
          <p className="text-[14px] text-ink-700">Deleted before the archive existed. The records were removed with the account; these are the facts that survived.</p>
        ) : (
          <div className="space-y-1 text-[14px] text-ink-700">
            <p>Counts did not match for:</p>
            {mismatches.map((m) => (
              <p key={m.table} className="text-[13px] text-rose-600">{humanize(m.table)}: {m.deleted} deleted, {m.archived} archived</p>
            ))}
            {h.completeness?.error && <p className="text-[13px] text-rose-600">{h.completeness.error}</p>}
          </div>
        )}
        {expected.length > 0 && (
          <p className="mt-2 text-[12px] text-ink-500">
            Expected side effects: {expected.map((e) => `${humanize(e.table)} (${e.deleted})`).join(", ")}
          </p>
        )}
        {detail.live_again && (
          <div className="mt-3 rounded-xl border border-surface-stroke p-3 text-[13px]">
            <p className="font-medium text-ink-900">Live again as {detail.live_again.full_name ?? "a new account"}</p>
            <p className="text-ink-600">
              {[detail.live_again.email, detail.live_again.institution_name, detail.live_again.created_at && `created ${when(detail.live_again.created_at)}`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

function Records({ detail }: { detail: DuaDetail }) {
  const groups = useMemo(() => {
    const map = new Map<string, DuaDetail["tables"]>();
    for (const t of detail.tables) map.set(t.category, [...(map.get(t.category) ?? []), t]);
    return [...map.entries()].sort((a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]));
  }, [detail.tables]);

  if (detail.tables.length === 0) {
    return (
      <div className="surface-card frosted-shadow rounded-card">
        <EmptyState
          icon={<UserX className="h-7 w-7" />}
          reason="noData"
          title={detail.header.kind === "legacy" ? "Records were not kept" : "No records"}
          description={detail.header.kind === "legacy" ? "This account was deleted before the archive existed." : undefined}
        />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {groups.map(([category, tables]) => (
        <section key={category} className="surface-card frosted-shadow overflow-hidden rounded-card">
          <h2 className="border-b border-ink-400/20 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-600 sm:px-5">{category}</h2>
          <div className="divide-y divide-ink-400/20">
            {tables.map((t) => <ArchivedTableSection key={t.table} archiveId={detail.header.id} table={t} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function Kept({ detail }: { detail: DuaDetail }) {
  if (detail.links.length === 0) {
    return (
      <div className="surface-card frosted-shadow rounded-card">
        <EmptyState icon={<FileText className="h-7 w-7" />} reason="noData" title="Nothing they created stayed with the school" />
      </div>
    );
  }
  return (
    <section className="surface-card frosted-shadow overflow-hidden rounded-card">
      <div className="divide-y divide-ink-400/20">
        {detail.links.map((l) => <KeptLinkSection key={`${l.table}.${l.column}`} archiveId={detail.header.id} link={l} />)}
      </div>
    </section>
  );
}

function Files({ detail }: { detail: DuaDetail }) {
  const [opening, setOpening] = useState<number | null>(null);
  const open = async (fileId: number) => {
    setOpening(fileId);
    try {
      openExternal(await getDuaFileUrl(detail.header.id, fileId));
    } catch (err) {
      toastError(err, { fallback: "Couldn't open this file.", context: "deletedUserFile" });
    } finally {
      setOpening(null);
    }
  };
  if (detail.files.length === 0) {
    return (
      <div className="surface-card frosted-shadow rounded-card">
        <EmptyState icon={<FileText className="h-7 w-7" />} reason="noData" title="No files" />
      </div>
    );
  }
  return (
    <section className="surface-card frosted-shadow overflow-hidden rounded-card">
      <div className="divide-y divide-ink-400/20">
        {detail.files.map((f) => (
          <div key={f.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <FileText className="h-5 w-5 shrink-0 text-ink-500" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] text-ink-900">{(f.path ?? f.raw_value ?? "").split("/").pop() || "File"}</p>
              <p className="truncate text-[12px] text-ink-500">
                {[f.bucket ?? "Not found in storage", formatBytes(f.size_bytes), humanize(f.source.replace(/^row:/, ""))].join(" · ")}
              </p>
            </div>
            {f.bucket && (
              <Button variant="outline" size="sm" className="h-8 shrink-0 rounded-lg" disabled={opening === f.id} onClick={() => void open(f.id)}>
                <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden />
                {opening === f.id ? "Opening…" : "Open"}
              </Button>
            )}
          </div>
        ))}
      </div>
      {detail.file_count > detail.files.length && (
        <p className="border-t border-ink-400/20 px-4 py-3 text-[12px] text-ink-500 sm:px-5">
          Showing {numberFormat.format(detail.files.length)} of {numberFormat.format(detail.file_count)}. Download Excel for the full list.
        </p>
      )}
    </section>
  );
}

function Evidence({ detail }: { detail: DuaDetail }) {
  const empty =
    detail.audit_rows.length + detail.log_events.length + detail.class_assignment_deletions.length + detail.traces.length === 0;
  if (empty) {
    return (
      <div className="surface-card frosted-shadow rounded-card">
        <EmptyState icon={<FileText className="h-7 w-7" />} reason="noData" title="No other evidence" />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {detail.audit_rows.length > 0 && (
        <Card title="Activity log">
          <ul className="divide-y divide-ink-400/20">
            {detail.audit_rows.map((a, i) => (
              <li key={i} className="py-2 text-[13px]">
                <span className="font-medium text-ink-900">{humanize(a.action)}</span>
                <span className="text-ink-500"> · {when(a.created_at)}</span>
                {a.entity_name && <span className="block text-ink-600">{a.entity_name}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {detail.class_assignment_deletions.length > 0 && (
        <Card title="Class assignments removed">
          <ul className="divide-y divide-ink-400/20">
            {detail.class_assignment_deletions.map((c, i) => (
              <li key={i} className="py-2 text-[13px] text-ink-700">
                {[c.class_name, c.section].filter(Boolean).join(" ") || "Class removed"}
                {c.role && ` · ${roleLabel(c.role)}`}
                <span className="text-ink-500"> · {when(c.deleted_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {detail.log_events.length > 0 && (
        <Card title="Sign-in service log">
          <ul className="divide-y divide-ink-400/20">
            {detail.log_events.map((e, i) => (
              <li key={i} className="py-2 text-[13px] text-ink-700">
                {humanize(e.kind)}
                <span className="text-ink-500"> · {when(e.event_at)}</span>
                {e.email && <span className="block text-ink-500">{e.email}</span>}
              </li>
            ))}
          </ul>
          {detail.sign_in_days > 0 && (
            <p className="mt-2 text-[12px] text-ink-500">Signed in on {numberFormat.format(detail.sign_in_days)} days in the last 90 days of logs.</p>
          )}
        </Card>
      )}
      {detail.traces.length > 0 && (
        <Card title="Other traces">
          <ul className="divide-y divide-ink-400/20">
            {detail.traces.map((t, i) => (
              <li key={i} className="py-2 text-[12px]">
                <span className="font-medium text-ink-900">{humanize(t.source)}</span>
                <span className="block break-words text-ink-500">{formatValue(t.payload)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
