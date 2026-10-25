import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CapturedSheet, useStudentsWithRoll } from "@/hooks/useOfflineScan";
import { StudentMatchingRow } from "./StudentMatchingRow";
import { ArrowLeft, ArrowRight, ChevronDown, ListOrdered, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { sortStudentRoster } from "@/lib/studentIdentity";

interface MatchStepProps {
  sheets: CapturedSheet[];
  examId: string | null;
  classId: string | null;
  onUpdateMatch: (
    sheetId: string,
    match: {
      studentId: string;
      studentName: string;
      rollNumber?: string;
      matchMethod: "manual" | "roll_number" | "auto_detect";
    }
  ) => void;
  onClearMatch: (sheetId: string) => void;
  matchedCount: number;
  allMatched: boolean;
  onBack: () => void;
  onSubmit: () => void;
}

export function MatchStep({
  sheets,
  examId,
  classId,
  onUpdateMatch,
  onClearMatch,
  matchedCount,
  allMatched,
  onBack,
  onSubmit,
}: MatchStepProps) {
  const { data: students, isLoading } = useStudentsWithRoll(classId, examId);

  // Get available (unmatched) students
  const matchedStudentIds = sheets.filter((s) => s.studentId).map((s) => s.studentId);
  const availableStudents =
    students?.filter((s) => !matchedStudentIds.includes(s.id)) || [];

  // Match by roll number order
  const handleMatchByRollOrder = useCallback(() => {
    if (!students) return;

    // Must be the same order the roster is displayed in, or sheet N gets
    // matched to a different student than the one the marker is looking at.
    // The old comparator mixed roll and name comparisons, which is not
    // transitive and let sort() produce an arbitrary order on mixed rosters.
    const sortedStudents = sortStudentRoster(students, {
      getRoll: (s) => s.rollNumber,
      getName: (s) => s.fullName,
    });

    let matchCount = 0;
    sheets.forEach((sheet, index) => {
      if (!sheet.studentId && sortedStudents[index]) {
        const student = sortedStudents[index];
        onUpdateMatch(sheet.id, {
          studentId: student.id,
          studentName: student.fullName,
          rollNumber: student.rollNumber || undefined,
          matchMethod: "roll_number",
        });
        matchCount++;
      }
    });

    if (matchCount > 0) {
      toast.success(`Auto-matched ${matchCount} sheets by roll order`);
    } else {
      toast.info("No sheets to match or no students available");
    }
  }, [sheets, students, onUpdateMatch]);

  // Clear all matches
  const handleClearAll = useCallback(() => {
    sheets.forEach((sheet) => {
      if (sheet.studentId) {
        onClearMatch(sheet.id);
      }
    });
    toast.success("All matches cleared");
  }, [sheets, onClearMatch]);

  return (
    <div className="space-y-6">
      {/* Header with stats and bulk actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-medium">
            Matched: {matchedCount}/{sheets.length} sheets
          </h3>
          <p className="text-sm text-muted-foreground">
            Match each answer sheet to a student using dropdown or roll number
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Bulk Actions
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleMatchByRollOrder}>
              <ListOrdered className="mr-2 h-4 w-4" />
              Match by Roll Order
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleClearAll}
              className="text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear All Matches
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Matching rows */}
      <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
        {sheets.map((sheet, index) => (
          <StudentMatchingRow
            key={sheet.id}
            sheet={sheet}
            index={index}
            students={students || []}
            availableStudents={availableStudents}
            isLoading={isLoading}
            onMatch={(studentId, studentName, rollNumber, matchMethod) =>
              onUpdateMatch(sheet.id, {
                studentId,
                studentName,
                rollNumber,
                matchMethod,
              })
            }
            onClear={() => onClearMatch(sheet.id)}
          />
        ))}
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={onSubmit} disabled={!allMatched}>
          Submit for Processing
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
