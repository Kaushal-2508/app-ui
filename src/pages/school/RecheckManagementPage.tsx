import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MathText } from "@/components/ui/math-text";
import { PageHeader, PageShell } from "@/components/shared/page";
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { MobileTabs } from "@/components/shared/nav";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  RefreshCcw,
  Clock,
  CheckCircle2,
  XCircle,
  User,
  FileText,
  Loader2,
  Eye
} from "lucide-react";
import { format } from "date-fns";
import { useInstitutionRechecks, useResolveRecheck, RecheckRequestAdmin } from "@/hooks/useRecheckManagement";

export default function RecheckManagementPage() {
  const [selectedRecheck, setSelectedRecheck] = useState<RecheckRequestAdmin | null>(null);
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [newMarks, setNewMarks] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [resolveAction, setResolveAction] = useState<"completed" | "rejected">("completed");
  const [tab, setTab] = useState<"pending" | "resolved">("pending");

  const { data: rechecks, isLoading } = useInstitutionRechecks();
  const resolveRecheck = useResolveRecheck();

  const pendingRechecks = rechecks?.filter(r => r.status === "pending") || [];
  const completedRechecks = rechecks?.filter(r => r.status === "completed") || [];
  const rejectedRechecks = rechecks?.filter(r => r.status === "rejected") || [];

  const handleResolve = (recheck: RecheckRequestAdmin, action: "completed" | "rejected") => {
    setSelectedRecheck(recheck);
    setResolveAction(action);
    setNewMarks(recheck.previousMarks?.toString() || "");
    setResolutionNotes("");
    setResolveDialogOpen(true);
  };

  const handleSubmitResolve = async () => {
    if (!selectedRecheck) return;

    await resolveRecheck.mutateAsync({
      recheckId: selectedRecheck.id,
      status: resolveAction,
      newMarks: resolveAction === "completed" ? (newMarks ? parseFloat(newMarks) : null) : null,
      resolutionNotes: resolutionNotes.trim() || undefined,
    });

    setResolveDialogOpen(false);
    setSelectedRecheck(null);
  };

  if (isLoading) {
    return <PageSkeleton />;
  }

  return (
    <PageShell>
      {/* On the shared page frame like every other admin page: the bare h1
          and three 200px raw cards read as a web page on the phone
          (2026-09-21). StatTile is a compact row in the app; MobileTabs is
          the one tab strip. */}
      <PageHeader
        density="compact"
        icon={<RefreshCcw className="h-5 w-5" />}
        title="Recheck Management"
        subtitle="Review and resolve student recheck requests"
      />

      <StatTileGrid mdCols={3} className="mt-2">
        <StatTile
          label="Pending"
          value={pendingRechecks.length}
          icon={<Clock className="h-5 w-5" />}
          tone="peach"
          onClick={() => setTab("pending")}
        />
        <StatTile
          label="Completed"
          value={completedRechecks.length}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="mint"
          onClick={() => setTab("resolved")}
        />
        <StatTile
          label="Rejected"
          value={rejectedRechecks.length}
          icon={<XCircle className="h-5 w-5" />}
          tone="rose"
          onClick={() => setTab("resolved")}
        />
      </StatTileGrid>

      <div className="mt-6">
        <MobileTabs
          value={tab}
          onValueChange={(v) => setTab(v as "pending" | "resolved")}
          options={[
            { value: "pending", label: "Pending", count: pendingRechecks.length },
            { value: "resolved", label: "Resolved", count: completedRechecks.length + rejectedRechecks.length },
          ]}
        />
      </div>

      <div className="mt-4">
        {tab === "pending" ? (
          <RecheckTable rechecks={pendingRechecks} onResolve={handleResolve} showActions />
        ) : (
          <RecheckTable
            rechecks={[...completedRechecks, ...rejectedRechecks]}
            onResolve={handleResolve}
          />
        )}
      </div>

      {/* Resolve Dialog */}
      <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {resolveAction === "completed" ? "Complete Recheck" : "Reject Recheck"}
            </DialogTitle>
            <DialogDescription>
              {selectedRecheck?.studentName} - {selectedRecheck?.examTitle}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {selectedRecheck?.questionNumber && (
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm font-medium">Question #{selectedRecheck.questionNumber}</p>
                <MathText
                  as="p"
                  className="text-sm text-muted-foreground line-clamp-2"
                  text={selectedRecheck.questionText}
                />
              </div>
            )}

            <div className="p-3 border rounded-lg">
              <p className="text-sm font-medium mb-1">Student's Reason:</p>
              <p className="text-sm">{selectedRecheck?.requestReason}</p>
            </div>

            {resolveAction === "completed" && (
              <div className="space-y-2">
                <Label>New Marks (leave unchanged if no adjustment needed)</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Previous:</span>
                  <Badge variant="outline">{selectedRecheck?.previousMarks ?? "N/A"}</Badge>
                  <span className="text-sm text-muted-foreground">→</span>
                  <Input
                    type="number"
                    step="0.5"
                    value={newMarks}
                    onChange={(e) => setNewMarks(e.target.value)}
                    className="w-24"
                    placeholder="New"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Resolution Notes {resolveAction === "rejected" && "*"}</Label>
              <Textarea
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                placeholder={resolveAction === "rejected" 
                  ? "Explain why the recheck is being rejected..." 
                  : "Add any notes about the recheck resolution..."}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={resolveAction === "rejected" ? "destructive" : "default"}
              onClick={handleSubmitResolve}
              disabled={resolveRecheck.isPending || (resolveAction === "rejected" && !resolutionNotes.trim())}
            >
              {resolveRecheck.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {resolveAction === "completed" ? "Complete Recheck" : "Reject Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

interface RecheckTableProps {
  rechecks: RecheckRequestAdmin[];
  onResolve: (recheck: RecheckRequestAdmin, action: "completed" | "rejected") => void;
  showActions?: boolean;
}

function RecheckTable({ rechecks, onResolve, showActions }: RecheckTableProps) {
  if (rechecks.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <RefreshCcw className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium mb-2">No recheck requests</h3>
          <p className="text-muted-foreground text-center">
            {showActions 
              ? "No pending recheck requests at the moment"
              : "No resolved recheck requests yet"}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        {/* Phone: one card per request. The table needs 813px, so on a phone
            the Requested, Status and Actions columns (the point of the page)
            were off the screen with no hint (2026-09-18 audit). */}
        <ul className="divide-y divide-surface-stroke md:hidden">
          {rechecks.map((recheck) => (
            <li key={recheck.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium leading-[22px] text-ink-900">
                    {recheck.studentName}
                  </p>
                  <p className="truncate text-[13px] leading-[18px] text-ink-500">
                    {recheck.className || recheck.studentEmail}
                  </p>
                </div>
                <RecheckStatusBadge status={recheck.status} />
              </div>
              <div className="space-y-1 text-[13px] leading-[18px] text-ink-600">
                <p className="flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                  <span className="truncate">{recheck.examTitle}</span>
                  <span className="shrink-0 text-ink-400">·</span>
                  <span className="shrink-0">
                    {recheck.questionNumber ? `Q${recheck.questionNumber}` : "Full paper"}
                  </span>
                </p>
                <p className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                  Requested {format(new Date(recheck.requestedAt), "MMM d, yyyy")}
                </p>
                {!showActions && recheck.marksChanged && (
                  <p>
                    Marks:{" "}
                    <span className="line-through text-ink-400">{recheck.previousMarks}</span>
                    {" to "}
                    <span className="font-medium text-ink-900">{recheck.newMarks}</span>
                  </p>
                )}
                {!showActions && !recheck.marksChanged && recheck.status === "completed" && (
                  <p>Marks unchanged</p>
                )}
              </div>
              {showActions && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-10"
                    onClick={() => onResolve(recheck, "completed")}
                  >
                    <CheckCircle2 className="mr-1 h-4 w-4" />
                    Review
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-10"
                    onClick={() => onResolve(recheck, "rejected")}
                  >
                    <XCircle className="mr-1 h-4 w-4" />
                    Reject
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Exam</TableHead>
              <TableHead>Question</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead>Status</TableHead>
              {!showActions && <TableHead>Resolution</TableHead>}
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rechecks.map((recheck) => (
              <TableRow key={recheck.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{recheck.studentName}</p>
                      <p className="text-xs text-muted-foreground">{recheck.className || recheck.studentEmail}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="max-w-[150px] truncate">{recheck.examTitle}</span>
                  </div>
                </TableCell>
                <TableCell>
                  {recheck.questionNumber 
                    ? `Q${recheck.questionNumber}`
                    : <span className="text-muted-foreground">Full Paper</span>}
                </TableCell>
                <TableCell>
                  {format(new Date(recheck.requestedAt), "MMM d, yyyy")}
                </TableCell>
                <TableCell>
                  <RecheckStatusBadge status={recheck.status} />
                </TableCell>
                {!showActions && (
                  <TableCell>
                    {recheck.marksChanged && (
                      <span className="text-sm">
                        <span className="line-through text-muted-foreground">{recheck.previousMarks}</span>
                        {" → "}
                        <span className="font-medium text-green-600">{recheck.newMarks}</span>
                      </span>
                    )}
                    {!recheck.marksChanged && recheck.status === "completed" && (
                      <span className="text-sm text-muted-foreground">No change</span>
                    )}
                  </TableCell>
                )}
                <TableCell className="text-right">
                  {showActions ? (
                    <div className="flex justify-end gap-2">
                      <Button 
                        size="sm" 
                        variant="default"
                        onClick={() => onResolve(recheck, "completed")}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        Review
                      </Button>
                      <Button 
                        size="sm" 
                        variant="destructive"
                        onClick={() => onResolve(recheck, "rejected")}
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost">
                      <Eye className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function RecheckStatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "default" | "secondary" | "destructive"; label: string; icon: typeof Clock }> = {
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
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-64" />
    </div>
  );
}
