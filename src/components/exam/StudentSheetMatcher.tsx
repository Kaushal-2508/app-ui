import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Users,
  Link,
  Unlink,
  CheckCircle2,
  AlertCircle,
  FileImage,
  Eye,
  Save,
} from "lucide-react";
import {
  useUploadsWithMatching,
  useStudentsForMatching,
  useMatchStudentToUpload,
  useUnmatchStudent,
  type UploadWithMatching,
  type StudentForMatching,
} from "@/hooks/useOfflineExamUpload";
import { formatStudentIdLine } from "@/lib/studentIdentity";
import { openExternal } from "@/lib/native";

interface StudentSheetMatcherProps {
  examId: string;
  classId: string;
  onComplete?: () => void;
}

export function StudentSheetMatcher({
  examId,
  classId,
  onComplete,
}: StudentSheetMatcherProps) {
  const { data: uploads, isLoading: uploadsLoading } = useUploadsWithMatching(examId, classId);
  const { data: students, isLoading: studentsLoading } = useStudentsForMatching(examId, classId);
  const matchStudent = useMatchStudentToUpload();
  const unmatchStudent = useUnmatchStudent();

  // Local state for pending matches (before save)
  const [pendingMatches, setPendingMatches] = useState<Record<string, string>>({});

  const handleSelectStudent = (uploadId: string, studentId: string) => {
    if (studentId === "none") {
      const newPending = { ...pendingMatches };
      delete newPending[uploadId];
      setPendingMatches(newPending);
    } else {
      setPendingMatches((prev) => ({ ...prev, [uploadId]: studentId }));
    }
  };

  const handleSaveMatch = async (upload: UploadWithMatching) => {
    const studentId = pendingMatches[upload.id];
    if (!studentId) return;

    await matchStudent.mutateAsync({
      uploadId: upload.id,
      studentId,
      examId,
      classId,
    });

    // Clear pending match after successful save
    const newPending = { ...pendingMatches };
    delete newPending[upload.id];
    setPendingMatches(newPending);
  };

  const handleUnmatch = async (uploadId: string) => {
    await unmatchStudent.mutateAsync(uploadId);
  };

  // Stats
  const totalUploads = uploads?.length || 0;
  const matchedUploads = uploads?.filter((u) => u.studentId).length || 0;
  const unmatchedUploads = totalUploads - matchedUploads;

  // Filter out already matched students from dropdown
  const getAvailableStudents = (currentUploadId: string) => {
    const matchedStudentIds = new Set(
      uploads
        ?.filter((u) => u.studentId && u.id !== currentUploadId)
        .map((u) => u.studentId) || []
    );
    
    // Also exclude students selected in pending matches (except current)
    Object.entries(pendingMatches).forEach(([uploadId, studentId]) => {
      if (uploadId !== currentUploadId) {
        matchedStudentIds.add(studentId);
      }
    });

    return students?.filter((s) => !matchedStudentIds.has(s.id)) || [];
  };

  if (uploadsLoading || studentsLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading...
        </CardContent>
      </Card>
    );
  }

  if (!uploads || uploads.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 flex flex-col items-center justify-center text-center">
          <FileImage className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="font-medium text-lg">No Uploads</h3>
          <p className="text-muted-foreground mt-1">
            Upload answer sheets first to start matching students
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Match Students to Sheets
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {matchedUploads}/{totalUploads} matched
            </Badge>
            {unmatchedUploads === 0 && (
              <Badge variant="default" className="bg-green-600">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                All matched
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="max-h-[500px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">#</TableHead>
                <TableHead>File</TableHead>
                <TableHead className="w-[250px]">Student</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {uploads.map((upload, index) => {
                const isMatched = !!upload.studentId;
                const hasPendingMatch = !!pendingMatches[upload.id];
                const availableStudents = getAvailableStudents(upload.id);

                return (
                  <TableRow key={upload.id}>
                    <TableCell className="text-muted-foreground">
                      {index + 1}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileImage className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate max-w-[200px]" title={upload.fileName}>
                          {upload.fileName}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {isMatched ? (
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                          <span className="font-medium">{upload.studentName}</span>
                        </div>
                      ) : (
                        <SearchableSelect
                          value={pendingMatches[upload.id] || "none"}
                          onValueChange={(v) => handleSelectStudent(upload.id, v)}
                          placeholder="Select student..."
                          searchPlaceholder="Search students..."
                          options={[
                            { value: "none", label: "-- Select student --" },
                            ...availableStudents.map((student) => {
                              // Names repeat inside a section; roll + admission are what
                              // actually identify whose sheet this is.
                              const idLine = formatStudentIdLine(student.rollNumber, student.admissionNumber);
                              return {
                                value: student.id,
                                label: `${student.fullName}${idLine ? ` (${idLine})` : ""}${student.hasAttempt ? " (has attempt)" : ""}`,
                              };
                            }),
                          ]}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {isMatched ? (
                        <Badge variant="default" className="bg-green-600">
                          <Link className="h-3 w-3 mr-1" />
                          Matched
                        </Badge>
                      ) : hasPendingMatch ? (
                        <Badge variant="secondary">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Pending
                        </Badge>
                      ) : (
                        <Badge variant="outline">
                          <Unlink className="h-3 w-3 mr-1" />
                          Unmatched
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openExternal(upload.fileUrl)}
                          title="View file"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {isMatched ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleUnmatch(upload.id)}
                            disabled={unmatchStudent.isPending}
                            title="Remove match"
                          >
                            <Unlink className="h-4 w-4" />
                          </Button>
                        ) : hasPendingMatch ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleSaveMatch(upload)}
                            disabled={matchStudent.isPending}
                            title="Save match"
                          >
                            <Save className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ScrollArea>

        {unmatchedUploads === 0 && onComplete && (
          <div className="p-4 border-t bg-green-50">
            <Button className="w-full" onClick={onComplete}>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Continue to Evaluation
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
