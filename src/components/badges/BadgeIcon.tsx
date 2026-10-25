import {
  Award, Trophy, Star, Crown, Shield, Medal,
  PlayCircle, Compass, TrendingUp, CheckCircle,
  Sun, Flame, Zap, BookOpen, Library, FileText,
  Files, Building, CheckSquare, ClipboardCheck,
  Users, Clock, Clipboard, CheckCircle2, Users2,
  Gem, Sparkles, Target, Activity, CalendarCheck,
  RotateCcw, ShieldCheck, Dumbbell, NotebookPen,
  Swords, Rocket, Crosshair, ScrollText, Percent,
  Infinity as InfinityIcon,
  type LucideIcon
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = {
  'award': Award,
  'trophy': Trophy,
  'star': Star,
  'crown': Crown,
  'shield': Shield,
  'medal': Medal,
  'play-circle': PlayCircle,
  'compass': Compass,
  'trending-up': TrendingUp,
  'check-circle': CheckCircle,
  'sun': Sun,
  'flame': Flame,
  'zap': Zap,
  'book-open': BookOpen,
  'library': Library,
  'file-plus': FileText,
  'files': Files,
  'building': Building,
  'check-square': CheckSquare,
  'clipboard-check': ClipboardCheck,
  'badge-check': Award,
  'users': Users,
  'clock': Clock,
  'clipboard': Clipboard,
  'check-circle-2': CheckCircle2,
  'users-2': Users2,
  // Added 2026-08-13 for the redesigned student achievement set (streak
  // ranks / quest log / clutch plays / monthly form / legendary).
  'gem': Gem,
  'sparkles': Sparkles,
  'target': Target,
  'activity': Activity,
  'calendar-check': CalendarCheck,
  'rotate-ccw': RotateCcw,
  'shield-check': ShieldCheck,
  'dumbbell': Dumbbell,
  'notebook-pen': NotebookPen,
  'swords': Swords,
  'rocket': Rocket,
  'crosshair': Crosshair,
  'scroll-text': ScrollText,
  'percent': Percent,
  'infinity': InfinityIcon,
};

interface BadgeIconProps {
  iconName: string;
  className?: string;
  size?: number;
}

export function BadgeIcon({ iconName, className = "", size = 24 }: BadgeIconProps) {
  const IconComponent = iconMap[iconName] || Award;
  return <IconComponent className={className} size={size} />;
}
