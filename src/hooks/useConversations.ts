import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from "@/lib/auth";
import { toast } from "sonner";
import { useEffect } from "react";

export function useTeacherClasses() {
  return useQuery({
    queryKey: ["teacher-assigned-classes"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("class_assignments")
        .select("class_id, classes!inner(id, name, section, academic_year, institution_id)")
        .eq("user_id", user.id)
        .eq("role", "teacher");
      if (error) throw error;
      // Deduplicate by class_id
      const seen = new Set<string>();
      return (data || []).filter((d) => {
        if (seen.has(d.class_id)) return false;
        seen.add(d.class_id);
        return true;
      }).map((d) => d.classes);
    },
  });
}

export function useClassStudents(classId: string | null) {
  return useQuery({
    queryKey: ["class-students", classId],
    queryFn: async () => {
      if (!classId) return [];
      const { data, error } = await supabase
        .from("class_assignments")
        .select("user_id, profiles!class_assignments_user_id_fkey!inner(id, full_name, email)")
        .eq("class_id", classId)
        .eq("role", "student");
      if (error) throw error;
      return (data || []).map((d) => d.profiles);
    },
    enabled: !!classId,
  });
}

export interface ConversationListRow {
  id: string;
  type: string;
  title: string | null;
  class_id: string | null;
  updated_at: string;
  conversation_participants: { user_id: string; last_read_at: string | null }[];
  /** At most ONE row: the newest message, fetched via a referenced-table
   *  order + limit. Older messages load only when a thread is opened. */
  conversation_messages: {
    id: string;
    content: string;
    sender_id: string | null;
    created_at: string;
    message_type: string;
  }[];
}

/** PostgREST silently caps at 1000 rows; a hard bound keeps the payload
 *  predictable. PERF-DEBT: cursor pagination for people with > 200 threads. */
const CONVERSATION_LIST_LIMIT = 200;

/**
 * A conversation is unread for `userId` when its newest message was sent by
 * someone else after the user's `last_read_at` (or the user has never opened
 * it). Someone who is not a participant (an admin overseeing the school's
 * threads) has no read state, so nothing is ever "new" for them.
 */
export function isConversationUnread(
  conv: ConversationListRow,
  userId: string | null | undefined,
): boolean {
  if (!userId) return false;
  const last = conv.conversation_messages[0];
  if (!last || last.sender_id === userId) return false;
  const me = conv.conversation_participants.find((p) => p.user_id === userId);
  if (!me) return false;
  if (!me.last_read_at) return true;
  return new Date(last.created_at) > new Date(me.last_read_at);
}

