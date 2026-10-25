import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOfflineExams } from "@/hooks/useOfflineScan";
import { FileText, Users, ArrowRight, Loader2 } from "lucide-react";
import { formatClassName } from "@/lib/utils";

interface ContextStepProps {
  examId: string | null;
  classId: string | null;
  onExamChange: (examId: string) => void;
  onClassChange: (classId: string) => void;
  onNext: () => void;
}

export function ContextStep({
  examId,
  classId,
  onExamChange,
  onClassChange,
  onNext,
}: ContextStepProps) {
  const { data: exams, isLoading } = useOfflineExams();

  const selectedExam = exams?.find((e) => e.id === examId);
  const examClasses =
    selectedExam?.exam_classes?.map((ec) => {
      const cls = ec.classes as { id: string; name: string; section: string | null } | null;
      return cls
        ? {
            id: cls.id,
            name: cls.name,
            section: cls.section,
          }
        : null;
    }).filter(Boolean) || [];

  const canProceed = !!examId && !!classId;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center text-muted-foreground text-sm">
        Select the offline exam and class for which you want to scan answer sheets.
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Select Exam
          </Label>
          <Select value={examId || ""} onValueChange={onExamChange}>
            <SelectTrigger>
              <SelectValue placeholder="Choose an offline exam..." />
            </SelectTrigger>
            <SelectContent>
              {exams?.map((exam) => (
                <SelectItem key={exam.id} value={exam.id}>
                  <div className="flex flex-col">
                    <span>{exam.title}</span>
                    {exam.scheduled_date && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(exam.scheduled_date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
              {(!exams || exams.length === 0) && (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  No offline exams found. Create an exam with "Offline" mode first.
                </div>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Select Class
          </Label>
          <Select
            value={classId || ""}
            onValueChange={onClassChange}
            disabled={!examId || examClasses.length === 0}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a class..." />
            </SelectTrigger>
            <SelectContent>
              {examClasses.map((cls) =>
                cls ? (
                  <SelectItem key={cls.id} value={cls.id}>
                    {formatClassName(cls.name, cls.section)}
                  </SelectItem>
                ) : null
              )}
              {examClasses.length === 0 && examId && (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  No classes assigned to this exam.
                </div>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <Button onClick={onNext} disabled={!canProceed}>
          Next: Capture Sheets
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
