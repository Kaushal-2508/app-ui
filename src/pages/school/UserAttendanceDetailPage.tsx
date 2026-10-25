import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ClipboardCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PageShell, PageHeader } from "@/components/shared/page";
import {
  AttendanceHistoryView,
  useUserHeader,
} from "@/components/attendance/AttendanceHistoryView";
import { type AttendanceKind } from "@/hooks/useUserAttendanceHistory";

/**
 * Standalone detail page for a teacher / coordinator / student. Wraps
 * AttendanceHistoryView with a back button and a header card.
 */
export default function UserAttendanceDetailPage() {
  const navigate = useNavigate();
  const params = useParams<{ userId: string }>();
  const [search] = useSearchParams();
  const kind = (search.get("kind") === "student" ? "student" : "staff") as AttendanceKind;
  const userId = params.userId ?? null;

  const headerQ = useUserHeader(userId, kind);

  if (!userId) {
    return (
      <PageShell>
        <PageHeader title="User not found" />
      </PageShell>
    );
  }

  const fullName = headerQ.data?.full_name ?? "Loading…";
  const subtitle = headerQ.data?.subtitle ?? "";

  return (
    <PageShell>
      <div className="flex items-start gap-3 pt-4 pb-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Avatar className="h-12 w-12 mt-0.5">
          <AvatarFallback className="text-sm">
            {fullName
              .split(" ")
              .map((p) => p[0])
              .filter(Boolean)
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="eyebrow inline-flex items-center gap-1">
            <ClipboardCheck className="h-3 w-3" /> Attendance history
          </p>
          <h1 className="text-xl sm:text-2xl font-bold text-ink-900 mt-0.5 truncate">{fullName}</h1>
          <p className="text-sm text-ink-600 truncate">{subtitle}</p>
        </div>
      </div>

      <AttendanceHistoryView userId={userId} kind={kind} />
    </PageShell>
  );
}
