import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DashboardSection } from "@/components/ui/dashboard-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QrCode, Hash, Timer, Copy, RefreshCw, Users } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useCreateAttendanceSession, useAttendanceSessions } from "@/hooks/useAttendanceSessions";
import { toast } from "sonner";
import { formatClassName } from "@/lib/utils";
import { sortClassRows } from "@/lib/classSort";

export function MobileCheckinTeacher() {
  const { data: roleInfo } = useUserRole();
  const { user } = useAuth();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const [selectedClass, setSelectedClass] = useState<string>("");
  const [sessionType, setSessionType] = useState<"qr" | "pin">("pin");
  const [expiresMinutes, setExpiresMinutes] = useState<number>(5);
  const [classes, setClasses] = useState<{ id: string; name: string; section: string | null }[]>([]);

  const dateStr = format(new Date(), "yyyy-MM-dd");
  const { data: sessions } = useAttendanceSessions(selectedClass || null, dateStr);
  const createSession = useCreateAttendanceSession();

  const activeSession = sessions?.find((s: any) => s.is_active && new Date(s.expires_at) > new Date());

  useEffect(() => {
    if (!institutionId || !user?.id) return;
    supabase
      .from("class_assignments")
      .select("class_id, classes!class_assignments_class_id_fkey(id, name, section)")
      .eq("user_id", user.id)
      .eq("role", "teacher")
      .then(({ data }) => {
        const uniqueClasses = new Map<string, { id: string; name: string; section: string | null }>();
        (data || []).forEach((d: any) => {
          if (d.classes && !uniqueClasses.has(d.classes.id)) {
            uniqueClasses.set(d.classes.id, d.classes);
          }
        });
        setClasses(sortClassRows(Array.from(uniqueClasses.values()), (c) => c.name, (c) => c.section));
      });
  }, [institutionId, user?.id]);

  const handleCreate = () => {
    if (!institutionId || !selectedClass) return;
    createSession.mutate({
      institution_id: institutionId,
      class_id: selectedClass,
      date: dateStr,
      session_type: sessionType,
      expires_minutes: expiresMinutes,
    });
  };

  const copyCode = () => {
    if (activeSession) {
      navigator.clipboard.writeText(activeSession.session_code);
      toast.success("Code copied to clipboard");
    }
  };

  return (
    <div className="space-y-4">
      <DashboardSection
        title="Mobile Check-in Session"
        description="Generate codes for students to check in via their devices"
        icon={QrCode}
        iconGradient="from-cyan-400 to-blue-500"
      >
        {/* Controls */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground">Class</label>
            <Select value={selectedClass} onValueChange={setSelectedClass}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select class" /></SelectTrigger>
              <SelectContent>
                {classes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{formatClassName(c.name, c.section)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground">Type</label>
            <Select value={sessionType} onValueChange={(v) => setSessionType(v as "qr" | "pin")}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pin"><div className="flex items-center gap-1.5"><Hash className="h-3.5 w-3.5" /> PIN Code</div></SelectItem>
                <SelectItem value="qr"><div className="flex items-center gap-1.5"><QrCode className="h-3.5 w-3.5" /> QR Code</div></SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground">Expires in</label>
            <Select value={expiresMinutes.toString()} onValueChange={(v) => setExpiresMinutes(parseInt(v))}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="2">2 minutes</SelectItem>
                <SelectItem value="5">5 minutes</SelectItem>
                <SelectItem value="10">10 minutes</SelectItem>
                <SelectItem value="15">15 minutes</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button onClick={handleCreate} disabled={!selectedClass || createSession.isPending}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Generate Code
          </Button>
        </div>

        {/* Active Session Display */}
        {activeSession && (
          <Card className="border-2 border-primary/30 bg-primary/5 rounded-2xl mt-4">
            <CardContent className="pt-6">
              <div className="text-center space-y-3">
                <Badge variant="default" className="text-xs">
                  <Timer className="h-3 w-3 mr-1" />
                  Active · expires {format(new Date(activeSession.expires_at), "h:mm a")}
                </Badge>
                
                <div className="text-5xl font-mono font-bold tracking-[0.3em] text-primary">
                  {activeSession.session_code}
                </div>
                
                <p className="text-sm text-muted-foreground">
                  {activeSession.session_type === "pin" 
                    ? "Students enter this PIN on their device to check in"
                    : "Students scan this code to check in"
                  }
                </p>

                <Button variant="outline" size="sm" onClick={copyCode}>
                  <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy Code
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {!activeSession && selectedClass && (
          <div className="text-center py-8 text-muted-foreground mt-4">
            <Users className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p>No active session. Generate a code for students to check in.</p>
          </div>
        )}
      </DashboardSection>
    </div>
  );
}
