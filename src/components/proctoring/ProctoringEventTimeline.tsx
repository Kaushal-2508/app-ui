import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Camera, Monitor, AlertTriangle, ZoomIn, Clock } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

interface ProctoringEvent {
  id: string;
  event_type: string;
  severity: string;
  occurred_at: string;
  duration_seconds: number | null;
  description: string | null;
  question_id: string | null;
  screenshot_url: string | null;
}

interface ProctoringEventTimelineProps {
  events: ProctoringEvent[] | undefined;
  isLoading: boolean;
  onScreenshotClick: (url: string) => void;
}

export function ProctoringEventTimeline({
  events,
  isLoading,
  onScreenshotClick,
}: ProctoringEventTimelineProps) {
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  // Generate signed URLs for screenshot_url values that are storage paths (not already signed)
  useEffect(() => {
    if (!events) return;
    const pathEvents = events.filter(
      (e) => e.screenshot_url && !e.screenshot_url.startsWith("http")
    );
    if (pathEvents.length === 0) return;

    const generateUrls = async () => {
      const urls: Record<string, string> = {};
      for (const e of pathEvents) {
        const { data } = await supabase.storage
          .from("proctoring-screenshots")
          .createSignedUrl(e.screenshot_url!, 86400);
        if (data?.signedUrl) urls[e.id] = data.signedUrl;
      }
      setSignedUrls(urls);
    };
    generateUrls();
  }, [events]);
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  if (!events || events.length === 0) {
    return (
      <div className="text-center py-8 bg-muted/30 rounded-lg">
        <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-muted-foreground">No events recorded in this session</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
      {events.map((event, index) => (
        <div
          key={event.id}
          className="relative flex gap-4 pb-3"
        >
          {/* Timeline line */}
          {index < events.length - 1 && (
            <div className="absolute left-[17px] top-10 bottom-0 w-0.5 bg-border" />
          )}
          
          {/* Event icon */}
          <div
            className={`relative z-10 p-2 rounded-full shrink-0 ${
              event.severity === "high"
                ? "bg-destructive/10 text-destructive"
                : event.severity === "medium"
                ? "bg-amber-100 text-amber-600 dark:bg-amber-950/50"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {getEventIcon(event.event_type)}
          </div>

          {/* Event content */}
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium capitalize">
                {formatEventType(event.event_type)}
              </span>
              <SeverityBadge severity={event.severity} />
              <span className="text-xs text-muted-foreground ml-auto">
                {format(new Date(event.occurred_at), "h:mm:ss a")}
              </span>
            </div>
            
            <p className="text-sm text-muted-foreground">
              {event.description}
            </p>

            {event.duration_seconds && (
              <p className="text-xs text-muted-foreground">
                Duration: {event.duration_seconds}s
              </p>
            )}

            {/* Screenshot thumbnail */}
            {(event.screenshot_url || signedUrls[event.id]) && (() => {
              const imgUrl = signedUrls[event.id] || event.screenshot_url!;
              return (
                <div
                  className="mt-2 inline-block cursor-pointer group relative"
                  onClick={() => onScreenshotClick(imgUrl)}
                >
                  <img
                    src={imgUrl}
                    alt="Proctoring screenshot"
                    className="w-40 h-24 object-cover rounded border hover:border-primary transition-colors"
                  />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded flex items-center justify-center">
                    <ZoomIn className="h-5 w-5 text-white" />
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      ))}
    </div>
  );
}

function getEventIcon(eventType: string) {
  if (eventType.includes("face") || eventType.includes("camera")) {
    return <Camera className="h-4 w-4" />;
  }
  if (
    eventType.includes("tab") ||
    eventType.includes("window") ||
    eventType.includes("fullscreen")
  ) {
    return <Monitor className="h-4 w-4" />;
  }
  return <AlertTriangle className="h-4 w-4" />;
}

function formatEventType(type: string): string {
  return type.replace(/_/g, " ");
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === "high") {
    return <Badge variant="destructive" className="text-xs">High</Badge>;
  }
  if (severity === "medium") {
    return <Badge className="text-xs bg-amber-500 hover:bg-amber-600">Medium</Badge>;
  }
  return <Badge variant="secondary" className="text-xs">Low</Badge>;
}
