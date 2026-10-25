import { useState } from "react";
import { useStudentRemarks, useCreateRemark, type RemarkCategory } from "@/hooks/useStudentRemarks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageSquare, Plus, BookOpen, AlertTriangle, TrendingUp, MessageCircle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface Props {
  studentId: string;
  studentName?: string;
  institutionId: string;
  examId?: string;
  compact?: boolean;
}

const categoryConfig: Record<RemarkCategory, { label: string; icon: typeof MessageSquare; color: string }> = {
  exam: { label: "Exam", icon: BookOpen, color: "bg-blue-500/10 text-blue-600" },
  topic: { label: "Chapter", icon: MessageCircle, color: "bg-purple-500/10 text-purple-600" },
  behaviour: { label: "Behaviour", icon: AlertTriangle, color: "bg-amber-500/10 text-amber-600" },
  improvement: { label: "Improvement", icon: TrendingUp, color: "bg-green-500/10 text-green-600" },
  general: { label: "General", icon: MessageSquare, color: "bg-muted text-muted-foreground" },
};

export function StudentRemarksPanel({ studentId, studentName, institutionId, examId, compact = false }: Props) {
  const { data: remarks, isLoading } = useStudentRemarks(studentId);
  const createRemark = useCreateRemark();
  const [addOpen, setAddOpen] = useState(false);
  const [category, setCategory] = useState<RemarkCategory>("general");
  const [remarkText, setRemarkText] = useState("");

  const handleSubmit = () => {
    if (!remarkText.trim()) return;
    createRemark.mutate(
      { studentId, institutionId, examId, category, remarkText: remarkText.trim() },
      { onSuccess: () => { setAddOpen(false); setRemarkText(""); setCategory("general"); } }
    );
  };

  if (isLoading) {
    return <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium flex items-center gap-1.5">
          <MessageSquare className="h-4 w-4" />
          Remarks {studentName && `for ${studentName}`}
        </h4>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Remark
        </Button>
      </div>

      {(!remarks || remarks.length === 0) ? (
        <p className="text-xs text-muted-foreground py-2">No remarks yet</p>
      ) : (
        <div className={`space-y-2 ${compact ? "max-h-48 overflow-y-auto" : ""}`}>
          {remarks.map((r) => {
            const config = categoryConfig[r.category];
            const Icon = config.icon;
            return (
              <div key={r.id} className="bg-muted/50 rounded-md p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className={`text-xs ${config.color}`}>
                      <Icon className="h-3 w-3 mr-1" />{config.label}
                    </Badge>
                    {r.subject && <span className="text-xs text-muted-foreground">{r.subject.name}</span>}
                  </div>
                  <span className="text-xs text-muted-foreground">{format(new Date(r.created_at), "MMM d, yyyy")}</span>
                </div>
                <p className="text-sm">{r.remark_text}</p>
                {r.teacher && <p className="text-xs text-muted-foreground">{r.teacher.full_name}</p>}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Remark {studentName && `for ${studentName}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Select value={category} onValueChange={(v) => setCategory(v as RemarkCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(categoryConfig).map(([key, cfg]) => (
                  <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea placeholder="Enter your remark..." value={remarkText} onChange={(e) => setRemarkText(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!remarkText.trim() || createRemark.isPending}>
              {createRemark.isPending ? "Saving..." : "Save Remark"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
