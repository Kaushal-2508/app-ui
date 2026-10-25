import { CheckSquare, FileText, Settings2, UserMinus } from "lucide-react";

import type { ActivitySource } from "./activityModel";

const ICONS = {
  system: Settings2,
  task: CheckSquare,
  exam: FileText,
  assignment: UserMinus,
} as const;

export function SourceIcon({ source, className }: { source: ActivitySource; className?: string }) {
  const Icon = ICONS[source];
  return <Icon className={className} aria-hidden />;
}
