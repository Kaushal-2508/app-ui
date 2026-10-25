import { useState, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Camera,
  Upload,
  X,
  CheckCircle2,
  Loader2,
  ChevronRight,
  ChevronLeft,
  FileImage,
  User,
  Eye,
  Scan,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatStudentIdLine, sortStudentRoster } from "@/lib/studentIdentity";

interface Student {
  id: string;
  full_name: string;
  roll_number?: string;
  admission_number?: string;
}

interface CapturedSheet {
  id: string;
  file: File | null;
  imageUrl: string;
  studentId?: string;
  studentName?: string;
}

interface OfflineScanFlowProps {
  examId: string;
  classId: string;
  onComplete: () => void;
}

export function OfflineScanFlow({ examId, classId, onComplete }: OfflineScanFlowProps) {
  const [step, setStep] = useState<"capture" | "match" | "process">("capture");
  const [capturedSheets, setCapturedSheets] = useState<CapturedSheet[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState(0);
  const [useCameraMode, setUseCameraMode] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch expected students for this class
  const { data: students } = useQuery({
    queryKey: ["class-students", classId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_assignments")
        .select(`
          user_id,
          profiles!class_assignments_user_id_fkey (
            id,
            full_name,
            roll_number,
            admission_number
          )
        `)
        .eq("class_id", classId)
        .eq("role", "student");

      if (error) throw error;
      const mapped = (data || []).map(d => d.profiles as Student).filter(Boolean);
      // Single class, so one block: roll order only when every student here is
      // numbered, alphabetical (ERP order) otherwise.
      return sortStudentRoster(mapped, {
        getRoll: (s) => s.roll_number,
        getName: (s) => s.full_name,
      });
    },
    enabled: !!classId,
  });

  // Camera handling
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 1920, height: 1080 },
      });
      setCameraStream(stream);
      setUseCameraMode(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      toast.error("Could not access camera");
      console.error(error);
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setUseCameraMode(false);
  };

  const captureFromCamera = useCallback(() => {
    if (!videoRef.current) return;

    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(videoRef.current, 0, 0);
    
    canvas.toBlob((blob) => {
      if (!blob) return;
      
      const file = new File([blob], `sheet-${Date.now()}.jpg`, { type: "image/jpeg" });
      const imageUrl = URL.createObjectURL(blob);
      
      setCapturedSheets(prev => [
        ...prev,
        { id: crypto.randomUUID(), file, imageUrl },
      ]);
      
      toast.success("Sheet captured!");
    }, "image/jpeg", 0.9);
  }, []);

  // File upload handling
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    
    files.forEach(file => {
      if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
        toast.error(`${file.name} is not a valid image or PDF`);
        return;
      }
      
      const imageUrl = URL.createObjectURL(file);
      setCapturedSheets(prev => [
        ...prev,
        { id: crypto.randomUUID(), file, imageUrl },
      ]);
    });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeSheet = (id: string) => {
    setCapturedSheets(prev => prev.filter(s => s.id !== id));
  };

  const updateStudentMatch = (sheetId: string, studentId: string) => {
    const student = students?.find(s => s.id === studentId);
    setCapturedSheets(prev => prev.map(s => 
      s.id === sheetId 
        ? { ...s, studentId, studentName: student?.full_name }
        : s
    ));
  };

  // Process and upload sheets
  const processSheets = async () => {
    if (capturedSheets.length === 0) {
      toast.error("No sheets to process");
      return;
    }

    const unmatchedCount = capturedSheets.filter(s => !s.studentId).length;
    if (unmatchedCount > 0) {
      toast.error(`${unmatchedCount} sheet(s) not matched to students`);
      return;
    }

    setIsProcessing(true);
    setStep("process");

    try {
      for (let i = 0; i < capturedSheets.length; i++) {
        const sheet = capturedSheets[i];
        setProcessProgress(((i + 1) / capturedSheets.length) * 100);

        // Upload to Supabase storage
        const filePath = `ocr-uploads/${examId}/${sheet.studentId}/${Date.now()}-${sheet.file?.name || 'sheet.jpg'}`;
        
        const { error: uploadError } = await supabase.storage
          .from("answer-sheets")
          .upload(filePath, sheet.file!);

        if (uploadError) {
          console.error("Upload error:", uploadError);
          continue;
        }

        // Get public URL
        const { data: urlData } = supabase.storage
          .from("answer-sheets")
          .getPublicUrl(filePath);

        // Get current user for uploaded_by
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        // Create OCR upload record
        await supabase.from("ocr_uploads").insert({
          exam_id: examId,
          class_id: classId,
          student_id: sheet.studentId!,
          file_url: urlData.publicUrl,
          file_name: sheet.file?.name || "sheet.jpg",
          file_type: sheet.file?.type || "image/jpeg",
          status: "pending",
          uploaded_by: user.id,
        });

        // Simulate small delay between uploads
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      toast.success("All sheets uploaded! OCR processing will begin shortly.");
      onComplete();
    } catch (error) {
      console.error("Processing error:", error);
      toast.error("Failed to process some sheets");
    } finally {
      setIsProcessing(false);
    }
  };

  const allMatched = capturedSheets.length > 0 && capturedSheets.every(s => s.studentId);

  return (
    <div className="space-y-6">
      {/* Step Indicator */}
      <div className="flex items-center gap-2 text-sm">
        <Badge variant={step === "capture" ? "default" : "secondary"}>1. Capture</Badge>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <Badge variant={step === "match" ? "default" : "secondary"}>2. Match Students</Badge>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <Badge variant={step === "process" ? "default" : "secondary"}>3. Process</Badge>
      </div>

      {/* Step 1: Capture */}
      {step === "capture" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Scan className="h-5 w-5" />
              Capture Answer Sheets
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Capture Methods */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Button
                variant={useCameraMode ? "default" : "outline"}
                className="h-24 flex-col gap-2"
                onClick={useCameraMode ? captureFromCamera : startCamera}
              >
                <Camera className="h-8 w-8" />
                <span>{useCameraMode ? "Capture Photo" : "Use Camera"}</span>
              </Button>
              
              <Button
                variant="outline"
                className="h-24 flex-col gap-2"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-8 w-8" />
                <span>Upload Files</span>
              </Button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              multiple
              className="hidden"
              onChange={handleFileUpload}
            />

            {/* Camera Preview */}
            {useCameraMode && cameraStream && (
              <div className="relative">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="w-full rounded-lg bg-black aspect-video"
                />
                <Button
                  variant="destructive"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={stopCamera}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}

            {/* Captured Sheets Preview */}
            {capturedSheets.length > 0 && (
              <div className="space-y-3">
                <Separator />
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Captured Sheets ({capturedSheets.length})</h4>
                  <Badge variant="secondary">
                    {students?.length || 0} students expected
                  </Badge>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {capturedSheets.map((sheet, idx) => (
                    <div key={sheet.id} className="relative group">
                      <img
                        src={sheet.imageUrl}
                        alt={`Sheet ${idx + 1}`}
                        className="w-full aspect-[3/4] object-cover rounded-lg border"
                      />
                      <Badge className="absolute top-1 left-1 text-xs">
                        {idx + 1}
                      </Badge>
                      <Button
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => removeSheet(sheet.id)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-end pt-4">
              <Button
                onClick={() => setStep("match")}
                disabled={capturedSheets.length === 0}
              >
                Next: Match Students
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Match Students */}
      {step === "match" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-5 w-5" />
              Match to Students
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              {capturedSheets.map((sheet, idx) => (
                <div key={sheet.id} className="flex items-center gap-4 p-3 border rounded-lg">
                  <img
                    src={sheet.imageUrl}
                    alt={`Sheet ${idx + 1}`}
                    className="w-16 h-20 object-cover rounded"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium mb-2">Sheet {idx + 1}</p>
                    <SearchableSelect
                      value={sheet.studentId || ""}
                      onValueChange={(v) => updateStudentMatch(sheet.id, v)}
                      placeholder="Select student..."
                      searchPlaceholder="Search by name..."
                      options={students?.map(s => {
                        const idLine = formatStudentIdLine(s.roll_number, s.admission_number);
                        return {
                          value: s.id,
                          label: `${s.full_name}${idLine ? ` (${idLine})` : ""}`,
                        };
                      }) || []}
                    />
                  </div>
                  {sheet.studentId && (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  )}
                </div>
              ))}
            </div>

            {/* Progress */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Matched</span>
                <span>{capturedSheets.filter(s => s.studentId).length}/{capturedSheets.length}</span>
              </div>
              <Progress 
                value={(capturedSheets.filter(s => s.studentId).length / capturedSheets.length) * 100}
              />
            </div>

            {/* Navigation */}
            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={() => setStep("capture")}>
                <ChevronLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button
                onClick={processSheets}
                disabled={!allMatched}
              >
                Start Processing
                <Scan className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Processing */}
      {step === "process" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Processing Sheets
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Uploading and processing...</span>
                <span>{Math.round(processProgress)}%</span>
              </div>
              <Progress value={processProgress} />
            </div>

            <p className="text-sm text-muted-foreground text-center">
              OCR processing will continue in the background. 
              You'll be notified when checking is ready.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}