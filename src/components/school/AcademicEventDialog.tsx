import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import type {
  AcademicCalendarEvent,
  AcademicEventType,
  EventInput,
} from "@/hooks/useAcademicCalendar";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate: string | null;              // ISO yyyy-mm-dd
  existing: AcademicCalendarEvent | null;   // null ⇒ creating
  events: AcademicCalendarEvent[];          // same-year context for conflict detection
  onSubmit: (payload: EventInput) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  isSubmitting?: boolean;
}

const EVENT_TYPE_OPTIONS: { value: AcademicEventType; label: string }[] = [
  { value: "working_day",   label: "Working day (override)" },
  { value: "holiday",       label: "Holiday" },
  { value: "exam_block",    label: "Exam block" },
  { value: "ptm",           label: "Parent-teacher meeting" },
  { value: "special_event", label: "Special event" },
];

export function AcademicEventDialog({
  open,
  onOpenChange,
  selectedDate,
  existing,
  events,
  onSubmit,
  onDelete,
  isSubmitting = false,
}: Props) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState<string>("");
  const [eventType, setEventType] = useState<AcademicEventType>("holiday");
  const [description, setDescription] = useState("");
  const [confirmHolidayOverExam, setConfirmHolidayOverExam] = useState<null | {
    payload: EventInput;
  }>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Reset form whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    if (existing) {
      setTitle(existing.title);
      setDate(existing.date);
      setEndDate(existing.end_date ?? "");
      setEventType(existing.event_type);
      setDescription(existing.description ?? "");
    } else {
      setTitle("");
      setDate(selectedDate ?? "");
      setEndDate("");
      setEventType("holiday");
      setDescription("");
    }
  }, [open, existing, selectedDate]);

  const spanIncludes = (start: string, end: string | null, d: string) => {
    const s = new Date(start + "T00:00:00");
    const e = new Date((end ?? start) + "T00:00:00");
    const t = new Date(d + "T00:00:00");
    return t.getTime() >= s.getTime() && t.getTime() <= e.getTime();
  };

  const holidayTouchingExamBlock = (): boolean => {
    if (eventType !== "holiday") return false;
    const start = date;
    const end = endDate || null;
    if (!start) return false;
    // Expand holiday span & look for any overlapping exam_block
    const cur = new Date(start + "T00:00:00");
    const last = new Date((end ?? start) + "T00:00:00");
    while (cur.getTime() <= last.getTime()) {
      const iso = cur.toISOString().slice(0, 10);
      const hit = events.some(
        (e) =>
          e.event_type === "exam_block" &&
          e.id !== existing?.id &&
          spanIncludes(e.date, e.end_date, iso),
      );
      if (hit) return true;
      cur.setDate(cur.getDate() + 1);
    }
    return false;
  };

  const handleSubmit = async () => {
    if (!title.trim() || !date) return;

    const payload: EventInput = {
      title: title.trim(),
      date,
      end_date: endDate || null,
      event_type: eventType,
      description: description.trim() || null,
    };

    if (holidayTouchingExamBlock()) {
      setConfirmHolidayOverExam({ payload });
      return;
    }

    await onSubmit(payload);
    onOpenChange(false);
  };

  const confirmAndSubmit = async () => {
    if (!confirmHolidayOverExam) return;
    await onSubmit(confirmHolidayOverExam.payload);
    setConfirmHolidayOverExam(null);
    onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!existing || !onDelete) return;
    await onDelete(existing.id);
    setDeleteConfirmOpen(false);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{existing ? "Edit event" : "Add event"}</DialogTitle>
            <DialogDescription>
              {existing
                ? "Update the details for this calendar event."
                : "Add a holiday, exam block, PTM, or other academic event."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="event-title">Title</Label>
              <Input
                id="event-title"
                placeholder="e.g., Diwali, Term 1 Exams, Annual PTM"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="event-date">Date</Label>
                <Input
                  id="event-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-end-date">End date (optional)</Label>
                <Input
                  id="event-end-date"
                  type="date"
                  value={endDate}
                  min={date || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Event type</Label>
              <Select
                value={eventType}
                onValueChange={(v) => setEventType(v as AcademicEventType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="event-description">Description (optional)</Label>
              <Textarea
                id="event-description"
                placeholder="Notes for teachers and students"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            {existing && onDelete && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={isSubmitting}
                className="mr-auto"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !title.trim() || !date}
            >
              {existing ? "Save changes" : "Add event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!confirmHolidayOverExam}
        onOpenChange={(o) => !o && setConfirmHolidayOverExam(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Holiday overlaps an exam block</AlertDialogTitle>
            <AlertDialogDescription>
              One or more dates in this holiday span already have an exam block
              declared. Marking it as a holiday will leave the exam block in
              place but tell teachers it is a non-working day. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAndSubmit}>
              Yes, add holiday
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this event?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the event from the academic calendar. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
