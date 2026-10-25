import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { Trophy, Flag, XCircle } from "lucide-react";
import type { ValidatedResult } from "@/hooks/useExamResults";
import { useExamAnalytics } from "@/hooks/useExamAnalytics";
import { ExamReportPDF } from "./ExamReportPDF";
import { StudentReportPDF } from "./StudentReportPDF";

interface ValidatedResultsTableProps {
  results: ValidatedResult[];
  examId: string;
  examTitle: string;
  isOnline: boolean;
}

export function ValidatedResultsTable({
  results,
  examId,
  examTitle,
  isOnline,
}: ValidatedResultsTableProps) {
  const { data: analytics } = useExamAnalytics(examId);

  return (
    <DashboardSection
      title="Published Results"
      description="Rank-wise student results"
      icon={Trophy}
      iconGradient="from-amber-400 to-orange-500"
      filter={
        analytics ? <ExamReportPDF analytics={analytics} /> : null
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Rank</TableHead>
            <TableHead>Roll No</TableHead>
            <TableHead>Admission No</TableHead>
            <TableHead>Student Name</TableHead>
            <TableHead>Score</TableHead>
            <TableHead>Percentage</TableHead>
            <TableHead>Grade</TableHead>
            <TableHead>Result</TableHead>
            {isOnline && <TableHead>Flags</TableHead>}
            <TableHead className="w-16">Report</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((result) => (
            <TableRow
              key={result.studentId}
              className={!result.passed ? "bg-red-50/50 dark:bg-red-950/10" : ""}
            >
              <TableCell className="font-bold text-lg">#{result.rank}</TableCell>
              <TableCell className="font-mono text-sm">{result.rollNo || "-"}</TableCell>
              <TableCell className="font-mono text-sm text-muted-foreground">
                {result.admissionNo || "-"}
              </TableCell>
              <TableCell className="font-medium">{result.studentName}</TableCell>
              <TableCell className="font-semibold">
                {result.totalScore}/{result.maxMarks}
              </TableCell>
              <TableCell>{result.percentage}%</TableCell>
              <TableCell>
                <Badge variant="outline" className="font-semibold">
                  {result.grade}
                </Badge>
              </TableCell>
              <TableCell>
                {result.passed ? (
                  <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
                    Passed
                  </Badge>
                ) : (
                  <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100">
                    <XCircle className="h-3 w-3 mr-1" />
                    Failed
                  </Badge>
                )}
              </TableCell>
              {isOnline && (
                <TableCell>
                  {result.proctoringFlags > 0 ? (
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                      <Flag className="h-3 w-3 mr-1" />
                      {result.proctoringFlags}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
              )}
              <TableCell>
                {analytics ? (
                  <StudentReportPDF
                    analytics={analytics}
                    studentId={result.studentId}
                    iconOnly
                  />
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DashboardSection>
  );
}
