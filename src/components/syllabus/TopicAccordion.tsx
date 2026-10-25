import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, Layers, Trash2, Plus, FileText, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { motion, AnimatePresence } from "framer-motion";
import { StudyMaterialItem } from "./StudyMaterialItem";
import { SourceBadge, SourceType } from "@/components/shared/SourceBadge";
import type { StudyMaterial } from "@/hooks/useSyllabusHierarchy";

interface TopicAccordionProps {
  id: string;
  topicName: string | null;
  topicNameHindi?: string | null;
  difficultyLevel?: string | null;
  learningOutcomes?: string | null;
  materials: StudyMaterial[];
  materialCount?: number;
  isGlobal?: boolean;
  isActive?: boolean;
  onDelete?: () => void;
  onAddMaterial?: () => void;
  onDeleteMaterial?: (materialId: string) => void;
  isLoadingMaterials?: boolean;
  onToggle?: (topicId: string, isOpen: boolean) => void;
  leadingSlot?: React.ReactNode;
}

// Get display name prioritizing English, falling back to Hindi
const getTopicDisplayName = (english: string | null, hindi: string | null): string => {
  return english || hindi || 'Unnamed Topic';
};

const getDifficultyColor = (level: string | null) => {
  switch (level?.toLowerCase()) {
    case "easy":
    case "1":
      return "bg-green-500/10 text-green-600 border-green-200";
    case "medium":
    case "2":
      return "bg-yellow-500/10 text-yellow-600 border-yellow-200";
    case "hard":
    case "3":
      return "bg-red-500/10 text-red-600 border-red-200";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const getDifficultyLabel = (level: string | null) => {
  switch (level?.toLowerCase()) {
    case "1":
      return "Easy";
    case "2":
      return "Medium";
    case "3":
      return "Hard";
    default:
      return level || "Unknown";
  }
};

export function TopicAccordion({
  id,
  topicName,
  topicNameHindi,
  difficultyLevel,
  learningOutcomes,
  materials,
  materialCount = 0,
  isGlobal,
  isActive = true,
  onDelete,
  onAddMaterial,
  onDeleteMaterial,
  isLoadingMaterials,
  onToggle,
  leadingSlot,
}: TopicAccordionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const displayName = getTopicDisplayName(topicName, topicNameHindi || null);
  
  // Determine source type for badge
  const sourceType: SourceType = !isActive ? "archived" : (isGlobal ? "global" : "institute");

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    onToggle?.(id, open);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border bg-card overflow-hidden"
      >
        <CollapsibleTrigger asChild>
          <div className="group flex items-center gap-3 p-3 cursor-pointer hover:bg-accent/50 transition-colors">
            {leadingSlot ?? (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Layers className="h-5 w-5" />
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm text-foreground">{displayName}</span>
                <SourceBadge source={sourceType} size="sm" />
                {difficultyLevel && (
                  <Badge variant="outline" className={cn("text-xs", getDifficultyColor(difficultyLevel))}>
                    {getDifficultyLabel(difficultyLevel)}
                  </Badge>
                )}
              </div>
              {/* Show Hindi name below if both exist */}
              {topicName && topicNameHindi && (
                <p className="text-xs text-muted-foreground mt-0.5">{topicNameHindi}</p>
              )}
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                <span>{materialCount} {materialCount === 1 ? "material" : "materials"}</span>
              </div>
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
              <ChevronDown
                className={cn(
                  "h-5 w-5 text-muted-foreground transition-transform duration-200",
                  isOpen && "rotate-180"
                )}
              />
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="border-t"
              >
                <div className="p-4 space-y-4">
                  {/* Learning Outcomes */}
                  {learningOutcomes && (
                    <div className="p-3 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground mb-1">
                        <BookOpen className="h-4 w-4" />
                        Learning Outcomes
                      </div>
                      <p className="text-sm text-muted-foreground">{learningOutcomes}</p>
                    </div>
                  )}

                  {/* Materials List */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium text-foreground">Study Materials</h4>
                      {onAddMaterial && (
                        <Button variant="outline" size="sm" onClick={onAddMaterial}>
                          <Plus className="h-4 w-4 mr-1" />
                          Add Material
                        </Button>
                      )}
                    </div>

                    {isLoadingMaterials ? (
                      <div className="text-sm text-muted-foreground py-4 text-center">
                        Loading materials...
                      </div>
                    ) : materials.length === 0 ? (
                      <div className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed">
                        No study materials yet
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {materials.map((material) => (
                          <StudyMaterialItem
                            key={material.id}
                            {...material}
                            onDelete={onDeleteMaterial ? () => onDeleteMaterial(material.id) : undefined}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CollapsibleContent>
      </motion.div>
    </Collapsible>
  );
}
