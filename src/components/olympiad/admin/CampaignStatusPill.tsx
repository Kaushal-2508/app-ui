import { Badge } from "@/components/ui/badge";

type Status = "draft" | "active" | "closed";

const STYLE: Record<Status, string> = {
  draft: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  active: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300",
  closed: "bg-slate-200 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
};

const LABEL: Record<Status, string> = {
  draft: "Draft",
  active: "Active",
  closed: "Closed",
};

export function CampaignStatusPill({ status }: { status: Status }) {
  return (
    <Badge className={`text-xs font-medium ${STYLE[status]}`} variant="secondary">
      {LABEL[status]}
    </Badge>
  );
}
