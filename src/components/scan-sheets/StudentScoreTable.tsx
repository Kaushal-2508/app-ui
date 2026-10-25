import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sortStudentRoster } from "@/lib/studentIdentity";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Eye,
  Edit,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
} from "lucide-react";

interface StudentWithScore {
  student_id: string;
  full_name: string;
  roll_number: string | null;
  admission_number: string | null;
  scan_status: "not_scanned" | "pending_ocr" | "ocr_complete" | "ai_graded" | "teacher_reviewed";
  upload_id: string | null;
  attempt_id: string | null;
  ai_score: number | null;
  max_marks: number | null;
  avg_confidence: number | null;
  is_finalized: boolean;
}

interface StudentScoreTableProps {
  students: StudentWithScore[];
  onViewSheet: (uploadId: string) => void;
  onEditMarks: (student: StudentWithScore) => void;
}

// "roster" is the default: the shared class-roster rule (roll order when the
// whole class is numbered, alphabetical otherwise). The named fields are only
// reached once the user explicitly picks one from the Sort menu.
type SortField =
  | "roster"
  | "roll_number"
  | "admission_number"
  | "full_name"
  | "ai_score"
  | "avg_confidence";
type SortDirection = "asc" | "desc";

export function StudentScoreTable({ students, onViewSheet, onEditMarks }: StudentScoreTableProps) {
  const [sortField, setSortField] = useState<SortField>("roster");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const rosterOrdered = sortStudentRoster(students, {
    getRoll: (s) => s.roll_number,
    getName: (s) => s.full_name,
  });

  const sortedStudents = sortField === "roster"
    ? rosterOrdered
    : [...students].sort((a, b) => {
    let aVal: string | number | null;
    let bVal: string | number | null;

    switch (sortField) {
      case "roll_number":
        // Explicitly asked for by the user, so honour it even on a class that
        // is not fully numbered; blanks sort last rather than to the top.
        aVal = a.roll_number || "￿";
        bVal = b.roll_number || "￿";
        break;
      case "admission_number":
        aVal = a.admission_number || "";
        bVal = b.admission_number || "";
        break;
      case "full_name":
        aVal = a.full_name;
        bVal = b.full_name;
        break;
      case "ai_score":
        aVal = a.ai_score ?? -1;
        bVal = b.ai_score ?? -1;
        break;
      case "avg_confidence":
        aVal = a.avg_confidence ?? -1;
        bVal = b.avg_confidence ?? -1;
        break;
      default:
        aVal = "";
        bVal = "";
    }

    if (typeof aVal === "string" && typeof bVal === "string") {
      const cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
      return sortDirection === "asc" ? cmp : -cmp;
    }
    
    const numA = aVal as number;
    const numB = bVal as number;
    return sortDirection === "asc" ? numA - numB : numB - numA;
  });

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => {
    const isActive = sortField === field;
    return (
      <button
        className="flex items-center gap-1 hover:text-foreground transition-colors"
        onClick={() => handleSort(field)}
      >
        {label}
        {isActive ? (
          sortDirection === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-50" />
        )}
      </button>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Student Scores</CardTitle>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                <ArrowUpDown className="h-4 w-4" />
                Sort
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleSort("roll_number")}>
                Roll Number
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSort("admission_number")}>
                Admission Number
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSort("full_name")}>
                Name
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSort("ai_score")}>
                AI Score
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSort("avg_confidence")}>
                OCR Confidence
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">
                <SortHeader field="roll_number" label="Roll" />
              </TableHead>
              <TableHead className="w-32">
                <SortHeader field="admission_number" label="Admission No" />
              </TableHead>
              <TableHead>
                <SortHeader field="full_name" label="Student Name" />
              </TableHead>
              <TableHead className="w-32">Status</TableHead>
              <TableHead className="w-24 text-right">
                <SortHeader field="ai_score" label="Score" />
              </TableHead>
              <TableHead className="w-28 text-right">
                <SortHeader field="avg_confidence" label="Confidence" />
              </TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedStudents.map((student) => (
              <TableRow key={student.student_id}>
                <TableCell className="font-medium">
                  {student.roll_number || "-"}
                </TableCell>
                <TableCell className="font-mono text-sm text-muted-foreground">
                  {student.admission_number || "-"}
                </TableCell>
                <TableCell>{student.full_name}</TableCell>
                <TableCell>
                  <StatusBadge status={student.scan_status} />
                </TableCell>
                <TableCell className="text-right font-medium">
                  {student.ai_score !== null && student.max_marks !== null ? (
                    <span>
                      {student.ai_score}/{student.max_marks}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {student.avg_confidence !== null ? (
                    <ConfidenceBadge confidence={student.avg_confidence} />
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {student.upload_id && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onViewSheet(student.upload_id!)}
                        title="View Sheet"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    )}
                    {/* Always allow viewing/editing marks if attempt exists */}
                    {student.attempt_id && !student.is_finalized && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onEditMarks(student)}
                        title="View & Edit Marks"
                        className={student.avg_confidence !== null && student.avg_confidence < 0.7 ? "text-amber-600" : ""}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: StudentWithScore["scan_status"] }) {
  const config = {
    not_scanned: {
      label: "Not Scanned",
      variant: "outline" as const,
      icon: XCircle,
      className: "text-muted-foreground",
    },
    pending_ocr: {
      label: "Processing",
      variant: "secondary" as const,
      icon: Clock,
      className: "",
    },
    ocr_complete: {
      label: "OCR Done",
      variant: "outline" as const,
      icon: CheckCircle2,
      className: "text-blue-600 border-blue-200",
    },
    ai_graded: {
      label: "AI Graded",
      variant: "default" as const,
      icon: CheckCircle2,
      className: "",
    },
    teacher_reviewed: {
      label: "Reviewed",
      variant: "default" as const,
      icon: CheckCircle2,
      className: "bg-green-600",
    },
  };

  const { label, variant, icon: Icon, className } = config[status];

  return (
    <Badge variant={variant} className={`text-xs gap-1 ${className}`}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const percentage = Math.round(confidence * 100);
  
  let colorClass = "text-green-600 bg-green-50";
  let icon = CheckCircle2;
  
  if (percentage < 60) {
    colorClass = "text-red-600 bg-red-50";
    icon = AlertTriangle;
  } else if (percentage < 80) {
    colorClass = "text-amber-600 bg-amber-50";
    icon = Clock;
  }

  const Icon = icon;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
      <Icon className="h-3 w-3" />
      {percentage}%
    </span>
  );
}
