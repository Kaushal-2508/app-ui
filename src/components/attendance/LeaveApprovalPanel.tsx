import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLeaveRequests } from "@/hooks/useLeaveRequests";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { useUserRole } from "@/hooks/useUserRole";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Check, X, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatClassName } from "@/lib/utils";
import { getDisplayName } from "@/lib/displayName";

export function LeaveApprovalPanel() {
  const { data: roleInfo } = useUserRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const { leaveRequests, isLoading, reviewLeaveRequest } = useLeaveRequests(institutionId, "staff");
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [action, setAction] = useState<"approved" | "rejected">("approved");

  const handleReview = () => {
    if (!reviewingId) return;
    reviewLeaveRequest.mutate({ id: reviewingId, status: action, reviewer_notes: notes || undefined });
    setReviewingId(null);
    setNotes("");
  };

  const statusColor = (s: string) => {
    if (s === "approved") return "bg-emerald-500/10 text-emerald-600 border-emerald-200";
    if (s === "rejected") return "bg-red-500/10 text-red-600 border-red-200";
    return "bg-amber-500/10 text-amber-600 border-amber-200";
  };

  const pending = leaveRequests.filter((lr: any) => lr.status === "pending");
  const reviewed = leaveRequests.filter((lr: any) => lr.status !== "pending");

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-base">Pending Leave Requests ({pending.length})</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-6 text-muted-foreground">Loading...</div>
          ) : pending.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">No pending requests.</div>
          ) : (
            <div className="space-y-3">
              {pending.map((lr: any) => (
                <div key={lr.id} className="p-4 rounded-xl border bg-muted/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{getDisplayName(lr.student)}</p>
                      <p className="text-xs text-muted-foreground">{formatClassName((lr.class as any)?.name || "", (lr.class as any)?.section)}</p>
                    </div>
                    <Badge variant="outline" className="capitalize">{lr.leave_type}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(lr.start_date), "dd MMM")} – {format(new Date(lr.end_date), "dd MMM yyyy")}
                  </p>
                  <p className="text-sm">{lr.reason}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-emerald-600" onClick={() => { setReviewingId(lr.id); setAction("approved"); }}>
                      <Check className="h-3.5 w-3.5 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" className="text-red-600" onClick={() => { setReviewingId(lr.id); setAction("rejected"); }}>
                      <X className="h-3.5 w-3.5 mr-1" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {reviewed.length > 0 && (
        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="text-base">Reviewed Requests</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {reviewed.map((lr: any) => (
                <div key={lr.id} className="flex items-center justify-between p-3 rounded-xl border bg-muted/10">
                  <div>
                    <p className="text-sm font-medium">{lr.student?.full_name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{lr.leave_type} • {format(new Date(lr.start_date), "dd MMM")} – {format(new Date(lr.end_date), "dd MMM")}</p>
                  </div>
                  <Badge variant="outline" className={statusColor(lr.status)}>{lr.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!reviewingId} onOpenChange={(open) => !open && setReviewingId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{action === "approved" ? "Approve" : "Reject"} Leave Request</DialogTitle></DialogHeader>
          <Textarea placeholder="Add notes (optional)..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          <Button onClick={handleReview} disabled={reviewLeaveRequest.isPending}>
            {reviewLeaveRequest.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Confirm {action === "approved" ? "Approval" : "Rejection"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