export function useConversations(institutionId: string | null) {
  const queryClient = useQueryClient();

  const conversationsQuery = useQuery({
    queryKey: ["conversations", institutionId],
    queryFn: async (): Promise<ConversationListRow[]> => {
      const { data, error } = await supabase
        .from("conversations")
        .select(
          `id, type, title, class_id, updated_at,
           conversation_participants!inner(user_id, last_read_at),
           conversation_messages(id, content, sender_id, created_at, message_type)`,
        )
        .order("updated_at", { ascending: false })
        // Newest message only. Before this the list pulled EVERY message of
        // EVERY conversation just to show a one-line preview.
        .order("created_at", { referencedTable: "conversation_messages", ascending: false })
        .limit(1, { referencedTable: "conversation_messages" })
        .limit(CONVERSATION_LIST_LIMIT);
      if (error) throw error;
      return (data ?? []) as ConversationListRow[];
    },
    enabled: !!institutionId,
    staleTime: 30_000,
    // 30s poll, the floor allowed without a subscription: the unread dot on
    // the list has to appear while the reader sits on another thread or tab,
    // and the per-thread realtime channel only covers the thread that is
    // open. One shared query, so N components cost one request.
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  const getOrCreateConversation = useMutation({
    mutationFn: async ({
      institutionId,
      type,
      targetUserId,
      classId,
    }: {
      institutionId: string;
      type: "direct" | "class_announcement";
      targetUserId?: string;
      classId: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      if (type === "direct" && targetUserId) {
        // Check for existing direct conversation between these two users in this class
        const { data: existing } = await supabase
          .from("conversations")
          .select("id, conversation_participants!inner(user_id)")
          .eq("type", "direct")
          .eq("class_id", classId);

        if (existing) {
          for (const conv of existing) {
            const participants = conv.conversation_participants.map((p) => p.user_id);
            if (participants.includes(user.id) && participants.includes(targetUserId)) {
              return { id: conv.id, created: false };
            }
          }
        }
      }

      if (type === "class_announcement") {
        // Check for existing class announcement conversation
        const { data: existing } = await supabase
          .from("conversations")
          .select("id, conversation_participants!inner(user_id)")
          .eq("type", "class_announcement")
          .eq("class_id", classId);

        if (existing) {
          for (const conv of existing) {
            const participants = conv.conversation_participants.map((p) => p.user_id);
            if (participants.includes(user.id)) {
              return { id: conv.id, created: false };
            }
          }
        }
      }

      // Create new conversation
      const title = type === "class_announcement" ? "Class Announcement" : undefined;
      const conversationId = crypto.randomUUID();
      const { error: convError } = await supabase
        .from("conversations")
        .insert({
          id: conversationId,
          institution_id: institutionId,
          type,
          title: title || null,
          class_id: classId,
          created_by: user.id,
        });
      if (convError) throw convError;

      // Add participants
      const participantIds = type === "direct" && targetUserId
        ? [user.id, targetUserId]
        : [user.id]; // For class announcement, we add just the teacher; students see it via class_id

      // If class_announcement, also add all students in the class
      if (type === "class_announcement") {
        const { data: students } = await supabase
          .from("class_assignments")
          .select("user_id")
          .eq("class_id", classId)
          .eq("role", "student");
        if (students) {
          students.forEach((s) => {
            if (!participantIds.includes(s.user_id)) {
              participantIds.push(s.user_id);
            }
          });
        }
      }

      const { error: partError } = await supabase
        .from("conversation_participants")
        .insert(
          participantIds.map((uid) => ({
            conversation_id: conversationId,
            user_id: uid,
            role: uid === user.id ? "sender" : "recipient",
          }))
        );
      if (partError) throw partError;

      return { id: conversationId, created: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (error: Error) => {
      toast.error("Failed to open conversation: " + error.message);
    },
  });

  return {
    conversations: conversationsQuery.data || [],
    isLoading: conversationsQuery.isLoading,
    isError: conversationsQuery.isError,
    refetch: conversationsQuery.refetch,
    getOrCreateConversation,
  };
}

export function useMessages(conversationId: string | null) {
  const queryClient = useQueryClient();

  const messagesQuery = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: async () => {
      if (!conversationId) return [];
      const { data, error } = await supabase
        .from("conversation_messages")
        .select("*, sender:profiles!conversation_messages_sender_id_fkey(id, full_name)")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!conversationId,
  });

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`messages-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversation_messages", filter: `conversation_id=eq.${conversationId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
          queryClient.invalidateQueries({ queryKey: ["conversations"] });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversationId, queryClient]);

  const sendMessage = useMutation({
    mutationFn: async ({ content, messageType = "text" }: { content: string; messageType?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !conversationId) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("conversation_messages")
        .insert({
          conversation_id: conversationId,
          sender_id: user.id,
          content,
          message_type: messageType,
        });
      if (error) throw error;

      await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
    },
    onError: (error: Error) => {
      toast.error("Failed to send message: " + error.message);
    },
  });

  const markAsRead = useMutation({
    mutationFn: async () => {
      const user = await getCurrentUser();
      if (!user || !conversationId) return;
      const { error } = await supabase
        .from("conversation_participants")
        .update({ last_read_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .eq("user_id", user.id);
      if (error) throw error;

      // Same gesture, same meaning: the bell rows for this thread are read
      // too. Independent of the stamp above (a failure here leaves a stale
      // bell badge, nothing worse), so it is a best-effort second write
      // rather than a transaction.
      const { error: bellError } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("type", "message")
        .eq("is_read", false)
        .contains("metadata", { conversation_id: conversationId });
      if (bellError) throw bellError;
    },
    // The list derives its unread dot from last_read_at, so refresh it as
    // soon as the stamp lands; otherwise the dot lingers until the next poll.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-notification-count"] });
    },
    // Silent by design: a failed read-stamp must not toast over the thread
    // the person is reading. The dot simply survives until the next open.
  });

  return { messages: messagesQuery.data || [], isLoading: messagesQuery.isLoading, sendMessage, markAsRead };
}
