import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MascotChat } from "./MascotChat";
import { MascotSetupDialog } from "./MascotSetupDialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

interface MascotProfile {
  name: string;
  gender: "buddy" | "spark";
}

export function SalciBuddy() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [mascotProfile, setMascotProfile] = useState<MascotProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showTip, setShowTip] = useState(false);

  const [isDismissed, setIsDismissed] = useState(false);

  // Load mascot profile
  useEffect(() => {
    const loadProfile = async () => {
      if (!user?.id) {
        setIsLoading(false);
        return;
      }

      // Query mascot-related fields individually to avoid type issues with new columns
      const { data } = await supabase
        .from("profiles")
        .select("mascot_name, mascot_gender, onboarding_completed")
        .eq("id", user.id)
        .single();

      // Check for dismissed flag separately to handle type regeneration
      const { data: dismissData } = await supabase
        .from("profiles")
        .select("mascot_dismissed")
        .eq("id", user.id)
        .single() as { data: { mascot_dismissed?: boolean } | null };

      if (data?.mascot_name && data?.mascot_gender) {
        setMascotProfile({
          name: data.mascot_name,
          gender: data.mascot_gender as "buddy" | "spark",
        });
      } else if (dismissData?.mascot_dismissed) {
        // User has dismissed the mascot setup permanently
        setIsDismissed(true);
      } else {
        // Show setup for users without mascot configured (only once after 3 seconds)
        setTimeout(() => setShowSetup(true), 3000);
      }

      setIsLoading(false);
    };

    loadProfile();
  }, [user?.id]);

  const handleDismiss = async () => {
    setIsDismissed(true);
    setShowSetup(false);
    if (user?.id) {
      await supabase
        .from("profiles")
        .update({ mascot_dismissed: true } as { mascot_dismissed: boolean })
        .eq("id", user.id);
    }
  };

  // Show contextual tip occasionally
  useEffect(() => {
    if (!mascotProfile || isOpen) return;

    const tipTimer = setTimeout(() => {
      setShowTip(true);
      setTimeout(() => setShowTip(false), 5000);
    }, 30000);

    return () => clearTimeout(tipTimer);
  }, [mascotProfile, isOpen]);

  const handleSetupComplete = (name: string, gender: "buddy" | "spark") => {
    setMascotProfile({ name, gender });
    setShowSetup(false);
  };

  if (isLoading || !user || isDismissed) return null;

  // Mascot colors based on gender
  const mascotColors = mascotProfile?.gender === "spark"
    ? { bg: "from-pink-400 to-rose-500", glow: "shadow-pink-500/50", eyes: "bg-rose-900" }
    : { bg: "from-blue-400 to-cyan-500", glow: "shadow-blue-500/50", eyes: "bg-blue-900" };

  const contextualTips = [
    "Need help? I'm here! 💬",
    "Click me for quick tips! ✨",
    "Let's explore together! 🚀",
  ];

  return (
    <>
      <MascotSetupDialog
        open={showSetup}
        onOpenChange={setShowSetup}
        onComplete={handleSetupComplete}
        onDismiss={handleDismiss}
      />

      {mascotProfile && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
          {/* Contextual Tip Bubble */}
          <AnimatePresence>
            {showTip && !isOpen && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.9 }}
                className="bg-popover border rounded-lg px-3 py-2 shadow-lg max-w-48 text-sm"
              >
                <p>{contextualTips[Math.floor(Math.random() * contextualTips.length)]}</p>
                <div className="absolute bottom-[-6px] right-8 w-3 h-3 bg-popover border-r border-b rotate-45" />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Chat Panel */}
          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.95 }}
                className="w-80 sm:w-96"
              >
                <MascotChat
                  mascotName={mascotProfile.name}
                  mascotGender={mascotProfile.gender}
                  onClose={() => setIsOpen(false)}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Mascot Button */}
          <motion.div
            className="relative cursor-pointer"
            onClick={() => setIsOpen(!isOpen)}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
          >
            {/* Close/Dismiss mascot button */}
            <Button
              variant="ghost"
              size="icon"
              className="absolute -top-2 -left-2 h-5 w-5 rounded-full bg-muted hover:bg-destructive hover:text-destructive-foreground z-10 p-0"
              onClick={(e) => {
                e.stopPropagation();
                handleDismiss();
              }}
            >
              <X className="h-3 w-3" />
            </Button>

            {/* Glow effect */}
            <div className={`absolute inset-0 rounded-full bg-gradient-to-br ${mascotColors.bg} blur-md opacity-50 ${mascotColors.glow}`} />
            
            {/* Mascot body */}
            <motion.div
              className={`relative w-14 h-14 rounded-full bg-gradient-to-br ${mascotColors.bg} shadow-lg flex items-center justify-center overflow-hidden`}
              animate={{
                y: [0, -3, 0],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            >
              {/* Face */}
              <div className="relative flex flex-col items-center">
                {/* Eyes */}
                <div className="flex gap-2 mb-1">
                  <motion.div
                    className={`w-2 h-2.5 rounded-full ${mascotColors.eyes}`}
                    animate={{ scaleY: [1, 0.3, 1] }}
                    transition={{ duration: 3, repeat: Infinity, repeatDelay: 2 }}
                  />
                  <motion.div
                    className={`w-2 h-2.5 rounded-full ${mascotColors.eyes}`}
                    animate={{ scaleY: [1, 0.3, 1] }}
                    transition={{ duration: 3, repeat: Infinity, repeatDelay: 2 }}
                  />
                </div>
                {/* Mouth */}
                <div className="w-3 h-1.5 rounded-full bg-white/80" />
              </div>

              {/* Sparkle effects */}
              <motion.div
                className="absolute top-1 right-1"
                animate={{ opacity: [0, 1, 0], scale: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Sparkles className="h-2 w-2 text-white" />
              </motion.div>
            </motion.div>

            {/* Badge for open/close */}
            <div className={`absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center ${
              isOpen ? "bg-destructive" : "bg-primary"
            } text-white shadow-md`}>
              {isOpen ? (
                <X className="h-3 w-3" />
              ) : (
                <MessageCircle className="h-3 w-3" />
              )}
            </div>
          </motion.div>

          {/* Name label */}
          {!isOpen && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-xs font-medium text-muted-foreground bg-background/80 px-2 py-0.5 rounded-full"
            >
              {mascotProfile.name}
            </motion.span>
          )}
        </div>
      )}
    </>
  );
}
