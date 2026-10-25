import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { ConversationListRow } from "@/hooks/useConversations";
import { supabase } from "@/integrations/supabase/client";
import { getDisplayName } from "@/lib/displayName";

/* Names for the people in a conversation list.
 *
 * The list rows carry only participant ids, so without this every direct
 * thread reads "Direct message". One bounded `IN` lookup over the ids on
 * screen gives each row a real name. The list itself is capped at 200 threads,
 * so the id set is bounded too; it is still chunked so a URL never carries
 * more than a hundred uuids. Shared by the inbox and the admin overview so the
 * two can never disagree about who a thread is with. */

const CHUNK = 100;

export function useParticipantNames(rows: ConversationListRow[], userId: string | null) {
  const ids = useMemo(() => {
    const set = new Set<string>();
    for (const c of rows) {
      if (c.type !== "direct") continue;
      for (const p of c.conversation_participants) {
        if (p.user_id !== userId) set.add(p.user_id);
      }
    }
    return [...set].sort();
  }, [rows, userId]);

  return useQuery({
    queryKey: ["messages", "participant-names", ids.join(",")],
    queryFn: async (): Promise<Record<string, string>> => {
      const out: Record<string, string> = {};
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", ids.slice(i, i + CHUNK));
        if (error) throw error;
        for (const p of data ?? []) out[p.id] = getDisplayName(p, "Someone");
      }
      return out;
    },
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/** Who a thread is with, from the viewer's seat.
 *
 *  A participant sees the other person's name. Someone overseeing threads
 *  they are not part of (an admin) sees both names, "Anita Sharma and
 *  Teacher2", so the row still says who is talking to whom. */
export function conversationTitle(
  c: ConversationListRow,
  names: Record<string, string>,
  userId: string | null,
): string {
  if (c.type === "class_announcement") return c.title?.trim() || "Class announcement";
  if (c.type === "broadcast") return c.title?.trim() || "Announcement";
  if (c.type !== "direct") return c.title?.trim() || "Group";

  const isParticipant = c.conversation_participants.some((p) => p.user_id === userId);
  const others = c.conversation_participants
    .filter((p) => p.user_id !== userId)
    .map((p) => names[p.user_id])
    .filter((n): n is string => Boolean(n));

  if (isParticipant) return others[0] || c.title?.trim() || "Direct message";
  if (others.length >= 2) return `${others[0]} and ${others[1]}`;
  return others[0] || c.title?.trim() || "Direct message";
}

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter((w) => w && w.toLowerCase() !== "and")
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
