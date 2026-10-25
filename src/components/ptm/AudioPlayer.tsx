import { useState } from "react";
import { Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toastError } from "@/lib/toast";
import { formatDuration } from "@/lib/ptm";
import { getPTMAudioUrl } from "@/hooks/ptm";

interface Props {
  /** Object name in the private feedback bucket. */
  path: string;
  durationSeconds?: number | null;
  label?: string;
  className?: string;
}

/**
 * Plays one saved voice note. The signed URL is fetched only when the reader
 * presses Play, so a list of fifty rows makes no storage calls until someone
 * listens; the storage policy decides who may have the URL at all.
 */
export function AudioPlayer({ path, durationSeconds, label = "Voice note", className }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setUrl(await getPTMAudioUrl(path));
    } catch (e) {
      toastError(e, { fallback: "Couldn't load the voice note.", context: "ptmAudioUrl" });
    } finally {
      setLoading(false);
    }
  };

  if (url) {
    return <audio controls autoPlay src={url} className={className ?? "h-10 w-full"} aria-label={label} />;
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading} className={className}>
      {loading ? (
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />
      )}
      {label}
      {durationSeconds ? <span className="ml-1.5 text-ink-500">{formatDuration(durationSeconds)}</span> : null}
    </Button>
  );
}
