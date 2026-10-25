import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { User, Eye, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { format } from "date-fns";

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

interface ProctoringSessionCardProps {
  session: ProctoringSession;
  onView: (session: ProctoringSession) => void;
}

export function ProctoringSessionCard({ session, onView }: ProctoringSessionCardProps) {
  const hasHighSeverity = session.high_severity_events > 0;
  const hasMediumSeverity = session.medium_severity_events > 0;

  return (
    <Card className={`transition-colors hover:border-primary/50 ${hasHighSeverity ? 'border-destructive/30' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Student info */}
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center shrink-0">
              <User className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="font-medium truncate">
                {session.student_exam_attempts?.profiles?.full_name}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {session.student_exam_attempts?.profiles?.email}
              </p>
              <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {format(new Date(session.started_at), "MMM d, h:mm a")}
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Severity indicators */}
            <div className="flex flex-col gap-1 items-end">
              <div className="flex gap-1">
                {hasHighSeverity && (
                  <Badge variant="destructive" className="text-xs gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {session.high_severity_events}
                  </Badge>
                )}
                {hasMediumSeverity && (
                  <Badge className="text-xs bg-amber-500 hover:bg-amber-600 gap-1">
                    {session.medium_severity_events}
                  </Badge>
                )}
                {!hasHighSeverity && !hasMediumSeverity && session.total_events > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {session.total_events} events
                  </Badge>
                )}
                {session.total_events === 0 && (
                  <Badge variant="outline" className="text-xs gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    Clean
                  </Badge>
                )}
              </div>
              <StatusBadge status={session.review_status} />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => onView(session)}>
            <Eye className="h-4 w-4 mr-1" />
            Review Session
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string; className?: string }> = {
    pending: { variant: "outline", label: "Pending Review", className: "border-amber-300 text-amber-600" },
    reviewed: { variant: "outline", label: "Reviewed" },
    cleared: { variant: "outline", label: "Cleared", className: "border-green-300 text-green-600" },
    flagged: { variant: "destructive", label: "Flagged" },
  };

  const { variant, label, className } = config[status] || config.pending;
  return <Badge variant={variant} className={`text-xs ${className || ""}`}>{label}</Badge>;
}
