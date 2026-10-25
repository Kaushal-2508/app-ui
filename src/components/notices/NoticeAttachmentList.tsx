import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, ImageOff, Loader2, Paperclip } from "lucide-react";

import {
  attachmentKey,
  formatFileSize,
  isImageAttachment,
  resolveNoticeAttachmentUrls,
} from "@/lib/noticeAttachments";
import type { NoticeAttachment } from "@/hooks/notices";

interface NoticeAttachmentListProps {
  noticeId: string;
  attachments: NoticeAttachment[];
  /** Only fetch signed URLs while the notice is actually on screen. */
  enabled: boolean;
}

/**
 * Attachments on a notice.
 *
 * Images render inline — a notice whose whole point is a photographed circular
 * or a datesheet is useless as a filename you have to download first. Anything
 * else stays a compact download row.
 *
 * All URLs are signed in ONE batched call, so a notice with several files costs
 * one storage round trip rather than one per file. Signed links last 5 minutes;
 * `staleTime` is set below that so a long-open sheet re-signs before its images
 * start 403ing.
 */
export function NoticeAttachmentList({
  noticeId,
  attachments,
  enabled,
}: NoticeAttachmentListProps) {
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  const { data, isLoading, isError } = useQuery({
    queryKey: ["notices", "attachment-urls", noticeId],
    queryFn: () => resolveNoticeAttachmentUrls(attachments),
    enabled: enabled && attachments.length > 0,
    staleTime: 4 * 60_000,
    refetchOnWindowFocus: false,
  });

  if (attachments.length === 0) return null;

  return (
    <div className="space-y-2 border-t border-surface-stroke pt-4">
      <p className="flex items-center gap-2 text-sm font-medium text-ink-900">
        <Paperclip className="h-4 w-4" aria-hidden />
        Attachments ({attachments.length})
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading attachments…
        </div>
      ) : isError ? (
        <p className="py-2 text-sm text-ink-600">
          Couldn't load these attachments. Close and reopen the notice to retry.
        </p>
      ) : (
        <ul className="space-y-3">
          {attachments.map((a) => {
            const key = attachmentKey(a);
            const url = data?.[key] ?? null;
            const isImage = isImageAttachment(a);

            if (isImage && url && !broken[key]) {
              return (
                <li key={key} className="space-y-1">
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden rounded-card border border-surface-stroke"
                  >
                    <img
                      src={url}
                      alt={a.name}
                      loading="lazy"
                      onError={() => setBroken((p) => ({ ...p, [key]: true }))}
                      className="h-auto max-h-80 w-full object-contain bg-surface-stroke/30"
                    />
                  </a>
                  <div className="flex items-center gap-2 px-1 text-xs text-ink-500">
                    <span className="truncate">{a.name}</span>
                    {a.size != null && (
                      <span className="shrink-0">{formatFileSize(a.size)}</span>
                    )}
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto inline-flex shrink-0 items-center gap-1 text-brand-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" aria-hidden />
                      Open
                    </a>
                  </div>
                </li>
              );
            }

            return (
              <li key={key}>
                <a
                  href={url ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={!url}
                  className={`flex items-center gap-2 rounded-lg bg-surface-stroke/40 px-3 py-2 text-sm transition-colors duration-200 ${
                    url
                      ? "text-brand-primary hover:bg-surface-stroke/70"
                      : "pointer-events-none text-ink-500"
                  }`}
                >
                  {isImage && broken[key] ? (
                    <ImageOff className="h-4 w-4 shrink-0" aria-hidden />
                  ) : (
                    <Download className="h-4 w-4 shrink-0" aria-hidden />
                  )}
                  <span className="truncate">{a.name}</span>
                  {a.size != null && (
                    <span className="ml-auto shrink-0 text-xs text-ink-500">
                      {formatFileSize(a.size)}
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
