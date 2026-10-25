import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Lock, Loader2 } from "lucide-react";
import { formatOlympiadFee } from "@/lib/olympiad/money";
import { CampaignStatusPill } from "./CampaignStatusPill";
import {
  useUpsertOlympiadCampaign,
  type OlympiadCampaign,
  type OlympiadCampaignInput,
} from "@/hooks/olympiad/useOlympiadCampaign";

const DEFAULT_NEW: OlympiadCampaignInput = {
  campaign_year: new Date().getFullYear(),
  default_price_rupees: 500,
  gst_percent: 18,
  exam_duration_minutes: 90,
  questions_per_subject: 30,
  pin_expiry_minutes: 120,
  gold_threshold_percent: 85,
  silver_threshold_percent: 70,
  bronze_threshold_percent: 50,
  gstin: null,
  status: "draft",
  description: null,
};

function toCampaignInput(c: OlympiadCampaign): OlympiadCampaignInput {
  return {
    id: c.id,
    campaign_year: c.campaign_year,
    default_price_rupees: c.default_price_rupees,
    gst_percent: c.gst_percent,
    exam_duration_minutes: c.exam_duration_minutes,
    questions_per_subject: c.questions_per_subject,
    pin_expiry_minutes: c.pin_expiry_minutes,
    gold_threshold_percent: c.gold_threshold_percent,
    silver_threshold_percent: c.silver_threshold_percent,
    bronze_threshold_percent: c.bronze_threshold_percent,
    gstin: c.gstin,
    status: c.status,
    description: c.description,
  };
}

function parseNumOr(raw: string, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function CampaignSettingsForm({ campaign }: { campaign: OlympiadCampaign | null }) {
  const [draft, setDraft] = useState<OlympiadCampaignInput>(
    campaign ? toCampaignInput(campaign) : DEFAULT_NEW,
  );
  useEffect(() => {
    if (campaign) setDraft(toCampaignInput(campaign));
  }, [campaign]);

  const upsert = useUpsertOlympiadCampaign();

  const fee = (() => {
    try {
      return formatOlympiadFee(draft.default_price_rupees, draft.gst_percent);
    } catch {
      return null;
    }
  })();

  // Lock detection — UI hint only; the DB trigger enforces server-side.
  const locked = campaign?.status === "active";

  // data-dirty: only meaningful once a campaign exists; compare serialised state.
  const isDirty =
    campaign !== null &&
    JSON.stringify(draft) !== JSON.stringify(toCampaignInput(campaign));

  const update = <K extends keyof OlympiadCampaignInput>(k: K, v: OlympiadCampaignInput[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <form
      data-dirty={isDirty ? "true" : "false"}
      onSubmit={(e) => {
        e.preventDefault();
        upsert.mutate(draft);
      }}
      className="surface-card frosted-shadow rounded-card p-5 sm:p-6 space-y-5"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Campaign</p>
          <h2 className="text-lg sm:text-xl font-semibold text-ink-900">
            {draft.campaign_year} Olympiad
          </h2>
        </div>
        <CampaignStatusPill status={draft.status} />
      </header>

      {locked && (
        <div className="flex items-start gap-2 text-xs text-ink-600 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 rounded-md">
          <Lock className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>
            Some fields lock once any school enrolls. Default price and per-school overrides stay
            editable.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Campaign year">
          <Input
            type="number"
            value={draft.campaign_year}
            onChange={(e) => update("campaign_year", parseNumOr(e.target.value, draft.campaign_year))}
            disabled={!!campaign}
            min={2024}
            max={2100}
          />
        </Field>
        <Field
          label="Default price (₹)"
          hint={fee ? fee.display : "Enter the base fee in rupees to see the GST breakdown"}
        >
          <Input
            type="number"
            value={draft.default_price_rupees}
            onChange={(e) =>
              update("default_price_rupees", parseNumOr(e.target.value, draft.default_price_rupees))
            }
            min={1}
            step={1}
          />
        </Field>
        <Field label="GST percent" lockHint={locked}>
          <Input
            type="number"
            value={draft.gst_percent}
            onChange={(e) => update("gst_percent", parseNumOr(e.target.value, draft.gst_percent))}
            min={0}
            max={100}
            step={0.01}
            disabled={locked}
          />
        </Field>
        <Field label="Exam duration (minutes)" lockHint={locked}>
          <Input
            type="number"
            value={draft.exam_duration_minutes}
            onChange={(e) => update("exam_duration_minutes", parseNumOr(e.target.value, draft.exam_duration_minutes))}
            min={1}
            disabled={locked}
          />
        </Field>
        <Field label="Questions per subject" lockHint={locked}>
          <Input
            type="number"
            value={draft.questions_per_subject}
            onChange={(e) => update("questions_per_subject", parseNumOr(e.target.value, draft.questions_per_subject))}
            min={1}
            disabled={locked}
          />
        </Field>
        <Field label="PIN expiry (minutes)">
          <Input
            type="number"
            value={draft.pin_expiry_minutes}
            onChange={(e) => update("pin_expiry_minutes", parseNumOr(e.target.value, draft.pin_expiry_minutes))}
            min={1}
          />
        </Field>
        <Field label="Gold threshold (%)" lockHint={locked}>
          <Input
            type="number"
            value={draft.gold_threshold_percent}
            onChange={(e) => update("gold_threshold_percent", parseNumOr(e.target.value, draft.gold_threshold_percent))}
            min={0}
            max={100}
            step={0.01}
            disabled={locked}
          />
        </Field>
        <Field label="Silver threshold (%)" lockHint={locked}>
          <Input
            type="number"
            value={draft.silver_threshold_percent}
            onChange={(e) => update("silver_threshold_percent", parseNumOr(e.target.value, draft.silver_threshold_percent))}
            min={0}
            max={100}
            step={0.01}
            disabled={locked}
          />
        </Field>
        <Field label="Bronze threshold (%)" lockHint={locked}>
          <Input
            type="number"
            value={draft.bronze_threshold_percent}
            onChange={(e) => update("bronze_threshold_percent", parseNumOr(e.target.value, draft.bronze_threshold_percent))}
            min={0}
            max={100}
            step={0.01}
            disabled={locked}
          />
        </Field>
        <Field label="GSTIN">
          <Input
            value={draft.gstin ?? ""}
            onChange={(e) => update("gstin", e.target.value || null)}
          />
        </Field>
      </div>

      <Field label="Description">
        <Textarea
          value={draft.description ?? ""}
          onChange={(e) => update("description", e.target.value || null)}
          rows={3}
        />
      </Field>

      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2">
          {draft.status === "draft" && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDraft((d) => ({ ...d, status: "active" }))}
            >
              Set Active
            </Button>
          )}
          {draft.status === "active" && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setDraft((d) => ({ ...d, status: "closed" }))}
            >
              Close Campaign
            </Button>
          )}
        </div>
        <Button type="submit" disabled={upsert.isPending}>
          {upsert.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  lockHint,
  children,
}: {
  label: string;
  hint?: string;
  lockHint?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-medium text-ink-600 inline-flex items-center gap-1">
        {label}
        {lockHint && <Lock className="h-3 w-3 text-ink-500" />}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-ink-500">{hint}</p>}
    </div>
  );
}
