import { WifiOff } from "lucide-react";

type Props = { offline: boolean };

export function DisconnectBanner({ offline }: Props) {
  if (!offline) return null;
  return (
    <div className="bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300 px-4 py-2 text-sm flex items-center gap-2">
      <WifiOff className="h-4 w-4" />
      You&apos;re offline. Your timer keeps running. Reconnect soon to save your answers.
    </div>
  );
}
