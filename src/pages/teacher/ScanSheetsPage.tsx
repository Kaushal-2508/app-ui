import { useState } from "react";
import { ExamListView, ExamDetailView } from "@/components/scan-sheets";
import { usePendingOfflineExams } from "@/hooks/useScanSheetsData";
import { formatClassName } from "@/lib/utils";

export default function ScanSheetsPage() {
  const { data: exams, isLoading } = usePendingOfflineExams();
  const [selectedExam, setSelectedExam] = useState<{
    examId: string;
    classId: string;
    examTitle: string;
    className: string;
  } | null>(null);

  const handleSelectExam = (examId: string, classId: string) => {
    const exam = exams?.find((e) => e.id === examId);
    const cls = exam?.classes.find((c) => c.class_id === classId);

    if (exam && cls) {
      setSelectedExam({
        examId,
        classId,
        examTitle: exam.title,
        className: formatClassName(cls.class_name, cls.section),
      });
    }
  };

  const handleBack = () => {
    setSelectedExam(null);
  };

  return (
    <div className="space-y-6">
      {!selectedExam && (
        <>
          <div>
            <h1 className="text-2xl font-bold">Scan Sheets</h1>
            <p className="text-muted-foreground">
              Scan answer sheets, evaluate with AI, and publish results
            </p>
          </div>

          <ExamListView
            exams={exams || []}
            isLoading={isLoading}
            onSelectExam={handleSelectExam}
          />
        </>
      )}

      {selectedExam && (
        <ExamDetailView
          examId={selectedExam.examId}
          classId={selectedExam.classId}
          examTitle={selectedExam.examTitle}
          className={selectedExam.className}
          onBack={handleBack}
        />
      )}
    </div>
  );
}
