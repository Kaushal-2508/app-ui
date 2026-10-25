import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Send, MessageSquare, Mic, MicOff, Volume2, VolumeX, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { getDisplayName } from "@/lib/displayName";

interface TaskComment {
  id: string;
  task_id: string;
  user_id: string;
  content: string;
  audio_url: string | null;
  created_at: string;
  user_profile?: {
    full_name: string;
    email: string;
  };
}

interface TaskCommentsProps {
  taskId: string;
  canComment: boolean;
}

export function useTaskComments(taskId: string | null) {
  return useQuery({
    queryKey: ["task-comments", taskId],
    enabled: !!taskId,
    queryFn: async () => {
      if (!taskId) return [];

      const { data, error } = await supabase
        .from("task_comments")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true });

      if (error) throw error;

      // Fetch user profiles
      const userIds = [...new Set(data?.map(c => c.user_id) || [])];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);

      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

      return (data || []).map(comment => ({
        ...comment,
        user_profile: profileMap.get(comment.user_id),
      })) as TaskComment[];
    },
  });
}

export function useAddTaskComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, content, audioUrl }: { taskId: string; content: string; audioUrl?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("task_comments").insert({
        task_id: taskId,
        user_id: user.id,
        content,
        audio_url: audioUrl || null,
      });

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["task-comments", variables.taskId] });
      toast.success("Comment added");
    },
    onError: (error: Error) => {
      toast.error("Failed to add comment: " + error.message);
    },
  });
}

export function TaskComments({ taskId, canComment }: TaskCommentsProps) {
  const [newComment, setNewComment] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [speakingCommentId, setSpeakingCommentId] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const { data: comments, isLoading } = useTaskComments(taskId);
  const addComment = useAddTaskComment();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    await addComment.mutateAsync({ taskId, content: newComment.trim() });
    setNewComment("");
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach(track => track.stop());
        await uploadVoiceComment(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      toast.info("Recording started...");
    } catch (error) {
      toast.error("Could not access microphone");
      console.error(error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const uploadVoiceComment = async (audioBlob: Blob) => {
    setIsUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const fileName = `${user.id}/${Date.now()}.webm`;
      const { error: uploadError } = await supabase.storage
        .from('task-voice-comments')
        .upload(fileName, audioBlob, { contentType: 'audio/webm' });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('task-voice-comments')
        .getPublicUrl(fileName);

      await addComment.mutateAsync({ 
        taskId, 
        content: "🎤 Voice message", 
        audioUrl: publicUrl 
      });

      toast.success("Voice comment added");
    } catch (error) {
      toast.error("Failed to upload voice comment");
      console.error(error);
    } finally {
      setIsUploading(false);
    }
  };

  const speakComment = (commentId: string, text: string) => {
    if (speakingCommentId === commentId) {
      speechSynthesis.cancel();
      setSpeakingCommentId(null);
      return;
    }

    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setSpeakingCommentId(null);
    utterance.onerror = () => setSpeakingCommentId(null);
    
    setSpeakingCommentId(commentId);
    speechSynthesis.speak(utterance);
  };

  const getInitials = (name?: string, email?: string) => {
    if (name) {
      return name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
    }
    return email?.substring(0, 2).toUpperCase() || "??";
  };

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium flex items-center gap-2">
        <MessageSquare className="h-4 w-4" />
        Comments ({comments?.length || 0})
      </h4>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : comments && comments.length > 0 ? (
        <div className="space-y-3 max-h-60 overflow-y-auto">
          {comments.map((comment) => (
            <div key={comment.id} className="flex gap-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs bg-muted">
                  {getInitials(comment.user_profile?.full_name, comment.user_profile?.email)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {getDisplayName(comment.user_profile)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 text-sm text-muted-foreground bg-muted/50 rounded-lg p-2">
                    {comment.audio_url ? (
                      <audio controls src={comment.audio_url} className="w-full h-8" />
                    ) : (
                      <p>{comment.content}</p>
                    )}
                  </div>
                  {!comment.audio_url && comment.content && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => speakComment(comment.id, comment.content)}
                      title={speakingCommentId === comment.id ? "Stop speaking" : "Read aloud"}
                    >
                      {speakingCommentId === comment.id ? (
                        <VolumeX className="h-4 w-4 text-primary" />
                      ) : (
                        <Volume2 className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-4">
          No comments yet
        </p>
      )}

      {canComment && (
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Textarea
            placeholder="Add a comment..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className="min-h-[60px] resize-none"
          />
          <div className="flex flex-col gap-1">
            <Button 
              type="submit" 
              size="icon" 
              disabled={!newComment.trim() || addComment.isPending}
            >
              <Send className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant={isRecording ? "destructive" : "outline"}
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isUploading}
              title={isRecording ? "Stop recording" : "Record voice message"}
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isRecording ? (
                <MicOff className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
