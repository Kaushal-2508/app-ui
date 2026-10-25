import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, RefreshCw, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { HybridPairingToken } from "@/hooks/useHybridAttempt";

interface HybridPairingCardProps {
  token: HybridPairingToken | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError?: boolean;
  onRegenerate: () => void;
}

function useCountdown(expiresAt: string | undefined) {
  const [remaining, setRemaining] = useState<number>(0);
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      setRemaining(Math.max(0, Math.floor(diff / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return remaining;
}

function formatMmSs(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function HybridPairingCard({
  token,
  isLoading,
  isFetching,
  isError,
  onRegenerate,
}: HybridPairingCardProps) {
  const remaining = useCountdown(token?.expires_at);
  const expired = !!token && remaining <= 0;
  const showError = !!isError && !token && !isLoading && !isFetching;

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Smartphone className="h-4 w-4 text-primary" />
        Pair your phone
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        Scan this QR with your phone camera to open the upload page. Or enter the short code below
        manually at the upload URL.
      </p>

      {showError ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <p className="text-sm text-muted-foreground">
            Couldn't generate the pairing code.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRegenerate}
            disabled={isFetching}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`}
            />
            Regenerate code
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
        <div className="rounded-lg border border-border bg-white p-3">
          {isLoading || !token ? (
            <Skeleton className="h-44 w-44 rounded-md" />
          ) : (
            <QRCodeSVG value={token.qr_url} size={176} level="M" includeMargin={false} />
          )}
        </div>

        <div className="w-full text-center">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Short code
          </div>
          {token ? (
            <div className="font-mono text-2xl font-bold tracking-[0.3em] text-foreground">
              {token.short_code}
            </div>
          ) : (
            <Skeleton className="mx-auto h-7 w-32" />
          )}
        </div>

        {token && (
          <div className="text-center text-[11px] text-muted-foreground">
            {expired ? (
              <span className="text-amber-700">
                Code expired. Regenerate to keep going
              </span>
            ) : (
              <>Expires in {formatMmSs(remaining)}</>
            )}
          </div>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={onRegenerate}
          disabled={isFetching}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`}
          />
          Regenerate pairing code
        </Button>
        </div>
      )}
    </div>
  );
}
