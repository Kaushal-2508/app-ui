import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, X, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { MILESTONE_KEYS, MILESTONE_LABELS, type MilestoneKey } from "@/lib/onboardingDashboardMath";
import type { InstitutionOnboardingRow } from "@/hooks/useOnboardingJourney";

interface Props {
  rows: InstitutionOnboardingRow[];
}

const TIER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All tiers" },
  { value: "100", label: "100%" },
  { value: "80",  label: "80%" },
  { value: "60",  label: "60%" },
  { value: "40",  label: "40%" },
  { value: "20",  label: "20%" },
  { value: "0",   label: "0%" },
];

function YesNo({ ok }: { ok: boolean }) {
  return ok ? (
    <Check className="h-4 w-4 text-emerald-600" aria-label="Yes" />
  ) : (
    <X className="h-4 w-4 text-rose-500" aria-label="No" />
  );
}

function milestoneOf(row: InstitutionOnboardingRow, key: MilestoneKey): boolean {
  switch (key) {
    case "first_task_assigned": return row.firstTaskAssigned;
    case "first_task_completed": return row.firstTaskCompleted;
    case "first_study_material_uploaded": return row.firstStudyMaterialUploaded;
    case "first_exam_published": return row.firstExamPublished;
    case "first_result_validated": return row.firstResultValidated;
  }
}

export function PerTeacherTable({ rows }: Props) {
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState<string>("all");
  const [missing, setMissing] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const hay = `${r.fullName ?? ""} ${r.email ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (tier !== "all") {
        const tierFloor = Number(tier);
        const pct = Number(r.completionPercent);
        if (tierFloor === 100) {
          if (pct !== 100) return false;
        } else {
          if (pct < tierFloor || pct >= tierFloor + 20) return false;
        }
      }
      if (missing !== "all") {
        if (milestoneOf(r, missing as MilestoneKey)) return false;
      }
      return true;
    });
  }, [rows, search, tier, missing]);

  return (
    <div className="surface-card frosted-shadow rounded-card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="eyebrow">Per-teacher detail</p>
        <p className="text-sm text-ink-500 tabular-nums">{filtered.length} shown</p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-3 print:hidden">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email"
            className="pl-9"
          />
        </div>
        <Select value={tier} onValueChange={setTier}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {TIER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={missing} onValueChange={setMissing}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any milestone status</SelectItem>
            {MILESTONE_KEYS.map((k) => (
              <SelectItem key={k} value={k}>Missing: {MILESTONE_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto print:overflow-visible">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Email</TableHead>
              {MILESTONE_KEYS.map((k) => (
                <TableHead key={k} className="text-center">
                  {k.replace("first_", "").replace(/_/g, " ")}
                </TableHead>
              ))}
              <TableHead className="text-right">Progress</TableHead>
              <TableHead className="text-right">%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.userId}>
                <TableCell className="font-medium">{r.fullName ?? "N/A"}</TableCell>
                <TableCell className="hidden sm:table-cell text-ink-600">{r.email ?? "N/A"}</TableCell>
                {MILESTONE_KEYS.map((k) => (
                  <TableCell key={k} className="text-center">
                    <span className="inline-flex"><YesNo ok={milestoneOf(r, k)} /></span>
                  </TableCell>
                ))}
                <TableCell className="text-right">
                  <div className="ml-auto h-2 w-24 overflow-hidden rounded-full bg-ink-100 dark:bg-white/10">
                    <div
                      className={cn("h-full rounded-full bg-brand-primary")}
                      style={{ width: `${Number(r.completionPercent)}%` }}
                    />
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {Math.round(Number(r.completionPercent))}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {filtered.length === 0 && (
        <p className="mt-4 text-center text-sm text-ink-500">No matches.</p>
      )}
    </div>
  );
}
