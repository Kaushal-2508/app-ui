import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { 
  RefreshCcw,
  Clock,
  CheckCircle2,
  XCircle,
  Plus,
  FileText,
  Loader2
} from "lucide-react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { useStudentRechecks, useStudentPublishedResults, useSubmitRecheck } from "@/hooks/useRechecks";

import { PageShell, PageHeader } from "@/components/shared/page";
import { StatTile, StatTileGrid, EmptyState } from "@/components/shared/surfaces";

export default function StudentRechecksPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedResultId, setSelectedResultId] = useState("");
  const [questionNumber, setQuestionNumber] = useState("");
  const [reason, setReason] = useState("");

  const { data: rechecks, isLoading } = useStudentRechecks();
  const { data: publishedResults } = useStudentPublishedResults();
  const submitRecheck = useSubmitRecheck();

  const pendingCount = rechecks?.filter(r => r.status === "pending").length || 0;
  const completedCount = rechecks?.filter(r => r.status === "completed").length || 0;
  const rejectedCount = rechecks?.filter(r => r.status === "rejected").length || 0;

  const handleSubmit = async () => {
    if (!selectedResultId || !reason.trim()) return;

    await submitRecheck.mutateAsync({
      resultId: selectedResultId,
      questionId: null, // Would need question ID lookup
      reason: reason.trim(),
    });

    setIsDialogOpen(false);
    setSelectedResultId("");
    setQuestionNumber("");
    setReason("");
  };

  if (isLoading) {
    return <PageSkeleton />;
  }

  return (
    <PageShell>
      <PageHeader
        icon={<RefreshCcw className="h-5 w-5" />}
        title="Recheck Requests"
        subtitle="Request re-evaluation of your exam answers"
        primaryAction={{
          label: "New Request",
          icon: <Plus className="h-4 w-4" />,
          onClick: () => setIsDialogOpen(true),
          disabled: !publishedResults || publishedResults.length === 0,
        }}
      />
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request Recheck</DialogTitle>
              <DialogDescription>
                Submit a request to have your exam answer re-evaluated
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Select Exam *</Label>
                <Select value={selectedResultId} onValueChange={setSelectedResultId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an exam" />
                  </SelectTrigger>
                  <SelectContent>
                    {publishedResults?.map((result) => (
                      <SelectItem key={result.resultId} value={result.resultId}>
                        {result.examTitle} ({result.percentage.toFixed(0)}%)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Question Number (optional)</Label>
                <Input 
                  type="number" 
                  placeholder="Leave blank for full paper recheck" 
                  value={questionNumber}
                  onChange={(e) => setQuestionNumber(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Reason for Recheck *</Label>
                <Textarea 
                  placeholder="Explain why you believe the answer needs re-evaluation..." 
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={4}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleSubmit} 
                disabled={!selectedResultId || !reason.trim() || submitRecheck.isPending}
              >
                {submitRecheck.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Submit Request
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      <StatTileGrid cols={3} mdCols={3}>
        <StatTile label="Pending" value={pendingCount} icon={<Clock className="h-5 w-5" />} tone="peach" />
        <StatTile label="Completed" value={completedCount} icon={<CheckCircle2 className="h-5 w-5" />} tone="mint" />
        <StatTile label="Rejected" value={rejectedCount} icon={<XCircle className="h-5 w-5" />} tone="rose" />
      </StatTileGrid>

      {/* Requests List */}
      {rechecks && rechecks.length > 0 ? (
        <div className="space-y-4">
          {rechecks.map((request) => (
            <Card key={request.id}>
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <h3 className="font-semibold">{request.examTitle}</h3>
                      <RecheckStatusBadge status={request.status} />
                    </div>
                    {request.questionNumber && (
                      <p className="text-sm text-muted-foreground mb-2">
                        Question #{request.questionNumber}
                      </p>
                    )}
                    <p className="text-sm">{request.requestReason}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Requested on {format(new Date(request.requestedAt), "MMM d, yyyy")}
                    </p>
                  </div>

                  {request.status !== "pending" && (
                    <div className="text-right">
                      {request.marksChanged && request.newMarks !== null && (
                        <div className="mb-2">
                          <span className="text-sm text-muted-foreground">Marks: </span>
                          <span className="line-through text-muted-foreground">{request.previousMarks}</span>
                          <span className="mx-2">→</span>
                          <span className="font-bold text-green-600">{request.newMarks}</span>
                        </div>
                      )}
                      {request.resolutionNotes && (
                        <p className="text-sm text-muted-foreground max-w-xs">
                          {request.resolutionNotes}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<RefreshCcw className="h-7 w-7" />}
          title="No recheck requests"
          description={
            publishedResults && publishedResults.length > 0
              ? "You haven't submitted any recheck requests yet."
              : "No published results available for recheck."
          }
          action={
            publishedResults && publishedResults.length > 0
              ? {
                  label: "Create Request",
                  icon: <Plus className="h-4 w-4" />,
                  onClick: () => setIsDialogOpen(true),
                }
              : undefined
          }
        />
      )}
    </PageShell>
  );
}

function RecheckStatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string; icon: typeof Clock }> = {
    pending: { variant: "secondary", label: "Pending", icon: Clock },
    completed: { variant: "default", label: "Completed", icon: CheckCircle2 },
    rejected: { variant: "destructive", label: "Rejected", icon: XCircle },
  };

  const { variant, label, icon: Icon } = config[status] || config.pending;

  return (
    <Badge variant={variant} className="text-xs">
      <Icon className="h-3 w-3 mr-1" />
      {label}
    </Badge>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64 mt-2" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-40" />
    </div>
  );
}
