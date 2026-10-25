import { useParams } from "react-router-dom";
import { HomeworkCreationFlow } from "@/components/homework-creation/HomeworkCreationFlow";

export default function EditHomework() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return <HomeworkCreationFlow mode="edit" homeworkId={id} />;
}
