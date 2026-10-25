import { motion, AnimatePresence } from "framer-motion";
import { BadgeCard } from "./BadgeCard";
import { BadgeDefinition } from "@/hooks/useBadges";
import { X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";

interface NewBadgeNotificationProps {
  badge: BadgeDefinition | null;
  onClose: () => void;
}

export function NewBadgeNotification({ badge, onClose }: NewBadgeNotificationProps) {
  return (
    <AnimatePresence>
      {badge && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.8 }}
          transition={{ type: "spring", damping: 15 }}
          className="fixed bottom-4 right-4 z-50"
        >
          <motion.div 
            className="relative bg-card border shadow-2xl rounded-xl p-6 max-w-sm"
            animate={{ 
              boxShadow: [
                "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
                "0 25px 50px -12px rgba(168, 85, 247, 0.4)",
                "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              ]
            }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            {/* Close button */}
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 h-6 w-6"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>

            {/* Confetti effect */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-xl">
              {[...Array(12)].map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute w-2 h-2 rounded-full"
                  style={{
                    background: ['#FFD700', '#FF6B6B', '#4ECDC4', '#A855F7', '#3B82F6'][i % 5],
                    left: `${Math.random() * 100}%`,
                    top: '-10px',
                  }}
                  animate={{
                    y: [0, 200],
                    x: [0, (Math.random() - 0.5) * 100],
                    opacity: [1, 0],
                    rotate: [0, 360],
                  }}
                  transition={{
                    duration: 1.5,
                    delay: i * 0.1,
                    repeat: Infinity,
                    repeatDelay: 2,
                  }}
                />
              ))}
            </div>

            {/* Content */}
            <div className="text-center space-y-4">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring" }}
                className="flex items-center justify-center gap-2 text-primary"
              >
                <Sparkles className="h-5 w-5" />
                <span className="font-semibold">New Badge Earned!</span>
                <Sparkles className="h-5 w-5" />
              </motion.div>

              <TooltipProvider>
                <div className="flex justify-center">
                  <BadgeCard badge={badge} size="lg" showTooltip={false} />
                </div>
              </TooltipProvider>

              <div>
                <h3 className="font-bold text-lg">{badge.name}</h3>
                <p className="text-sm text-muted-foreground">{badge.description}</p>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  className="text-sm font-medium text-primary mt-2"
                >
                  +{badge.points} points earned!
                </motion.p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
