import { useParams } from "react-router-dom";
import { ExamResultsView } from "@/components/exam-results/ExamResultsView";

export default function ExamResultsPage() {
  const { examId } = useParams<{ examId: string }>();

  if (!examId) {
    return <div className="text-center py-12 text-muted-foreground">Invalid exam ID</div>;
  }

  return <ExamResultsView examId={examId} />;
}
