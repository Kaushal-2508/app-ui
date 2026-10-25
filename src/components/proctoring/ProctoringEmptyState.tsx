import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Monitor, Camera, AlertTriangle, ArrowRight, Info } from "lucide-react";

interface ProctoringEmptyStateProps {
  totalExamAttempts?: number;
}

export function ProctoringEmptyState({ totalExamAttempts = 0 }: ProctoringEmptyStateProps) {
  return (
    <div className="space-y-6">
      {/* Important Notice */}
      {totalExamAttempts > 0 && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  Proctoring was recently enabled
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                  {totalExamAttempts} exam attempts exist in the system, but proctoring wasn't active during those exams. 
                  New online exams taken from now on will have full proctoring data recorded.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hero Empty State */}
      <Card className="border-dashed">
        <CardContent className="py-12">
          <div className="text-center max-w-lg mx-auto space-y-4">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto">
              <Shield className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-semibold">No Proctoring Sessions Recorded Yet</h3>
            <p className="text-muted-foreground">
              Proctoring data will appear here once students take online exams. 
              The system monitors exam integrity by tracking tab switches, camera activity, and suspicious behaviors.
            </p>
            <Badge variant="secondary" className="mt-2">
              Proctoring is now active for all online exams
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* How Proctoring Works */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Monitor className="h-4 w-4 text-blue-500" />
              Tab & Window Monitoring
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Detects when students switch tabs, minimize windows, or exit fullscreen mode during exams.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Camera className="h-4 w-4 text-green-500" />
              Camera Verification
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Records camera snapshots during flagged events for visual verification of exam-taker identity.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Violation Flags
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Automatically flags suspicious activities like copy-paste attempts, right-clicks, and keyboard shortcuts.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* How to Enable */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How Proctoring Works</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row items-start md:items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">1</span>
              <span>Create an exam</span>
            </div>
            <ArrowRight className="h-4 w-4 hidden md:block" />
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">2</span>
              <span>Set mode to "Online"</span>
            </div>
            <ArrowRight className="h-4 w-4 hidden md:block" />
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">3</span>
              <span>Publish the exam</span>
            </div>
            <ArrowRight className="h-4 w-4 hidden md:block" />
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">4</span>
              <span>Students take exam with camera</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
