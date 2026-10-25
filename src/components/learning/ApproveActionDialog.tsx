import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Check, X, BookOpen, FileText, RefreshCcw, GraduationCap } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { FIELD_FILL } from "@/lib/fieldStyles";
import {
  useApproveLearningAction,
  useDeclineLearningAction,
  type LearningAction,
} from "@/hooks/useLearningActions";

const actionTypeIcons: Record<string, typeof BookOpen> = {
  revision: BookOpen,
  practice: FileText,
  retest: RefreshCcw,
  study_material: GraduationCap,
};

const actionTypeLabels: Record<string, string> = {
  revision: "Revision",
  practice: "Practice",
  retest: "Retest",
  study_material: "Study Material",
};

interface ApproveActionDialogProps {
  action: LearningAction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ApproveActionDialog({
  action,
  open,
  onOpenChange,
}: ApproveActionDialogProps) {
  const [dueDate, setDueDate] = useState<Date | undefined>();
  const [notes, setNotes] = useState("");
  
  const approveMutation = useApproveLearningAction();
  const declineMutation = useDeclineLearningAction();

  if (!action) return null;

  const Icon = actionTypeIcons[action.action_type] || BookOpen;

  const handleApprove = () => {
    approveMutation.mutate(
      { actionId: action.id, dueDate: dueDate?.toISOString() },
      {
        onSuccess: () => {
          onOpenChange(false);
          setDueDate(undefined);
          setNotes("");
        },
      }
    );
  };

  const handleDecline = () => {
    declineMutation.mutate(action.id, {
      onSuccess: () => {
        onOpenChange(false);
        setDueDate(undefined);
        setNotes("");
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            Review Learning Action
          </DialogTitle>
          <DialogDescription>
            Review and approve or decline this suggested learning action.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Action Details */}
          <div className="p-4 bg-muted/50 rounded-lg space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Student</Label>
              <p className="font-medium">{action.student?.full_name}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Action</Label>
              <p className="font-medium">{action.title}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {actionTypeLabels[action.action_type]}
              </Badge>
              {action.topic?.topic_name && (
                <Badge variant="secondary">{action.topic.topic_name}</Badge>
              )}
              {action.subject?.name && (
                <Badge variant="secondary">{action.subject.name}</Badge>
              )}
            </div>
            {action.description && (
              <div>
                <Label className="text-xs text-muted-foreground">Description</Label>
                <p className="text-sm">{action.description}</p>
              </div>
            )}
            {action.exam?.title && (
              <div>
                <Label className="text-xs text-muted-foreground">Source Exam</Label>
                <p className="text-sm">{action.exam.title}</p>
              </div>
            )}
          </div>

          {/* Due Date */}
          <div className="space-y-2">
            <Label>Due Date (Optional)</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    FIELD_FILL,
                    !dueDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dueDate ? format(dueDate, "PPP") : "Select a due date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dueDate}
                  onSelect={setDueDate}
                  disabled={(date) => date < new Date()}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes for Student (Optional)</Label>
            <Textarea
              placeholder="Add any additional instructions or notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleDecline}
            disabled={declineMutation.isPending}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <X className="h-4 w-4 mr-2" />
            Decline
          </Button>
          <Button
            onClick={handleApprove}
            disabled={approveMutation.isPending}
            className="bg-green-600 hover:bg-green-700"
          >
            <Check className="h-4 w-4 mr-2" />
            Approve & Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
