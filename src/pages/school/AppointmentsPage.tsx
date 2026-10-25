import { useState } from "react";
import { useUserRole } from "@/hooks/useUserRole";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { useAppointments } from "@/hooks/useAppointments";
import { BookAppointmentDialog } from "@/components/appointments/BookAppointmentDialog";
import { AppointmentManagementPanel } from "@/components/appointments/AppointmentManagementPanel";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Calendar, CalendarPlus, Loader2 } from "lucide-react";

import { PageShell, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/surfaces";

interface AppointmentRow {
  id: string;
  teacher?: { full_name?: string | null } | null;
  appointment_date: string;
  start_time?: string | null;
  end_time?: string | null;
  purpose?: string | null;
  teacher_notes?: string | null;
  status: string;
}

export default function AppointmentsPage() {
  const { data: roleInfo } = useUserRole();
  const isTeacher = roleInfo?.isTeacher ?? false;

  if (isTeacher) {
    return (
      <PageShell>
        <PageHeader
          icon={<Calendar className="h-5 w-5" />}
          title="Appointments"
          subtitle="Manage student requests"
        />
        <AppointmentManagementPanel />
      </PageShell>
    );
  }

  return <StudentAppointmentsView />;
}

function StudentAppointmentsView() {
  const { data: roleInfo } = useUserRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const { appointments, isLoading } = useAppointments(institutionId, "student");
  const [bookOpen, setBookOpen] = useState(false);

  const rows = (appointments ?? []) as AppointmentRow[];

  const statusColor = (s: string) => {
    if (s === "approved") return "bg-emerald-500/10 text-emerald-700 border-emerald-200";
    if (s === "rejected" || s === "cancelled") return "bg-rose-500/10 text-rose-700 border-rose-200";
    if (s === "completed") return "bg-sky-500/10 text-sky-700 border-sky-200";
    return "bg-amber-500/10 text-amber-700 border-amber-200";
  };

  return (
    <PageShell>
      <PageHeader
        icon={<Calendar className="h-5 w-5" />}
        title="My Appointments"
        subtitle="Schedule meetings with your teachers"
        primaryAction={{
          label: "Book Appointment",
          icon: <CalendarPlus className="h-4 w-4" />,
          onClick: () => setBookOpen(true),
        }}
      />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Calendar className="h-7 w-7" />}
          title="No appointments yet"
          description="Book one with a teacher to get started."
          action={{
            label: "Book Appointment",
            icon: <CalendarPlus className="h-4 w-4" />,
            onClick: () => setBookOpen(true),
          }}
        />
      ) : (
        <div className="space-y-3">
          {rows.map(apt => (
            <article
              key={apt.id}
              className="surface-card frosted-shadow rounded-2xl p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-900 truncate">
                    {apt.teacher?.full_name ?? "Teacher"}
                  </p>
                  <p className="text-xs text-ink-600 mt-0.5">
                    {format(new Date(apt.appointment_date), "dd MMM yyyy")}
                    {apt.start_time && apt.end_time
                      ? ` · ${apt.start_time.slice(0, 5)} – ${apt.end_time.slice(0, 5)}`
                      : ""}
                  </p>
                  {apt.purpose && <p className="text-sm mt-2">{apt.purpose}</p>}
                  {apt.teacher_notes && (
                    <p className="text-xs text-brand-primary mt-1">Note: {apt.teacher_notes}</p>
                  )}
                </div>
                <Badge variant="outline" className={`${statusColor(apt.status)} shrink-0 capitalize`}>
                  {apt.status}
                </Badge>
              </div>
            </article>
          ))}
        </div>
      )}

      <BookAppointmentDialog open={bookOpen} onOpenChange={setBookOpen} />
    </PageShell>
  );
}
