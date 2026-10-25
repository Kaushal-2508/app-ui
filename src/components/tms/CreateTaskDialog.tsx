import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Loader2, ClipboardList } from "lucide-react";
import { useCreateTaskGroup, TaskType } from "@/hooks/useTasks";
import { useInstitutionMembers } from "@/hooks/useWingMembers";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/hooks/useAuth";
import { AssigneesField } from "./AssigneesField";
import { SupervisorsField } from "./SupervisorsField";

interface CreateTaskDialogProps {
  institutionId: string | null;
  trigger?: React.ReactNode;
  /**
   * Controlled open state. Pass alongside `onOpenChange` to drive the
   * dialog from an external trigger (e.g. a PageHeader primary action
   * button on desktop while the MobileFab covers mobile/tablet). When
   * omitted the dialog manages its own internal state.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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

export function CreateTaskDialog({
  institutionId,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: CreateTaskDialogProps) {
  // Dual-mode: when both `open` and `onOpenChange` are passed, behave as
  // a controlled component (caller drives state). Otherwise fall back to
  // internal state so existing call-sites that just pass a `trigger`
  // keep working unchanged.
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined && controlledOnOpenChange !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? controlledOnOpenChange : setInternalOpen;
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    taskType: "" as TaskType | "",
    priority: 2,
    dueDate: "",
  });

  // Ticked supervisor ids, in the order they were ticked.
  const [supervisorIds, setSupervisorIds] = useState<string[]>([]);

  // Ticked assignee ids, in the order they were ticked.
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);

  // Fetch ALL members in the institution (teachers, coordinators, principals)
  const { data: institutionMembers, isLoading: membersLoading } = useInstitutionMembers(institutionId);

  // Identity from the local session — never a JWT-less auth.getUser() (§23).
  const { user: currentUser } = useAuth();

  // "Assign to everyone" is an admin-only power. Coordinators and teachers can
  // still tick as many people as they like, one by one.
  const { data: userRole } = useUserRole();
  const canAssignEveryone = Boolean(userRole?.isSchoolAdmin || userRole?.isSuperAdmin);

  // Assignee options (exclude self)
  const assigneeOptions = useMemo(() => {
    if (!institutionMembers) return [];

    return institutionMembers
      .filter(m => m.id !== currentUser?.id)
      .map((member) => ({
        value: member.id,
        label: member.full_name,
        description: `${member.roleName} · ${member.email}`,
      }));
  }, [institutionMembers, currentUser?.id]);

  // Supervisor options: everyone except self and anyone already assigned. The
  // "None" entry is added by SupervisorRowsField.
  const supervisorOptions = useMemo(() => {
    if (!institutionMembers) return [];

    const assignedIds = new Set(assigneeIds);
    return institutionMembers
      .filter(m => !assignedIds.has(m.id) && m.id !== currentUser?.id)
      .map((member) => ({
        value: member.id,
        label: member.full_name,
        description: `${member.roleName} · ${member.email}`,
      }));
  }, [institutionMembers, assigneeIds, currentUser?.id]);

  const createTaskGroup = useCreateTaskGroup();

  const handleAssigneesChange = (next: string[]) => {
    setAssigneeIds(next);
    // Anyone just assigned can no longer also be a supervisor; the RPC rejects
    // that overlap, so drop them here rather than fail on submit.
    const assigned = new Set(next);
    setSupervisorIds((prev) => prev.filter((id) => !assigned.has(id)));
  };

  const canSubmit =
    Boolean(institutionId) &&
    Boolean(formData.taskType) &&
    formData.title.trim().length > 0 &&
    assigneeIds.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canSubmit || !institutionId || createTaskGroup.isPending) return;

    try {
      await createTaskGroup.mutateAsync({
        title: formData.title,
        description: formData.description || undefined,
        taskType: formData.taskType as TaskType,
        priority: formData.priority,
        dueDate: formData.dueDate || undefined,
        institutionId,
        supervisorIds,
        // Everyone gets the same title and description. The RPC still accepts
        // per-person overrides; the dialog just no longer offers them.
        assignees: assigneeIds.map((assigneeId) => ({ assigneeId })),
      });
      handleClose();
    } catch {
      // The mutation's onError already surfaced a translated message. Keep
      // the dialog open so the entered task isn't lost.
    }
  };

  const handleClose = () => {
    setOpen(false);
    setFormData({
      title: "",
      description: "",
      taskType: "",
      priority: 2,
      dueDate: "",
    });
    setAssigneeIds([]);
    setSupervisorIds([]);
  };

  // Service-worker dirty-form contract (§17): while there is unsaved input,
  // an update must toast rather than silently reload the page.
  const isDirty =
    formData.title.trim().length > 0 ||
    formData.description.trim().length > 0 ||
    assigneeIds.length > 0;

  const assigneeCount = assigneeIds.length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline">
            <ClipboardList className="h-4 w-4 mr-2" />
            Assign Task
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit} data-dirty={isDirty ? "true" : undefined}>
          <DialogHeader>
            <DialogTitle>Assign New Task</DialogTitle>
            <DialogDescription>
              Create and assign a task to one or more people in your institution
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Task Title *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., Evaluate Class 10 Math Papers"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Additional details about the task..."
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

            <AssigneesField
              values={assigneeIds}
              onChange={handleAssigneesChange}
              options={assigneeOptions}
              canAssignEveryone={canAssignEveryone}
              loading={membersLoading}
            />

            <div className="grid gap-2">
              <Label htmlFor="dueDate">Due Date</Label>
              <Input
                id="dueDate"
                type="date"
                value={formData.dueDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
              />
            </div>

            <SupervisorsField
              values={supervisorIds}
              onChange={setSupervisorIds}
              options={supervisorOptions}
              loading={membersLoading}
              disabled={assigneeCount === 0}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createTaskGroup.isPending || !canSubmit}
            >
              {createTaskGroup.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {assigneeCount > 1 ? `Assign to ${assigneeCount} People` : "Assign Task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
