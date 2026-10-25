import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Separator } from "@/components/ui/separator";
import { Layers, GraduationCap, BookOpen } from "lucide-react";
import { useAddTopic } from "@/hooks/useSyllabusHierarchy";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { extractGradeNumberFromClassName } from "@/lib/gradeLookup";

interface AddTopicToSubjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gradeId: string;
  gradeName: string;
  subjectId: string;
  subjectName: string;
  institutionId?: string | null; // null = global topic (Super Admin), non-null = institute-specific
}

export function AddTopicToSubjectDialog({
  open,
  onOpenChange,
  gradeId,
  gradeName,
  subjectId,
  subjectName,
  institutionId,
}: AddTopicToSubjectDialogProps) {
  const [topicName, setTopicName] = useState("");
  const [difficultyLevel, setDifficultyLevel] = useState("");
  const [displayOrder, setDisplayOrder] = useState("1");
  const [learningOutcomes, setLearningOutcomes] = useState("");

  // Reset form state whenever the dialog opens
  useEffect(() => {
    if (open) {
      resetForm();
    }
  }, [open]);

  const addTopic = useAddTopic();

  const handleTopicSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topicName.trim()) return;

    // `gradeId` here is actually a class_id (the page's "grades" list is `classes`).
    // `syllabus_topics.grade_level_id` FKs to `grade_levels(id)`, so resolve the real
    // grade_level_id by extracting the grade number from the class name.
    let resolvedGradeLevelId: string;
    try {
      const { data: classData, error: classError } = await supabase
        .from("classes")
        .select("name")
        .eq("id", gradeId)
        .single();
      if (classError) throw classError;

      const gradeNumber = extractGradeNumberFromClassName(classData.name);
      if (gradeNumber === null) {
        toast.error("We couldn't figure out the grade for this class.", {
          description: "Use a numeric class name (e.g. \"Class 10\") or a recognized pre-school label (Pre Nursery, Nursery, LKG, UKG).",
        });
        return;
      }

      const { data: gradeData, error: gradeError } = await supabase
        .from("grade_levels")
        .select("id")
        .eq("grade_number", gradeNumber)
        .maybeSingle();
      if (gradeError) throw gradeError;
      if (!gradeData?.id) {
        toast.error(`Grade ${gradeNumber} isn't set up yet.`, {
          description: "Ask your admin to add this grade to the platform before creating chapters.",
        });
        return;
      }
      resolvedGradeLevelId = gradeData.id;
    } catch (err) {
      toastError(err, { fallback: "Couldn't prepare this chapter.", context: "resolveGradeForTopic" });
      return;
    }

    addTopic.mutate(
      {
        gradeId: resolvedGradeLevelId,
        subjectId,
        topicName: topicName.trim(),
        topicNameHindi: undefined,
        difficultyLevel: difficultyLevel || undefined,
        displayOrder: parseInt(displayOrder) || 1,
        learningOutcomes: learningOutcomes.trim() || undefined,
        institutionId: institutionId, // Pass institution ID for scoping (null = global)
      },
      {
        onSuccess: () => {
          toast.success("Chapter created. Use the “Add Material” button on the chapter to attach study materials.");
          handleClose();
        },
      }
    );
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const resetForm = () => {
    setTopicName("");
    setDifficultyLevel("");
    setDisplayOrder("1");
    setLearningOutcomes("");
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            Add Chapter
          </DialogTitle>
          <DialogDescription>
            Create a new chapter under this subject. You can add study materials afterwards from the chapter.
          </DialogDescription>
        </DialogHeader>

        {/* Context badges */}
        <div className="flex items-center gap-2 flex-wrap px-1 pb-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground/80 bg-muted/30 px-2.5 py-1 rounded-md border border-border/50">
            <GraduationCap className="h-3.5 w-3.5" />
            {gradeName}
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground/80 bg-muted/30 px-2.5 py-1 rounded-md border border-border/50">
            <BookOpen className="h-3.5 w-3.5" />
            {subjectName}
          </div>
        </div>

        <Separator className="my-2 opacity-50" />

        <form onSubmit={handleTopicSubmit} className="space-y-5 pt-2">
          <div className="grid grid-cols-2 gap-5">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="topicName" className="text-sm font-medium text-foreground/90">
                Chapter Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="topicName"
                value={topicName}
                onChange={(e) => setTopicName(e.target.value)}
                placeholder="e.g., Fractions"
                className="bg-transparent hover:border-ring/30 transition-colors shadow-sm"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="difficultyLevel" className="text-sm font-medium text-foreground/90">
                Difficulty Level
              </Label>
              <SearchableSelect
                value={difficultyLevel}
                onValueChange={setDifficultyLevel}
                placeholder="Select level"
                searchPlaceholder="Search..."
                options={[
                  { value: "easy", label: "Easy" },
                  { value: "medium", label: "Medium" },
                  { value: "hard", label: "Hard" },
                ]}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="displayOrder" className="text-sm font-medium text-foreground/90">
                Display Order
              </Label>
              <Input
                id="displayOrder"
                type="number"
                min="1"
                value={displayOrder}
                onChange={(e) => setDisplayOrder(e.target.value)}
                className="bg-transparent hover:border-ring/30 transition-colors shadow-sm"
              />
            </div>

            <div className="col-span-2 space-y-2">
              <Label htmlFor="learningOutcomes" className="text-sm font-medium text-foreground/90">
                Learning Outcomes
              </Label>
              <Textarea
                id="learningOutcomes"
                value={learningOutcomes}
                onChange={(e) => setLearningOutcomes(e.target.value)}
                placeholder="What students will learn from this topic..."
                rows={3}
                className="resize-none bg-transparent hover:border-ring/30 transition-colors shadow-sm"
              />
            </div>
          </div>

          <DialogFooter className="pt-4 mt-2">
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!topicName.trim() || addTopic.isPending} className="shadow-sm">
              {addTopic.isPending ? "Creating..." : "Create Chapter"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
