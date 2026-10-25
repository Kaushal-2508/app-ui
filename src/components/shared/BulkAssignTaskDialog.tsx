import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Loader2 } from "lucide-react";
import { useCreateTask, TaskType } from "@/hooks/useTasks";
import { useInstitutionMembers } from "@/hooks/useWingMembers";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface BulkAssignTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignees: Array<{ id: string; full_name: string }>;
  institutionId: string;
}

const taskTypes: { value: TaskType; label: string }[] = [
  { value: "exam_related", label: "Exam Related" },
  { value: "academic_content", label: "Academic Content" },
  { value: "administrative", label: "Administrative" },
  { value: "student_support", label: "Student Support" },
  { value: "general", label: "General" },
];

const priorities = [
  { value: "1", label: "Low" },
  { value: "2", label: "Medium" },
  { value: "3", label: "High" },
];

export function BulkAssignTaskDialog({
  open,
  onOpenChange,
  assignees,
  institutionId,
}: BulkAssignTaskDialogProps) {
  const { toast } = useToast();
  const createTask = useCreateTask();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    taskType: "" as TaskType | "",
    priority: 2,
    dueDate: "",
    supervisorId: "",
  });

  const { data: institutionMembers, isLoading: membersLoading } = useInstitutionMembers(institutionId);

  const { data: currentUser } = useQuery({
    queryKey: ["current-user-id"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },
  });

  const assigneeIds = new Set(assignees.map(a => a.id));

  const supervisorOptions = useMemo(() => {
    if (!institutionMembers) return [{ value: "__none__", label: "None (No supervisor)" }];
    const members = institutionMembers
      .filter(m => !assigneeIds.has(m.id) && m.id !== currentUser?.id)
      .map((member) => ({
        value: member.id,
        label: member.full_name,
        description: `${member.roleName} · ${member.email}`,
      }));
    return [{ value: "__none__", label: "None (No supervisor)" }, ...members];
  }, [institutionMembers, assigneeIds, currentUser?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.taskType || assignees.length === 0) return;

    setIsSubmitting(true);
    let successCount = 0;
    let failCount = 0;

    for (const assignee of assignees) {
      try {
        await createTask.mutateAsync({
          title: formData.title,
          description: formData.description || undefined,
          taskType: formData.taskType as TaskType,
          priority: formData.priority,
          dueDate: formData.dueDate || undefined,
          assigneeId: assignee.id,
          institutionId,
          supervisorId: formData.supervisorId || undefined,
        });
        successCount++;
      } catch {
        failCount++;
      }
    }

    setIsSubmitting(false);

    if (successCount > 0) {
      toast({
        title: "Tasks Assigned",
        description: `Task assigned to ${successCount} person(s)${failCount > 0 ? `. ${failCount} failed.` : "."}`,
      });
    }
    if (failCount > 0 && successCount === 0) {
      toast({
        title: "Failed to assign tasks",
        description: "Could not assign the task to any of the selected users.",
        variant: "destructive",
      });
    }

    handleClose();
  };

  const handleClose = () => {
    onOpenChange(false);
    setFormData({
      title: "",
      description: "",
      taskType: "",
      priority: 2,
      dueDate: "",
      supervisorId: "",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Bulk Assign Task</DialogTitle>
            <DialogDescription>
              Assign the same task to {assignees.length} selected person(s)
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Assignees badges */}
            <div className="grid gap-2">
              <Label>Assigning to</Label>
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                {assignees.map((a) => (
                  <Badge key={a.id} variant="secondary" className="text-xs">
                    {a.full_name}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="bulk-title">Task Title *</Label>
              <Input
                id="bulk-title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., Submit weekly report"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="bulk-description">Description</Label>
              <Textarea
                id="bulk-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Additional details..."
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Task Type *</Label>
                <SearchableSelect
                  value={formData.taskType}
                  onValueChange={(value) => setFormData({ ...formData, taskType: value as TaskType })}
                  placeholder="Select type"
                  searchPlaceholder="Search types..."
                  options={taskTypes.map((type) => ({
                    value: type.value,
                    label: type.label,
                  }))}
                />
              </div>

              <div className="grid gap-2">
                <Label>Priority *</Label>
                <SearchableSelect
                  value={String(formData.priority)}
                  onValueChange={(value) => setFormData({ ...formData, priority: Number(value) })}
                  placeholder="Select priority"
                  searchPlaceholder="Search..."
                  options={priorities.map((p) => ({
                    value: p.value,
                    label: p.label,
                  }))}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="bulk-dueDate">Due Date</Label>
              <Input
                id="bulk-dueDate"
                type="date"
                value={formData.dueDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
              />
            </div>

            <div className="grid gap-2">
              <Label>Tag Supervisor (Optional)</Label>
              <SearchableSelect
                value={formData.supervisorId || "__none__"}
                onValueChange={(value) => setFormData({ ...formData, supervisorId: value === "__none__" ? "" : value })}
                placeholder={membersLoading ? "Loading..." : "Select supervisor..."}
                searchPlaceholder="Search by name..."
                disabled={membersLoading}
                options={supervisorOptions}
                emptyText="No supervisors available"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !formData.taskType || !formData.title}
            >
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Assign to {assignees.length} Person(s)
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
