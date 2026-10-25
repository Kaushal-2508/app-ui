import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Send, Sparkles, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface MascotChatProps {
  mascotName: string;
  mascotGender: "buddy" | "spark";
  onClose: () => void;
}

const QUICK_ACTIONS = [
  { label: "How do I create an exam?", query: "How do I create a new exam?" },
  { label: "View my results", query: "How can I see my exam results?" },
  { label: "Upload answer sheets", query: "How do I upload scanned answer sheets?" },
  { label: "Navigate to dashboard", query: "Take me to my dashboard" },
];

export function MascotChat({ mascotName, mascotGender, onClose }: MascotChatProps) {
  const { data: roleInfo } = useUserRole();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initial greeting
  useEffect(() => {
    const greeting = mascotGender === "spark"
      ? `Hey there! ⚡ I'm ${mascotName}, your energetic guide! Ready to help you conquer SALCI? Ask me anything!`
      : `Hello! 👋 I'm ${mascotName}, here to help you navigate SALCI smoothly. What would you like to know?`;
    
    setMessages([{ role: "assistant", content: greeting }]);
  }, [mascotName, mascotGender]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async (userMessage: string) => {
    if (!userMessage.trim() || isLoading) return;

    const newMessages: Message[] = [...messages, { role: "user", content: userMessage }];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      const response = await supabase.functions.invoke("mascot-chat", {
        body: {
          messages: newMessages,
          mascotName,
          mascotGender,
          userRole: roleInfo?.primaryRole || "student",
        },
      });

      if (response.error) throw response.error;

      const assistantMessage = response.data?.message || "I'm not sure how to help with that. Try asking something else!";
      setMessages([...newMessages, { role: "assistant", content: assistantMessage }]);
    } catch (error) {
      console.error("Mascot chat error:", error);
      const fallbackMessage = mascotGender === "spark"
        ? "Oops! My circuits got a bit tangled. 😅 Try again?"
        : "I had a little hiccup there. Could you try asking again?";
      setMessages([...newMessages, { role: "assistant", content: fallbackMessage }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const mascotColors = mascotGender === "spark"
    ? { header: "from-pink-500 to-rose-600", button: "bg-pink-500 hover:bg-pink-600" }
    : { header: "from-blue-500 to-cyan-600", button: "bg-blue-500 hover:bg-blue-600" };

  return (
    <Card className="shadow-xl border-2">
      {/* Header */}
      <CardHeader className={`bg-gradient-to-r ${mascotColors.header} text-white rounded-t-lg py-3`}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            {mascotName}
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-white hover:bg-white/20"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Messages */}
        <ScrollArea className="h-72 p-4" ref={scrollRef}>
          <div className="space-y-4">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3 py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Quick Actions */}
        {messages.length <= 2 && (
          <div className="px-4 pb-2">
            <p className="text-xs text-muted-foreground mb-2">Quick questions:</p>
            <div className="flex flex-wrap gap-1">
              {QUICK_ACTIONS.slice(0, 3).map((action, idx) => (
                <Button
                  key={idx}
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => sendMessage(action.query)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-3 border-t flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask ${mascotName} anything...`}
            className="flex-1"
            disabled={isLoading}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isLoading}
            className={mascotColors.button}
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
