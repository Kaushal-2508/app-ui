import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { Save, Bell, Shield, Clock, Users, Pencil } from "lucide-react";
import {
  useAttendanceSettings,
  useUpsertAttendanceSettings,
  DEFAULT_ATTENDANCE_SETTINGS,
} from "@/hooks/useAttendance";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { useUserRole } from "@/hooks/useUserRole";

const ALL_METHODS = [
  { value: "manual", label: "Manual" },
  { value: "biometric", label: "Biometric" },
  { value: "facial_recognition", label: "Face Recognition" },
  { value: "mobile_checkin", label: "Mobile Check-in" },
];

// "HH:MM:SS" → "HH:MM" for the <input type="time"> value.
const toTimeInput = (value: string) => (value && value.length >= 5 ? value.slice(0, 5) : value);
const fromTimeInput = (value: string) => (value && value.length === 5 ? `${value}:00` : value);

export function AttendanceSettings() {
  const { data: roleInfo } = useUserRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const { data: settings } = useAttendanceSettings(institutionId);
  const upsertMutation = useUpsertAttendanceSettings();

  // Alerts
  const [notifyParents, setNotifyParents] = useState(DEFAULT_ATTENDANCE_SETTINGS.notify_parents_on_absent);
  const [threshold, setThreshold] = useState(DEFAULT_ATTENDANCE_SETTINGS.absent_threshold_days);
  // Tracking methods
  const [enabledMethods, setEnabledMethods] = useState<string[]>(DEFAULT_ATTENDANCE_SETTINGS.tracking_methods);
  // Staff window
  const [checkInTime, setCheckInTime] = useState(DEFAULT_ATTENDANCE_SETTINGS.staff_check_in_time);
  const [checkOutTime, setCheckOutTime] = useState(DEFAULT_ATTENDANCE_SETTINGS.staff_check_out_time);
  const [lateAllowed, setLateAllowed] = useState(DEFAULT_ATTENDANCE_SETTINGS.staff_late_check_in_allowed);
  const [graceMinutes, setGraceMinutes] = useState(DEFAULT_ATTENDANCE_SETTINGS.staff_late_grace_minutes);
  // Substitution
  const [subEnabled, setSubEnabled] = useState(DEFAULT_ATTENDANCE_SETTINGS.staff_substitution_enabled);
  const [maxSubs, setMaxSubs] = useState(DEFAULT_ATTENDANCE_SETTINGS.max_subs_per_teacher_per_day);
  const [coordsInPool, setCoordsInPool] = useState(DEFAULT_ATTENDANCE_SETTINGS.coordinators_in_sub_pool);
  // Student attendance edit window (days back, today included)
  const [editWindowDays, setEditWindowDays] = useState(DEFAULT_ATTENDANCE_SETTINGS.student_attendance_edit_window_days);

  useEffect(() => {
    if (!settings) return;
    const s = settings as Record<string, unknown>;
    if (typeof s.notify_parents_on_absent === "boolean") setNotifyParents(s.notify_parents_on_absent);
    if (typeof s.absent_threshold_days === "number") setThreshold(s.absent_threshold_days);
    if (Array.isArray(s.tracking_methods)) setEnabledMethods(s.tracking_methods as string[]);
    if (typeof s.staff_check_in_time === "string") setCheckInTime(s.staff_check_in_time);
    if (typeof s.staff_check_out_time === "string") setCheckOutTime(s.staff_check_out_time);
    if (typeof s.staff_late_check_in_allowed === "boolean") setLateAllowed(s.staff_late_check_in_allowed);
    if (typeof s.staff_late_grace_minutes === "number") setGraceMinutes(s.staff_late_grace_minutes);
    if (typeof s.staff_substitution_enabled === "boolean") setSubEnabled(s.staff_substitution_enabled);
    if (typeof s.max_subs_per_teacher_per_day === "number") setMaxSubs(s.max_subs_per_teacher_per_day);
    if (typeof s.coordinators_in_sub_pool === "boolean") setCoordsInPool(s.coordinators_in_sub_pool);
    if (typeof s.student_attendance_edit_window_days === "number") setEditWindowDays(s.student_attendance_edit_window_days);
  }, [settings]);

  const toggleMethod = (method: string) => {
    setEnabledMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]
    );
  };

  const handleSave = () => {
    if (!institutionId) return;
    upsertMutation.mutate({
      institution_id: institutionId,
      notify_parents_on_absent: notifyParents,
      absent_threshold_days: threshold,
      tracking_methods: enabledMethods,
      staff_check_in_time: checkInTime,
      staff_check_out_time: checkOutTime,
      staff_late_check_in_allowed: lateAllowed,
      staff_late_grace_minutes: graceMinutes,
      staff_substitution_enabled: subEnabled,
      max_subs_per_teacher_per_day: maxSubs,
      coordinators_in_sub_pool: coordsInPool,
      student_attendance_edit_window_days: editWindowDays,
    });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <DashboardSection
        title="Staff Check-In Window"
        description="The daily window during which teachers and coordinators must check in"
        icon={Clock}
        iconGradient="from-teal-400 to-cyan-500"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Check-in by</Label>
              <Input
                type="time"
                value={toTimeInput(checkInTime)}
                onChange={(e) => setCheckInTime(fromTimeInput(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <Label>Check-out by</Label>
              <Input
                type="time"
                value={toTimeInput(checkOutTime)}
                onChange={(e) => setCheckOutTime(fromTimeInput(e.target.value))}
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="late-allowed">Allow late check-in</Label>
              <p className="text-xs text-muted-foreground">Within the grace window below; later than that = absent</p>
            </div>
            <Switch id="late-allowed" checked={lateAllowed} onCheckedChange={setLateAllowed} />
          </div>
          <div className="space-y-1">
            <Label>Grace period (minutes)</Label>
            <Input
              type="number"
              min={0}
              max={240}
              value={graceMinutes}
              disabled={!lateAllowed}
              onChange={(e) => setGraceMinutes(parseInt(e.target.value) || 0)}
              className="w-32"
            />
          </div>
        </div>
      </DashboardSection>

      <DashboardSection
        title="Substitution Policy"
        description="What happens when a teacher misses check-in"
        icon={Users}
        iconGradient="from-violet-400 to-purple-500"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="sub-enabled">Auto-substitution enabled</Label>
              <p className="text-xs text-muted-foreground">Generate pending substitutions at the cutoff time</p>
            </div>
            <Switch id="sub-enabled" checked={subEnabled} onCheckedChange={setSubEnabled} />
          </div>
          <div className="space-y-1">
            <Label>Max substitutions per teacher per day</Label>
            <Input
              type="number"
              min={0}
              max={10}
              value={maxSubs}
              disabled={!subEnabled}
              onChange={(e) => setMaxSubs(parseInt(e.target.value) || 0)}
              className="w-32"
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="coords-pool">Include coordinators in substitute pool</Label>
              <p className="text-xs text-muted-foreground">Off by default. Coordinators don't usually take subjects</p>
            </div>
            <Switch
              id="coords-pool"
              checked={coordsInPool}
              disabled={!subEnabled}
              onCheckedChange={setCoordsInPool}
            />
          </div>
        </div>
      </DashboardSection>

      <DashboardSection
        title="Student Attendance"
        description="How far back a teacher can view-and-edit or backfill class attendance"
        icon={Pencil}
        iconGradient="from-blue-400 to-indigo-500"
      >
        <div className="space-y-1">
          <Label>Edit window (days back, today included)</Label>
          <Input
            type="number"
            min={0}
            max={30}
            value={editWindowDays}
            onChange={(e) => setEditWindowDays(parseInt(e.target.value) || 0)}
            className="w-32"
          />
          <p className="text-xs text-muted-foreground">
            Default 2: teachers can change today, yesterday and the day before. Older dates are
            view-only for teachers; only admins can edit them.
          </p>
        </div>
      </DashboardSection>

      <DashboardSection
        title="Alerts"
        description="Configure parent notification rules"
        icon={Bell}
        iconGradient="from-amber-400 to-yellow-500"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="notify-parents">Notify parents on absence</Label>
            <Switch id="notify-parents" checked={notifyParents} onCheckedChange={setNotifyParents} />
          </div>
          <div className="space-y-1">
            <Label>Absence alert threshold (consecutive days)</Label>
            <Input
              type="number"
              min={1}
              max={30}
              value={threshold}
              onChange={(e) => setThreshold(parseInt(e.target.value) || 3)}
              className="w-32"
            />
          </div>
        </div>
      </DashboardSection>

      <DashboardSection
        title="Tracking Methods"
        description="Enable or disable attendance tracking methods"
        icon={Shield}
        iconGradient="from-green-400 to-emerald-500"
      >
        <div className="flex flex-wrap gap-2">
          {ALL_METHODS.map((m) => {
            const active = enabledMethods.includes(m.value);
            return (
              <button
                key={m.value}
                onClick={() => toggleMethod(m.value)}
                className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                  active ? "bg-primary text-primary-foreground border-primary" : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/60"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </DashboardSection>

      <Button onClick={handleSave} disabled={upsertMutation.isPending}>
        <Save className="h-4 w-4 mr-2" />
        {upsertMutation.isPending ? "Saving..." : "Save Settings"}
      </Button>
    </div>
  );
}
