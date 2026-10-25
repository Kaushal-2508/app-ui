import { useParams, Navigate } from "react-router-dom";
import { OfflineMarksEntryScreen } from "@/components/exam-creation/screens/OfflineMarksEntryScreen";

export default function OfflineMarksEntryPage() {
  const { examId } = useParams<{ examId: string }>();
  if (!examId) return <Navigate to="/exams" replace />;
  return <OfflineMarksEntryScreen examId={examId} />;
}
