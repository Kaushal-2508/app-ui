import { CheckInBacklogSheet } from "@/components/lesson-completion/CheckInBacklogSheet";
import { CheckOutSyllabusSheet } from "@/components/lesson-completion/CheckOutSyllabusSheet";
import type { StaffCheckFlow } from "@/hooks/useStaffCheckFlow";

/** The teacher-only sheets that follow a check-in or check-out (see useStaffCheckFlow). */
export function StaffCheckSheets({ flow }: { flow: StaffCheckFlow }) {
  if (!flow.isTeacher) return null;
  return (
    <>
      <CheckOutSyllabusSheet open={flow.syllabusOpen} onOpenChange={flow.setSyllabusOpen} />
      <CheckInBacklogSheet open={flow.backlogOpen} onOpenChange={flow.setBacklogOpen} />
    </>
  );
}
