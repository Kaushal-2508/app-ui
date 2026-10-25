import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { CheckCircle2, XCircle, AlertTriangle, Camera, Monitor, Shield } from "lucide-react";
import { toast } from "sonner";
import { ProctoringEventTimeline } from "./ProctoringEventTimeline";

interface ProctoringSession {
  id: string;
  attempt_id: string;
  started_at: string;
  ended_at: string | null;
  total_events: number;
  high_severity_events: number;
  medium_severity_events: number;
  low_severity_events: number;
  requires_review: boolean;
  review_status: string;
  review_notes: string | null;
  student_exam_attempts: {
    student_id: string;
    exam_id: string;
    profiles: {
      full_name: string;
      email: string;
    };
    exams: {
      title: string;
    };
  };
}

interface ProctoringSessionDetailProps {
  session: ProctoringSession | null;
  onClose: () => void;
}

export function ProctoringSessionDetail({ session, onClose }: ProctoringSessionDetailProps) {
  const queryClient = useQueryClient();
  const [reviewNotes, setReviewNotes] = useState(session?.review_notes || "");
  const [screenshotModalUrl, setScreenshotModalUrl] = useState<string | null>(null);

  // Fetch events for the session
  const { data: events, isLoading: eventsLoading } = useQuery({
    queryKey: ["proctoring-events", session?.id],
    queryFn: async () => {
      if (!session) return [];
      const { data, error } = await supabase
        .from("proctoring_events")
        .select("*")
        .eq("session_id", session.id)
        .order("occurred_at", { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: !!session,
  });

  // Review mutation
  const reviewMutation = useMutation({
    mutationFn: async ({
      sessionId,
      status,
      notes,
    }: {
      sessionId: string;
      status: string;
      notes: string;
    }) => {
      const { error } = await supabase
        .from("proctoring_sessions")
        .update({
          review_status: status,
          review_notes: notes,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", sessionId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Review submitted successfully");
      queryClient.invalidateQueries({ queryKey: ["proctoring-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["proctoring-classes"] });
      onClose();
    },
    onError: (error: any) => {
      toast.error("Failed to submit review: " + error.message);
    },
  });

  const handleReview = (status: string) => {
    if (!session) return;
    reviewMutation.mutate({
      sessionId: session.id,
      status,
      notes: reviewNotes,
    });
  };

  if (!session) return null;

  return (
    <>
      <Dialog open={!!session} onOpenChange={() => onClose()}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Session Review
            </DialogTitle>
            <DialogDescription>
              {session.student_exam_attempts?.profiles?.full_name} -{" "}
              {session.student_exam_attempts?.exams?.title}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Session Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                label="Total Events"
                value={session.total_events}
                icon={<Monitor className="h-4 w-4" />}
              />
              <StatCard
                label="High Severity"
                value={session.high_severity_events}
                variant="destructive"
                icon={<AlertTriangle className="h-4 w-4" />}
              />
              <StatCard
                label="Medium Severity"
                value={session.medium_severity_events}
                variant="warning"
                icon={<AlertTriangle className="h-4 w-4" />}
              />
              <StatCard
                label="Low Severity"
                value={session.low_severity_events}
                variant="muted"
                icon={<Camera className="h-4 w-4" />}
              />
            </div>

            {/* Events Timeline */}
            <div>
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <Monitor className="h-4 w-4" />
                Events Timeline
              </h4>
              <ProctoringEventTimeline
                events={events}
                isLoading={eventsLoading}
                onScreenshotClick={setScreenshotModalUrl}
              />
            </div>

            {/* Review Actions */}
            {session.review_status === "pending" && (
              <div className="border-t pt-4 space-y-4">
                <h4 className="font-medium">Review Decision</h4>
                <Textarea
                  placeholder="Add review notes (optional)..."
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  rows={3}
                />
                <div className="flex gap-3 flex-wrap">
                  <Button
                    variant="outline"
                    className="flex-1 min-w-[120px]"
                    onClick={() => handleReview("cleared")}
                    disabled={reviewMutation.isPending}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" />
                    Clear
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 min-w-[120px]"
                    onClick={() => handleReview("reviewed")}
                    disabled={reviewMutation.isPending}
                  >
                    <AlertTriangle className="h-4 w-4 mr-2 text-amber-600" />
                    Issue Warning
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1 min-w-[120px]"
                    onClick={() => handleReview("flagged")}
                    disabled={reviewMutation.isPending}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Flag as Violation
                  </Button>
                </div>
              </div>
            )}

            {/* Previous Review Notes */}
            {session.review_notes && session.review_status !== "pending" && (
              <div className="border-t pt-4">
                <h4 className="font-medium mb-2">Review Notes</h4>
                <p className="text-sm text-muted-foreground bg-muted p-3 rounded">
                  {session.review_notes}
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Screenshot Lightbox */}
      <Dialog open={!!screenshotModalUrl} onOpenChange={() => setScreenshotModalUrl(null)}>
        <DialogContent className="max-w-5xl p-2">
          <DialogHeader className="sr-only">
            <DialogTitle>Screenshot Preview</DialogTitle>
          </DialogHeader>
          {screenshotModalUrl && (
            <img
              src={screenshotModalUrl}
              alt="Proctoring screenshot"
              className="w-full rounded"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatCard({
  label,
  value,
  variant = "default",
  icon,
}: {
  label: string;
  value: number;
  variant?: "default" | "destructive" | "warning" | "muted";
  icon?: React.ReactNode;
}) {
  const variantClasses = {
    default: "",
    destructive: "bg-destructive/10 border-destructive/30",
    warning: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
    muted: "bg-muted",
  };

  const valueClasses = {
    default: "",
    destructive: "text-destructive",
    warning: "text-amber-600",
    muted: "text-muted-foreground",
  };

  return (
    <Card className={`p-3 ${variantClasses[variant]}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-bold ${valueClasses[variant]}`}>{value}</div>
    </Card>
  );
}
