import { useAppointments } from "@/hooks/useAppointments";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { useUserRole } from "@/hooks/useUserRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Check, X, CheckCircle2, Loader2 } from "lucide-react";

export function AppointmentManagementPanel() {
  const { data: roleInfo } = useUserRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const { appointments, isLoading, updateAppointment } = useAppointments(institutionId, "teacher");

  const statusColor = (s: string) => {
    if (s === "approved") return "bg-emerald-500/10 text-emerald-600 border-emerald-200";
    if (s === "rejected" || s === "cancelled") return "bg-red-500/10 text-red-600 border-red-200";
    if (s === "completed") return "bg-blue-500/10 text-blue-600 border-blue-200";
    return "bg-amber-500/10 text-amber-600 border-amber-200";
  };

  const pending = appointments.filter((a: any) => a.status === "pending");
  const others = appointments.filter((a: any) => a.status !== "pending");

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Loading appointments...</div>;

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-base">Pending Requests ({pending.length})</CardTitle></CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-center py-6 text-sm text-muted-foreground">No pending appointment requests.</p>
          ) : (
            <div className="space-y-3">
              {pending.map((apt: any) => (
                <div key={apt.id} className="p-4 rounded-xl border bg-muted/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{apt.student?.full_name}</p>
                    <span className="text-xs text-muted-foreground">{format(new Date(apt.appointment_date), "dd MMM yyyy")}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{apt.start_time?.slice(0, 5)} – {apt.end_time?.slice(0, 5)}</p>
                  <p className="text-sm">{apt.purpose}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-emerald-600" onClick={() => updateAppointment.mutate({ id: apt.id, status: "approved" })} disabled={updateAppointment.isPending}>
                      <Check className="h-3.5 w-3.5 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" className="text-red-600" onClick={() => updateAppointment.mutate({ id: apt.id, status: "rejected" })} disabled={updateAppointment.isPending}>
                      <X className="h-3.5 w-3.5 mr-1" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {others.length > 0 && (
        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="text-base">All Appointments</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {others.map((apt: any) => (
                <div key={apt.id} className="flex items-center justify-between p-3 rounded-xl border bg-muted/10">
                  <div>
                    <p className="text-sm font-medium">{apt.student?.full_name}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(apt.appointment_date), "dd MMM")} • {apt.start_time?.slice(0, 5)} – {apt.end_time?.slice(0, 5)}</p>
                    <p className="text-xs text-muted-foreground">{apt.purpose}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={statusColor(apt.status)}>{apt.status}</Badge>
                    {apt.status === "approved" && (
                      <Button size="sm" variant="ghost" onClick={() => updateAppointment.mutate({ id: apt.id, status: "completed" })}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
