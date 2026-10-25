import { useState, useRef, useEffect } from "react";
import { useMessages } from "@/hooks/useConversations";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Send, Loader2, Paperclip, FileIcon, ImageIcon, User, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getDisplayName } from "@/lib/displayName";
import { openExternal } from "@/lib/native";

interface Props {
  conversationId: string;
}

export function MessageThread({ conversationId }: Props) {
  const { messages, isLoading, sendMessage, markAsRead } = useMessages(conversationId);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: currentUser } = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },
  });

  // Fetch conversation details (title, type, participants' names)
  const { data: conversationInfo } = useQuery({
    queryKey: ["conversation-info", conversationId],
    queryFn: async () => {
      const { data: conv } = await supabase
        .from("conversations")
        .select("title, type, class_id")
        .eq("id", conversationId)
        .single();

      const { data: parts } = await supabase
        .from("conversation_participants")
        .select("user_id, last_read_at, role")
        .eq("conversation_id", conversationId);

      // Get the other participant's name for direct conversations
      const otherParticipants = parts?.filter(p => p.user_id !== currentUser?.id) || [];
      let displayName = conv?.title || "";
      let initials = "?";

      if (conv?.type === "class_announcement") {
        displayName = conv?.title || "Class Announcement";
        initials = "CA";
      } else if (conv?.type === "broadcast") {
        displayName = conv?.title || "Announcement";
        initials = "AN";
      } else if (otherParticipants.length > 0) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, email")
          .eq("id", otherParticipants[0].user_id)
          .single();
        displayName = getDisplayName(profile);
        initials = displayName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);
      }

      return {
        displayName,
        initials,
        type: conv?.type,
        participants: parts || [],
      };
    },
    enabled: !!conversationId && !!currentUser,
  });

  const participants = conversationInfo?.participants || [];

  const isReadOnlyBroadcast =
    conversationInfo?.type === "broadcast" &&
    participants.some(
      (p: { user_id: string; role: string }) =>
        p.user_id === currentUser?.id && p.role === "recipient",
    );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    markAsRead.mutate();
  }, [messages.length, conversationId]);

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage.mutate({ content: input.trim() });
    setInput("");
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    const ext = file.name.split(".").pop();
    const path = `${conversationId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("message-attachments")
      .upload(path, file);

    if (uploadError) {
      toast.error("Upload failed: " + uploadError.message);
      return;
    }

    const { data: urlData } = supabase.storage
      .from("message-attachments")
      .getPublicUrl(path);

    const isImage = file.type.startsWith("image/");
    const messageType = isImage ? "image" : "file";

    // Send as a message with attachment info in content
    const { error } = await supabase.from("conversation_messages").insert({
      conversation_id: conversationId,
      sender_id: currentUser.id,
      content: file.name,
      message_type: messageType,
      attachment_url: urlData.publicUrl,
      attachment_name: file.name,
    });

    if (error) toast.error("Failed to send attachment");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Check if a message has been "seen" by other participants
  const isMessageSeen = (msgCreatedAt: string) => {
    if (!participants || !currentUser) return false;
    return participants.some(
      (p) => p.user_id !== currentUser.id && p.last_read_at && new Date(p.last_read_at) >= new Date(msgCreatedAt)
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Chat Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background">
        <Avatar className="h-9 w-9">
          <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
            {conversationInfo?.type === "class_announcement" ? (
              <Megaphone className="h-4 w-4" />
            ) : (
              conversationInfo?.initials || "?"
            )}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{conversationInfo?.displayName || "Conversation"}</p>
          <p className="text-xs text-muted-foreground">
            {conversationInfo?.type === "class_announcement" ? "Class announcement" : "Direct message"}
          </p>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No messages yet. Start the conversation!
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isMe = msg.sender_id === currentUser?.id;
            const isLast = idx === messages.length - 1;
            const seen = isMe && isMessageSeen(msg.created_at);

            return (
              <div key={msg.id} className={cn("flex", isMe ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[70%] rounded-2xl px-4 py-2.5",
                  isMe ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted rounded-bl-md"
                )}>
                  {!isMe && (
                    <p className="text-xs font-medium mb-1 opacity-70">
                      {getDisplayName(msg.sender)}
                    </p>
                  )}

                  {/* Render attachment if present */}
                  {msg.attachment_url && msg.message_type === "image" ? (
                    <img
                      src={msg.attachment_url}
                      alt={msg.attachment_name || "Image"}
                      className="rounded-lg max-h-48 mb-1 cursor-pointer"
                      onClick={() => openExternal(msg.attachment_url)}
                    />
                  ) : msg.attachment_url ? (
                    <a
                      href={msg.attachment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn("flex items-center gap-2 p-2 rounded-lg mb-1", isMe ? "bg-primary-foreground/10" : "bg-background/50")}
                    >
                      <FileIcon className="h-4 w-4" />
                      <span className="text-xs underline truncate">{msg.attachment_name || "File"}</span>
                    </a>
                  ) : null}

                  {/* Text content */}
                  {msg.message_type === "text" || !msg.attachment_url ? (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  ) : null}

                  <div className="flex items-center gap-1 mt-1">
                    <p className={cn("text-[10px]", isMe ? "text-primary-foreground/60" : "text-muted-foreground")}>
                      {format(new Date(msg.created_at), "h:mm a")}
                    </p>
                    {isMe && seen && (
                      <span className="text-[10px] text-primary-foreground/60">• Seen</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      {isReadOnlyBroadcast ? (
        // A broadcast can carry hundreds of recipients. Letting one of them
        // reply would put that reply in front of every other recipient, so the
        // thread is read-only for them; anyone who needs to respond starts a
        // direct message. The sender can still add to their own broadcast.
        <div className="p-3 border-t text-center text-sm text-muted-foreground">
          This is an announcement. Reply directly to the sender if you need to
          respond.
        </div>
      ) : (
      <div className="p-3 border-t flex gap-2">
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" />
        <Button variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} className="flex-shrink-0">
          <Paperclip className="h-4 w-4" />
        </Button>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          className="flex-1"
        />
        <Button onClick={handleSend} size="icon" disabled={!input.trim() || sendMessage.isPending}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
      )}
    </div>
  );
}
