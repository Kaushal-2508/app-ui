import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { 
  Sparkles, 
  Pencil, 
  Shuffle, 
  BookOpen,
  Target,
  Clock,
  AlertCircle
} from "lucide-react";
import type { ExamSection, SectionType } from "@/types/exam";

export type QuestionSource = "ai" | "manual" | "mixed" | "question_bank";

interface SectionQuestionSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: ExamSection | null;
  onConfirm: (config: {
    source: QuestionSource;
    questionCount: number;
    aiPercentage?: number;
    difficultyMix?: { easy: number; medium: number; hard: number };
  }) => void;
}

const sourceOptions = [
  {
    value: "ai" as QuestionSource,
    label: "AI Generated",
    description: "Let AI create questions based on topics and difficulty",
    icon: Sparkles,
    color: "text-purple-600",
  },
  {
    value: "manual" as QuestionSource,
    label: "Manual Entry",
    description: "Enter questions manually one by one",
    icon: Pencil,
    color: "text-blue-600",
  },
  {
    value: "mixed" as QuestionSource,
    label: "Mixed (AI + Manual)",
    description: "Combine AI-generated and manually added questions",
    icon: Shuffle,
    color: "text-amber-600",
  },
  {
    value: "question_bank" as QuestionSource,
    label: "Question Bank",
    description: "Select from pre-approved question bank",
    icon: BookOpen,
    color: "text-green-600",
  },
];

export function SectionQuestionSourceDialog({
  open,
  onOpenChange,
  section,
  onConfirm,
}: SectionQuestionSourceDialogProps) {
  const [source, setSource] = useState<QuestionSource>("manual");
  const [questionCount, setQuestionCount] = useState(5);
  const [aiPercentage, setAiPercentage] = useState(50);
  const [difficultyMix, setDifficultyMix] = useState({ easy: 30, medium: 50, hard: 20 });

  const handleConfirm = () => {
    onConfirm({
      source,
      questionCount,
      aiPercentage: source === "mixed" ? aiPercentage : undefined,
      difficultyMix: source === "ai" || source === "mixed" ? difficultyMix : undefined,
    });
    onOpenChange(false);
  };

  const updateDifficulty = (level: "easy" | "medium" | "hard", value: number) => {
    const remaining = 100 - value;
    const others = ["easy", "medium", "hard"].filter(l => l !== level) as ("easy" | "medium" | "hard")[];
    const otherTotal = difficultyMix[others[0]] + difficultyMix[others[1]];
    
    if (otherTotal === 0) {
      setDifficultyMix({
        ...difficultyMix,
        [level]: value,
        [others[0]]: remaining / 2,
        [others[1]]: remaining / 2,
      });
    } else {
      const ratio = remaining / otherTotal;
      setDifficultyMix({
        ...difficultyMix,
        [level]: value,
        [others[0]]: Math.round(difficultyMix[others[0]] * ratio),
        [others[1]]: Math.round(difficultyMix[others[1]] * ratio),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Configure Question Source</DialogTitle>
          <DialogDescription>
            {section && (
              <span className="flex items-center gap-2">
                Section: <Badge variant="outline">{section.title}</Badge>
                <Badge variant="secondary" className="capitalize">{section.sectionType?.replace("_", " ")}</Badge>
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Source Selection */}
          <div className="space-y-3">
            <Label>Question Source *</Label>
            <div className="grid grid-cols-2 gap-3">
              {sourceOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <Card
                    key={option.value}
                    className={`cursor-pointer transition-all hover:border-primary ${
                      source === option.value ? "border-primary bg-primary/5" : ""
                    }`}
                    onClick={() => setSource(option.value)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <Icon className={`h-5 w-5 mt-0.5 ${option.color}`} />
                        <div>
                          <p className="font-medium text-sm">{option.label}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {option.description}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Question Count */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              Number of Questions
            </Label>
            <div className="flex items-center gap-4">
              <Input
                type="number"
                min={1}
                max={50}
                value={questionCount}
                onChange={(e) => setQuestionCount(parseInt(e.target.value) || 5)}
                className="w-24"
              />
              <p className="text-sm text-muted-foreground">
                Total: {questionCount * (section?.defaultMarks || 1)} marks
              </p>
            </div>
          </div>

          {/* AI/Manual Split for Mixed */}
          {source === "mixed" && (
            <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
              <Label>AI vs Manual Split</Label>
              <div className="flex items-center gap-4">
                <Slider
                  value={[aiPercentage]}
                  onValueChange={([value]) => setAiPercentage(value)}
                  min={10}
                  max={90}
                  step={10}
                  className="flex-1"
                />
                <span className="text-sm font-mono w-24 text-right">
                  {aiPercentage}% AI
                </span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>AI: {Math.round(questionCount * aiPercentage / 100)} questions</span>
                <span>Manual: {Math.round(questionCount * (100 - aiPercentage) / 100)} questions</span>
              </div>
            </div>
          )}

          {/* Difficulty Mix for AI */}
          {(source === "ai" || source === "mixed") && (
            <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
              <Label>Difficulty Distribution</Label>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Badge variant="secondary" className="w-16 justify-center bg-green-100 text-green-800">Easy</Badge>
                  <Slider
                    value={[difficultyMix.easy]}
                    onValueChange={([value]) => updateDifficulty("easy", value)}
                    min={0}
                    max={100}
                    step={10}
                    className="flex-1"
                  />
                  <span className="text-sm font-mono w-12">{difficultyMix.easy}%</span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary" className="w-16 justify-center bg-amber-100 text-amber-800">Medium</Badge>
                  <Slider
                    value={[difficultyMix.medium]}
                    onValueChange={([value]) => updateDifficulty("medium", value)}
                    min={0}
                    max={100}
                    step={10}
                    className="flex-1"
                  />
                  <span className="text-sm font-mono w-12">{difficultyMix.medium}%</span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary" className="w-16 justify-center bg-red-100 text-red-800">Hard</Badge>
                  <Slider
                    value={[difficultyMix.hard]}
                    onValueChange={([value]) => updateDifficulty("hard", value)}
                    min={0}
                    max={100}
                    step={10}
                    className="flex-1"
                  />
                  <span className="text-sm font-mono w-12">{difficultyMix.hard}%</span>
                </div>
              </div>
              {(difficultyMix.easy + difficultyMix.medium + difficultyMix.hard) !== 100 && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Total should equal 100%
                </p>
              )}
            </div>
          )}

          {/* Time Estimate */}
          <div className="p-3 bg-muted rounded-lg flex items-center gap-3">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Estimated Time</p>
              <p className="text-xs text-muted-foreground">
                ~{Math.ceil(questionCount * 2)} minutes for this section
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            Apply Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
