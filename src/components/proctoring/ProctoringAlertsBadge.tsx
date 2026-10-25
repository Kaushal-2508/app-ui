import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Shield } from "lucide-react";

export function ProctoringAlertsBadge() {
  const { data: pendingCount } = useQuery({
    queryKey: ["proctoring-pending-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("proctoring_sessions")
        .select("*", { count: "exact", head: true })
        .eq("requires_review", true)
        .eq("review_status", "pending");

      if (error) throw error;
      return count || 0;
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  if (!pendingCount || pendingCount === 0) return null;

  return (
    <Badge variant="destructive" className="ml-auto">
      {pendingCount}
    </Badge>
  );
}
