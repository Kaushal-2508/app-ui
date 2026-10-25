import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { 
  Info, 
  Monitor, 
  Camera, 
  AlertTriangle, 
  Shield, 
  Keyboard,
  MousePointer,
  Maximize,
  Eye,
  Copy,
  ArrowRight
} from "lucide-react";

interface ProctoringFlagReference {
  type: string;
  label: string;
  description: string;
  severity: "high" | "medium" | "low";
  icon: typeof Monitor;
}

const FLAG_DEFINITIONS: ProctoringFlagReference[] = [
  {
    type: "tab_switch",
    label: "Tab Switch",
    description: "Student switched to a different browser tab during the exam",
    severity: "high",
    icon: Monitor,
  },
  {
    type: "window_blur",
    label: "Window Blur",
    description: "Browser window lost focus (student clicked outside the exam window)",
    severity: "medium",
    icon: Eye,
  },
  {
    type: "fullscreen_exit",
    label: "Fullscreen Exit",
    description: "Student exited fullscreen mode during the exam",
    severity: "high",
    icon: Maximize,
  },
  {
    type: "copy_attempt",
    label: "Copy Attempt",
    description: "Student attempted to copy content (Ctrl+C or right-click)",
    severity: "medium",
    icon: Copy,
  },
  {
    type: "paste_attempt",
    label: "Paste Attempt",
    description: "Student attempted to paste content (Ctrl+V)",
    severity: "high",
    icon: Keyboard,
  },
  {
    type: "right_click",
    label: "Right Click",
    description: "Context menu was opened via right-click",
    severity: "low",
    icon: MousePointer,
  },
  {
    type: "keyboard_shortcut",
    label: "Restricted Shortcut",
    description: "Student used a restricted keyboard shortcut (e.g., Alt+Tab, Print Screen)",
    severity: "high",
    icon: Keyboard,
  },
  {
    type: "face_not_detected",
    label: "Face Not Detected",
    description: "Camera could not detect a face for an extended period",
    severity: "high",
    icon: Camera,
  },
  {
    type: "multiple_faces",
    label: "Multiple Faces",
    description: "More than one face was detected in the camera frame",
    severity: "high",
    icon: Camera,
  },
  {
    type: "camera_blocked",
    label: "Camera Blocked",
    description: "Camera feed was blocked or turned off",
    severity: "high",
    icon: Camera,
  },
];

export function ProctoringFlagReference() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Info className="h-4 w-4 mr-2" />
          Flag Reference
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Proctoring Flag Reference
          </DialogTitle>
          <DialogDescription>
            Understanding what each proctoring flag means and how severity is determined
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 mt-4">
          {/* Severity Legend */}
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">Severity Levels</h4>
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <Badge variant="destructive">High</Badge>
                <span className="text-sm text-muted-foreground">Requires manual review</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-amber-500 hover:bg-amber-600">Medium</Badge>
                <span className="text-sm text-muted-foreground">Should be investigated</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Low</Badge>
                <span className="text-sm text-muted-foreground">Informational</span>
              </div>
            </div>
          </div>

          {/* Flag Definitions */}
          <div className="space-y-3">
            <h4 className="font-semibold text-sm">Flag Types</h4>
            <div className="space-y-2">
              {FLAG_DEFINITIONS.map((flag) => (
                <div 
                  key={flag.type} 
                  className="flex items-start gap-3 p-3 border rounded-lg"
                >
                  <div className={`p-2 rounded-full shrink-0 ${
                    flag.severity === "high" 
                      ? "bg-destructive/10 text-destructive" 
                      : flag.severity === "medium"
                      ? "bg-amber-100 text-amber-600 dark:bg-amber-950/50"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    <flag.icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{flag.label}</span>
                      <Badge 
                        variant={flag.severity === "high" ? "destructive" : flag.severity === "medium" ? "default" : "secondary"}
                        className={flag.severity === "medium" ? "bg-amber-500" : ""}
                      >
                        {flag.severity}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {flag.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Calculation Logic */}
          <div className="space-y-2 border-t pt-4">
            <h4 className="font-semibold text-sm">Flag Count Calculation</h4>
            <div className="text-sm text-muted-foreground space-y-2">
              <p>
                Each detected event is counted as exactly <strong>one flag</strong>. 
                The total flag count for a session is the sum of all recorded events.
              </p>
              <div className="flex items-center gap-2 text-xs bg-muted p-2 rounded">
                <code>Total Flags = high_severity_events + medium_severity_events + low_severity_events</code>
              </div>
              <p>
                A session is marked as "Requires Review" if it has <strong>any high-severity events</strong> 
                or if the total event count exceeds a threshold.
              </p>
            </div>
          </div>

          {/* Consistency Note */}
          <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
            <Info className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-blue-800 dark:text-blue-200">
                Consistency Guarantee
              </p>
              <p className="text-blue-700 dark:text-blue-300">
                Flag counts shown in the proctoring review page match exactly with 
                flag counts displayed in exam reports and student result sheets.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function getSeverityColor(severity: string): string {
  if (severity === "high") return "text-destructive";
  if (severity === "medium") return "text-amber-600";
  return "text-muted-foreground";
}

export function getSeverityBgColor(severity: string): string {
  if (severity === "high") return "bg-destructive/10";
  if (severity === "medium") return "bg-amber-100 dark:bg-amber-950/50";
  return "bg-muted";
}
