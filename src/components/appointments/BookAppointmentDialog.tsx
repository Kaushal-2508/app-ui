import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppointments } from "@/hooks/useAppointments";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CalendarPlus } from "lucide-react";

import { MobileSheet } from "@/components/shared/sheets";

interface TeacherProfile {
  id: string;
  full_name: string;
}

export interface BookAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BookAppointmentDialog({ open, onOpenChange }: BookAppointmentDialogProps) {
  const { data: roleInfo } = useUserRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const { createAppointment } = useAppointments(institutionId, "student");
  const [teacherId, setTeacherId] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("09:30");
  const [purpose, setPurpose] = useState("");

  const { data: teachers } = useQuery({
    queryKey: ["institution-teachers", institutionId],
    queryFn: async (): Promise<TeacherProfile[]> => {
      if (!institutionId) return [];
      const { data } = await supabase
        .from("user_roles")
        .select("user_id, profiles!inner(id, full_name)")
        .eq("role", "teacher")
        .eq("institution_id", institutionId);
      const rows = (data ?? []) as unknown as Array<{ profiles: TeacherProfile | TeacherProfile[] }>;
      return rows.map(r => Array.isArray(r.profiles) ? r.profiles[0] : r.profiles).filter(Boolean);
    },
    enabled: !!institutionId,
  });

  const handleSubmit = () => {
    if (!institutionId || !teacherId || !date || !purpose.trim()) return;
    createAppointment.mutate({
      institution_id: institutionId,
      teacher_id: teacherId,
      appointment_date: date,
      start_time: startTime,
      end_time: endTime,
      purpose: purpose.trim(),
    });
    onOpenChange(false);
    setTeacherId("");
    setDate("");
    setPurpose("");
  };

  const submitDisabled =
    createAppointment.isPending || !teacherId || !date || !purpose.trim();

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Book an Appointment"
      icon={<CalendarPlus className="h-5 w-5" />}
      primaryAction={{
        label: "Submit Request",
        onClick: handleSubmit,
        disabled: submitDisabled,
        loading: createAppointment.isPending,
      }}
      secondaryAction={{
        label: "Cancel",
        onClick: () => onOpenChange(false),
      }}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="appt-teacher">Teacher</Label>
          <Select value={teacherId} onValueChange={setTeacherId}>
            <SelectTrigger id="appt-teacher">
              <SelectValue placeholder="Select Teacher" />
            </SelectTrigger>
            <SelectContent>
              {teachers?.map(t => (
                <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="appt-date">Date</Label>
          <Input
            id="appt-date"
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="appt-start">Start Time</Label>
            <Input
              id="appt-start"
              type="time"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="appt-end">End Time</Label>
            <Input
              id="appt-end"
              type="time"
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="appt-purpose">Purpose</Label>
          <Textarea
            id="appt-purpose"
            placeholder="Purpose of the meeting..."
            value={purpose}
            onChange={e => setPurpose(e.target.value)}
            rows={3}
          />
        </div>
      </div>
    </MobileSheet>
  );
}
