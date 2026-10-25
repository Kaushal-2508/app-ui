import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface MascotSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (name: string, gender: "buddy" | "spark") => void;
  onDismiss?: () => void;
}

export function MascotSetupDialog({ open, onOpenChange, onComplete, onDismiss }: MascotSetupDialogProps) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [selectedGender, setSelectedGender] = useState<"buddy" | "spark" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || !selectedGender || !user?.id) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          mascot_name: name.trim(),
          mascot_gender: selectedGender,
        })
        .eq("id", user.id);

      if (error) throw error;

      toast.success(`${name} is ready to help you! 🎉`);
      onComplete(name.trim(), selectedGender);
    } catch (error) {
      console.error("Failed to save mascot:", error);
      toast.error("Failed to save your buddy");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDismiss = async () => {
    if (dontShowAgain && user?.id) {
      // Save dismissal preference to prevent showing again
      try {
        await (supabase.from("profiles") as any)
          .update({ mascot_dismissed: true })
          .eq("id", user.id);
      } catch (e) {
        console.error("Failed to save mascot dismissal preference:", e);
      }
    }
    onOpenChange(false);
    onDismiss?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" />
            Meet Your SALCI Buddy!
          </DialogTitle>
          <DialogDescription>
            Your personal helper is here to guide you through the portal. Give them a name and choose their personality!
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Gender Selection */}
          <div className="space-y-3">
            <Label>Choose a personality</Label>
            <div className="grid grid-cols-2 gap-4">
              {/* Buddy - Blue/Calm */}
              <motion.div
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setSelectedGender("buddy")}
                className={`cursor-pointer p-4 rounded-xl border-2 transition-colors ${
                  selectedGender === "buddy"
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
                    : "border-border hover:border-blue-300"
                }`}
              >
                <div className="flex flex-col items-center gap-3">
                  {/* Buddy mascot preview */}
                  <motion.div
                    className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/30"
                    animate={{ y: [0, -2, 0] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    <div className="flex flex-col items-center">
                      <div className="flex gap-2 mb-1">
                        <div className="w-2 h-2.5 rounded-full bg-blue-900" />
                        <div className="w-2 h-2.5 rounded-full bg-blue-900" />
                      </div>
                      <div className="w-3 h-1.5 rounded-full bg-white/80" />
                    </div>
                  </motion.div>
                  <div className="text-center">
                    <p className="font-medium">Buddy</p>
                    <p className="text-xs text-muted-foreground">Calm & Encouraging</p>
                  </div>
                </div>
              </motion.div>

              {/* Spark - Pink/Energetic */}
              <motion.div
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setSelectedGender("spark")}
                className={`cursor-pointer p-4 rounded-xl border-2 transition-colors ${
                  selectedGender === "spark"
                    ? "border-pink-500 bg-pink-50 dark:bg-pink-950/30"
                    : "border-border hover:border-pink-300"
                }`}
              >
                <div className="flex flex-col items-center gap-3">
                  {/* Spark mascot preview */}
                  <motion.div
                    className="w-16 h-16 rounded-full bg-gradient-to-br from-pink-400 to-rose-500 flex items-center justify-center shadow-lg shadow-pink-500/30"
                    animate={{ y: [0, -3, 0], rotate: [-2, 2, -2] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    <div className="flex flex-col items-center">
                      <div className="flex gap-2 mb-1">
                        <div className="w-2 h-2.5 rounded-full bg-rose-900" />
                        <div className="w-2 h-2.5 rounded-full bg-rose-900" />
                      </div>
                      <div className="w-4 h-2 rounded-t-full bg-white/80" />
                    </div>
                  </motion.div>
                  <div className="text-center">
                    <p className="font-medium">Spark</p>
                    <p className="text-xs text-muted-foreground">Energetic & Analytical</p>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>

          {/* Name Input */}
          <div className="space-y-2">
            <Label htmlFor="mascot-name">Give them a name</Label>
            <Input
              id="mascot-name"
              placeholder="e.g., Zia, Nova, Pip..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
            />
            <p className="text-xs text-muted-foreground">
              Choose a friendly name for your helper!
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="dont-show-again"
              checked={dontShowAgain}
              onCheckedChange={(checked) => setDontShowAgain(checked === true)}
            />
            <label
              htmlFor="dont-show-again"
              className="text-sm text-muted-foreground cursor-pointer"
            >
              Don't show this again
            </label>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={handleDismiss}>
              Skip
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!name.trim() || !selectedGender || isSubmitting}
            >
              {isSubmitting ? "Creating..." : "Create My Buddy!"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
