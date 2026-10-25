import { useState } from "react";

import { ClassAttendanceTiles } from "@/components/attendance/ClassAttendanceTiles";
import { ClassAttendanceMarker } from "@/components/attendance/ClassAttendanceMarker";

/**
 * Two-step flow for the "Mark Class" tab:
 *   - tiles step: pinned-first grid of teacher's classes
 *   - marker step: roster + per-student status pills + Save
 *
 * Local state — no router segment — so a tab switch (or tab strip scroll)
 * doesn't lose the selected class. Returning to the tiles re-fetches the
 * mark-status map so the just-saved class flips to "Marked today".
 */
export function MarkClassFlow() {
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);

  if (selectedClassId) {
    return (
      <ClassAttendanceMarker
        classId={selectedClassId}
        onBack={() => setSelectedClassId(null)}
      />
    );
  }
  return <ClassAttendanceTiles onSelectClass={setSelectedClassId} />;
}
