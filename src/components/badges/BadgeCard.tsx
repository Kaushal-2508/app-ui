import { motion } from "framer-motion";
import { BadgeIcon } from "./BadgeIcon";
import { BadgeDefinition, BadgeTier, getTierStyles } from "@/hooks/useBadges";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface BadgeCardProps {
  badge: BadgeDefinition;
  earned?: boolean;
  earnedAt?: string;
  showTooltip?: boolean;
  size?: 'sm' | 'md' | 'lg';
  animate?: boolean;
}

export function BadgeCard({ 
  badge, 
  earned = true, 
  earnedAt, 
  showTooltip = true,
  size = 'md',
  animate = true 
}: BadgeCardProps) {
  const tierStyles = getTierStyles(badge.tier as BadgeTier);
  
  const sizeClasses = {
    sm: 'w-12 h-12',
    md: 'w-16 h-16',
    lg: 'w-24 h-24',
  };

  const iconSizes = {
    sm: 20,
    md: 28,
    lg: 40,
  };

  const badgeContent = (
    <motion.div
      initial={animate ? { scale: 0, rotate: -180 } : false}
      animate={{ scale: 1, rotate: 0 }}
      whileHover={earned ? { scale: 1.1, rotate: 5 } : undefined}
      transition={{ 
        type: "spring", 
        stiffness: 260, 
        damping: 20,
        delay: Math.random() * 0.2 
      }}
      className={cn(
        "relative flex items-center justify-center rounded-full border-2 transition-all duration-300",
        sizeClasses[size],
        earned ? [
          tierStyles.bg,
          tierStyles.border,
          `shadow-lg ${tierStyles.glow}`,
          "cursor-pointer"
        ] : [
          "bg-muted/30 border-muted",
          "opacity-40 grayscale cursor-default"
        ]
      )}
    >
      {/* Glow effect for diamond tier */}
      {earned && badge.tier === 'diamond' && (
        <motion.div
          className="absolute inset-0 rounded-full bg-gradient-to-r from-purple-400/30 via-pink-500/30 to-purple-400/30"
          animate={{ 
            opacity: [0.5, 1, 0.5],
            scale: [1, 1.1, 1],
          }}
          transition={{ 
            duration: 2, 
            repeat: Infinity,
            ease: "easeInOut" 
          }}
        />
      )}
      
      {/* Shimmer effect for gold and above */}
      {earned && ['gold', 'platinum', 'diamond'].includes(badge.tier) && (
        <motion.div
          className="absolute inset-0 rounded-full overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
            animate={{ x: ['-100%', '100%'] }}
            transition={{ 
              duration: 2, 
              repeat: Infinity, 
              repeatDelay: 3,
              ease: "easeInOut" 
            }}
          />
        </motion.div>
      )}
      
      <BadgeIcon 
        iconName={badge.icon_name} 
        size={iconSizes[size]}
        className={cn(
          "relative z-10 transition-colors",
          earned ? tierStyles.text : "text-muted-foreground/50"
        )}
      />
      
      {/* Points indicator */}
      {earned && size !== 'sm' && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.3, type: "spring" }}
          className={cn(
            "absolute -bottom-1 -right-1 text-[10px] font-bold rounded-full px-1.5 py-0.5",
            `bg-gradient-to-r ${tierStyles.gradient}`,
            "text-white shadow-md"
          )}
        >
          +{badge.points}
        </motion.div>
      )}
    </motion.div>
  );

  if (!showTooltip) return badgeContent;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {badgeContent}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[200px]">
        <div className="space-y-1">
          <p className="font-semibold">{badge.name}</p>
          <p className="text-xs text-muted-foreground">{badge.description}</p>
          {earned && earnedAt && (
            <p className="text-xs text-muted-foreground">
              Earned: {new Date(earnedAt).toLocaleDateString()}
            </p>
          )}
          <div className="flex items-center gap-2 text-xs">
            <span className={cn("font-medium capitalize", tierStyles.text)}>
              {badge.tier}
            </span>
            <span className="text-muted-foreground">• {badge.points} pts</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
