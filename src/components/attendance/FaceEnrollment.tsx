import { useState, useEffect, useRef, useCallback } from "react";
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
import { Camera, Check, X, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useFaceEnrollments, useUpsertFaceEnrollment } from "@/hooks/useFaceEnrollments";
import { toast } from "sonner";
import { formatClassName } from "@/lib/utils";
import { sortClassRows } from "@/lib/classSort";

export function FaceEnrollment() {
  const { data: roleInfo } = useUserRole();
  const { user } = useAuth();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const [selectedClass, setSelectedClass] = useState<string>("");
  const [classes, setClasses] = useState<{ id: string; name: string; section: string | null }[]>([]);
  const [capturing, setCapturing] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const { data: enrollments, isLoading } = useFaceEnrollments(selectedClass || null);
  const upsertEnrollment = useUpsertFaceEnrollment();

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

  const startCapture = useCallback(async (studentId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;
      setCapturing(studentId);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch {
      toast.error("Could not access camera. Please allow camera permissions.");
    }
  }, []);

  const stopCapture = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCapturing(null);
  }, []);

  const captureAndEnroll = useCallback(async () => {
    if (!videoRef.current || !capturing || !institutionId) return;

    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);

    const placeholderDescriptor = Array.from({ length: 128 }, () => Math.random());

    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.8));
    const filePath = `${institutionId}/${capturing}.jpg`;
    await supabase.storage.from("face-photos").upload(filePath, blob, { upsert: true });

    const { data: urlData } = supabase.storage.from("face-photos").getPublicUrl(filePath);

    upsertEnrollment.mutate({
      institution_id: institutionId,
      student_id: capturing,
      face_descriptor: placeholderDescriptor,
      photo_url: urlData.publicUrl,
    });

    stopCapture();
  }, [capturing, institutionId, upsertEnrollment, stopCapture]);

  return (
    <div className="space-y-4">
      <DashboardSection
        title="Face Enrollment"
        description="Capture and register student faces for recognition-based attendance"
        icon={Camera}
        iconGradient="from-pink-400 to-rose-500"
      >
        <div className="space-y-1">
          <label className="text-sm font-medium text-muted-foreground">Class</label>
          <Select value={selectedClass} onValueChange={setSelectedClass}>
            <SelectTrigger className="w-[250px]"><SelectValue placeholder="Select class" /></SelectTrigger>
            <SelectContent>
              {classes.map((c) => (
                <SelectItem key={c.id} value={c.id}>{formatClassName(c.name, c.section)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Camera Capture */}
        {capturing && (
          <Card className="border-2 border-primary/30 rounded-2xl mt-4">
            <CardContent className="pt-4 space-y-3">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full max-w-sm mx-auto rounded-lg bg-black aspect-[4/3]"
              />
              <div className="flex gap-2 justify-center">
                <Button onClick={captureAndEnroll} disabled={upsertEnrollment.isPending}>
                  <Check className="h-4 w-4 mr-1.5" /> Capture & Enroll
                </Button>
                <Button variant="outline" onClick={stopCapture}>
                  <X className="h-4 w-4 mr-1.5" /> Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Student List */}
        {enrollments && enrollments.length > 0 ? (
          <div className="divide-y divide-border rounded-xl border mt-4">
            {enrollments.map((item: any) => (
              <div key={item.studentId} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  {item.enrollment?.photo_url ? (
                    <img src={item.enrollment.photo_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                      <User className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <span className="font-medium text-sm">{item.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {item.enrollment ? (
                    <Badge variant="default" className="bg-green-100 text-green-700 border-green-300">
                      <Check className="h-3 w-3 mr-1" /> Enrolled
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => startCapture(item.studentId)}
                      disabled={!!capturing}
                    >
                      <Camera className="h-3.5 w-3.5 mr-1.5" /> Enroll
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : selectedClass && !isLoading ? (
          <p className="text-center py-8 text-muted-foreground">No students found in this class</p>
        ) : !selectedClass ? (
          <p className="text-center py-8 text-muted-foreground">Select a class to manage face enrollments</p>
        ) : null}
      </DashboardSection>
    </div>
  );
}
