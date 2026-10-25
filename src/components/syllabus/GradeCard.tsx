import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { GraduationCap, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

interface GradeCardProps {
  id: string;
  gradeNumber: number;
  gradeName: string;
  subjectCount?: number;
  topicCount?: number;
  isSelected?: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}

export const GradeCard = forwardRef<HTMLDivElement, GradeCardProps>(function GradeCard({
  gradeName,
  subjectCount = 0,
  topicCount = 0,
  isSelected,
  onSelect,
  onDelete,
}, ref) {
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "group relative flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-all duration-200",
        isSelected
          ? "bg-primary/10 border-primary shadow-sm"
          : "bg-card hover:bg-accent/50 border-border hover:border-primary/30"
      )}
      onClick={onSelect}
    >
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors",
          isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        )}
      >
        <GraduationCap className="h-5 w-5" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <span className="flex-1 min-w-0 font-semibold text-[13px] leading-snug text-foreground line-clamp-2">{gradeName}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {subjectCount} {subjectCount === 1 ? "subject" : "subjects"} • {topicCount} {topicCount === 1 ? "chapter" : "chapters"}
        </p>
      </div>

      <div className="flex items-center gap-1">
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
        <ChevronRight
          className={cn(
            "h-5 w-5 transition-transform",
            isSelected ? "text-primary rotate-0" : "text-muted-foreground"
          )}
        />
      </div>
    </motion.div>
  );
});
