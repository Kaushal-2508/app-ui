import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CapturedSheet, StudentWithRoll } from "@/hooks/useOfflineScan";
import { CheckCircle2, XCircle, ZoomIn, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatStudentIdLine } from "@/lib/studentIdentity";

interface StudentMatchingRowProps {
  sheet: CapturedSheet;
  index: number;
  students: StudentWithRoll[];
  availableStudents: StudentWithRoll[];
  isLoading: boolean;
  onMatch: (
    studentId: string,
    studentName: string,
    rollNumber: string | undefined,
    matchMethod: "manual" | "roll_number" | "auto_detect"
  ) => void;
  onClear: () => void;
}

export function StudentMatchingRow({
  sheet,
  index,
  students,
  availableStudents,
  isLoading,
  onMatch,
  onClear,
}: StudentMatchingRowProps) {
  const [rollNumberInput, setRollNumberInput] = useState(sheet.rollNumber || "");

  const isMatched = !!sheet.studentId;

  // Handle student selection from dropdown
  const handleStudentSelect = useCallback(
    (studentId: string) => {
      const student = students.find((s) => s.id === studentId);
      if (student) {
        onMatch(student.id, student.fullName, student.rollNumber || undefined, "manual");
      }
    },
    [students, onMatch]
  );

  // Handle roll number input
  const handleRollNumberBlur = useCallback(() => {
    if (!rollNumberInput.trim()) return;

    const student = students.find(
      (s) => s.rollNumber?.toLowerCase() === rollNumberInput.toLowerCase().trim()
    );

    if (student) {
      onMatch(student.id, student.fullName, student.rollNumber || undefined, "roll_number");
    }
  }, [rollNumberInput, students, onMatch]);

  // Handle clear
  const handleClear = useCallback(() => {
    setRollNumberInput("");
    onClear();
  }, [onClear]);

  return (
    <div
      className={cn(
        "flex items-start gap-4 p-3 rounded-lg border",
        isMatched ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30" : "border-border"
      )}
    >
      {/* Sheet thumbnail */}
      <Dialog>
        <DialogTrigger asChild>
          <div className="relative w-16 h-20 rounded border overflow-hidden cursor-pointer group flex-shrink-0">
            <Badge
              variant="secondary"
              className="absolute top-1 left-1 z-10 text-[10px] h-4 px-1"
            >
              {index + 1}
            </Badge>
            {sheet.file.type === "application/pdf" ? (
              <div className="w-full h-full flex items-center justify-center bg-muted">
                <span className="text-lg">📄</span>
              </div>
            ) : (
              <img
                src={sheet.previewUrl}
                alt={`Sheet ${index + 1}`}
                className="w-full h-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <ZoomIn className="h-4 w-4 text-white" />
            </div>
          </div>
        </DialogTrigger>
        <DialogContent className="max-w-4xl max-h-[90vh] p-2">
          {sheet.file.type === "application/pdf" ? (
            <div className="flex items-center justify-center h-[60vh]">
              <div className="text-center">
                <span className="text-6xl">📄</span>
                <p className="text-lg mt-4">{sheet.file.name}</p>
              </div>
            </div>
          ) : (
            <img
              src={sheet.previewUrl}
              alt="Enlarged sheet"
              className="w-full h-auto max-h-[80vh] object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Matching inputs */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading students...
            </div>
          ) : (
            <>
              {/* Student dropdown */}
              <div className="flex-1">
                <SearchableSelect
                  value={sheet.studentId || ""}
                  onValueChange={handleStudentSelect}
                  placeholder="Select student..."
                  searchPlaceholder="Search students..."
                  options={[
                    // Show matched student at top if already matched
                    ...(sheet.studentId ? [{
                      value: sheet.studentId,
                      label: `${sheet.studentName}${sheet.rollNumber ? ` (${sheet.rollNumber})` : ""}`,
                    }] : []),
                    // Available students
                    ...availableStudents.map((student) => {
                      // Roll + admission, so two students with the same name stay
                      // tellable apart when matching a sheet to a person.
                      const idLine = formatStudentIdLine(student.rollNumber, student.admissionNumber);
                      return {
                        value: student.id,
                        label: `${student.fullName}${idLine ? ` (${idLine})` : ""}${student.hasAttempt ? " - Already submitted" : ""}`,
                        disabled: student.hasAttempt,
                      };
                    }),
                  ]}
                />
              </div>

              {/* Clear button */}
              {isMatched && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 flex-shrink-0"
                  onClick={handleClear}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </>
          )}
        </div>

        {/* Roll number input */}
        <div className="flex items-center gap-2">
          <Input
            placeholder="Or type roll number..."
            value={rollNumberInput}
            onChange={(e) => setRollNumberInput(e.target.value)}
            onBlur={handleRollNumberBlur}
            onKeyDown={(e) => e.key === "Enter" && handleRollNumberBlur()}
            className="flex-1 h-8 text-sm"
          />
        </div>
      </div>

      {/* Status indicator */}
      <div className="flex-shrink-0 pt-1">
        {isMatched ? (
          <CheckCircle2 className="h-5 w-5 text-green-500" />
        ) : (
          <XCircle className="h-5 w-5 text-muted-foreground/40" />
        )}
      </div>
    </div>
  );
}
