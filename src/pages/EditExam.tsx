import { useParams } from "react-router-dom";
import { ExamCreationFlow } from "@/components/exam-creation";

export default function EditExam() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return <ExamCreationFlow mode="edit" examId={id} />;
}
