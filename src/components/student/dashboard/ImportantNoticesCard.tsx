import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { AlertTriangle, ChevronRight, Megaphone } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ListRow } from "@/components/shared/surfaces";
import { useNoticeInbox } from "@/hooks/notices";

import { ToneChip } from "./toneChip";

/**
 * Section 3 of the student dashboard: the latest urgent/important notices, and
 * nothing when there are none.
 *
 * Relevance is decided server-side now. `notice_inbox` returns only notices this
 * student was actually addressed on, already filtered for future publish dates
 * and past expiry, so the old client-side scope/class/expiry filter chain is
 * gone -- it existed to compensate for an RLS policy that returned every notice
 * in the school.
 */
export function ImportantNoticesCard() {
  const navigate = useNavigate();
  const { data, isLoading } = useNoticeInbox();

  const items = useMemo(() => {
    const rows = data?.pages.flatMap((p) => p.rows) ?? [];
    return rows
      .filter((n) => n.priority === "urgent" || n.priority === "important")
      .slice(0, 3);
  }, [data]);

  const goToAll = () => navigate("/school/notices");

  // Secondary card: stays hidden until there is a live, relevant notice, and
  // never flashes an empty shell while the first page is still loading.
  if (isLoading || items.length === 0) return null;

  return (
    <Card className="surface-card frosted-shadow rounded-card">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-ink-900">
          <Megaphone className="h-4 w-4 text-brand-secondary" />
          Important notices
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-brand-primary"
          onClick={goToAll}
        >
          View all
          <ChevronRight className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3">
          {items.map((n) => (
            <ListRow
              key={n.id}
              as="li"
              title={n.title}
              subtitle={
                <span className="flex items-center gap-2">
                  <ToneChip tone={n.priority === "urgent" ? "rose" : "peach"}>
                    {n.priority === "urgent" ? (
                      <>
                        <AlertTriangle className="mr-1 h-3 w-3" aria-hidden />
                        Urgent
                      </>
                    ) : (
                      "Important"
                    )}
                  </ToneChip>
                  <span className="truncate text-ink-500">
                    {format(new Date(n.published_at), "d MMM")}
                  </span>
                </span>
              }
              onClick={goToAll}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
