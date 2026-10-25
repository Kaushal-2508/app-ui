import { Loader2 } from "lucide-react";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { useOlympiadCampaigns } from "@/hooks/olympiad/useOlympiadCampaign";
import { CampaignSettingsForm } from "@/components/olympiad/admin/CampaignSettingsForm";
import { CampaignStatusPill } from "@/components/olympiad/admin/CampaignStatusPill";

type Props = { open: boolean; onOpenChange: (o: boolean) => void };

export function CampaignSettingsSheet({ open, onOpenChange }: Props) {
  const { data: campaigns, isLoading } = useOlympiadCampaigns();
  const currentYear = new Date().getFullYear();
  const current = campaigns?.find((c) => c.campaign_year === currentYear) ?? null;
  const history = (campaigns ?? []).filter((c) => c.campaign_year !== currentYear);

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Campaign settings"
      subtitle="Pricing, exam config, and historical campaigns"
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
        </div>
      ) : (
        <div className="space-y-6">
          <CampaignSettingsForm campaign={current} />
          {history.length > 0 && (
            <section className="surface-card frosted-shadow rounded-card p-5 space-y-3">
              <header>
                <p className="eyebrow">History</p>
                <h3 className="text-base font-semibold text-ink-900">Past campaigns</h3>
              </header>
              <ul className="divide-y divide-surface-stroke">
                {history.map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-ink-900 font-medium">{c.campaign_year} Olympiad</span>
                    <CampaignStatusPill status={c.status} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </MobileSheet>
  );
}
