import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useAddUniversalSubject } from "@/hooks/useStudyMaterials";
import { useGradesWithCounts, useAssignSubjectToGrade, useAddTopic } from "@/hooks/useSyllabusHierarchy";
import { Plus, X, BookOpen, Layers, ChevronRight, Check, GraduationCap } from "lucide-react";
import { toast } from "sonner";
import { extractLanguages, isHindiText } from "@/lib/languageUtils";

interface AddSubjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STREAMS = [
  { value: "science", label: "Science" },
  { value: "commerce", label: "Commerce" },
  { value: "arts", label: "Arts/Humanities" },
];

interface TopicToAdd {
  name: string;
  nameHindi?: string;
  difficulty?: string;
}

export function AddSubjectDialog({ open, onOpenChange }: AddSubjectDialogProps) {
  // Step state
  const [step, setStep] = useState<"subject" | "topics">("subject");
  
  // Subject form state
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [category, setCategory] = useState("");
  const [selectedGradeId, setSelectedGradeId] = useState("");
  const [selectedStream, setSelectedStream] = useState("");
  const [createdSubjectId, setCreatedSubjectId] = useState<string | null>(null);
  
  // Topics state
  const [topics, setTopics] = useState<TopicToAdd[]>([]);
  const [newTopicName, setNewTopicName] = useState("");
  const [newTopicNameHindi, setNewTopicNameHindi] = useState("");
  const [newTopicDifficulty, setNewTopicDifficulty] = useState("");
  
  const addSubject = useAddUniversalSubject();
  const assignSubject = useAssignSubjectToGrade();
  const addTopic = useAddTopic();
  const { data: grades = [] } = useGradesWithCounts();

  const selectedGrade = grades.find(g => g.id === selectedGradeId);
  const isHigherSecondary = selectedGrade && selectedGrade.grade_number >= 11;

  useEffect(() => {
    if (!isHigherSecondary) {
      setSelectedStream("");
    }
  }, [selectedGradeId, isHigherSecondary]);

  const handleSubjectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Auto-detect language from subject name
    const { english: nameEnglish, hindi: nameHindi } = extractLanguages(name);
    
    addSubject.mutate(
      {
        name: nameEnglish,
        name_hindi: nameHindi,
        code: code || undefined,
        category: category || undefined,
      },
      {
        onSuccess: async (data) => {
          setCreatedSubjectId(data.id);
          
          // If grade is selected, assign subject to grade
          if (selectedGradeId) {
            await assignSubject.mutateAsync({
              gradeId: selectedGradeId,
              subjectId: data.id,
            });
          }
          
          setStep("topics");
          toast.success("Subject created! Now add chapters.");
        },
      }
    );
  };

  const handleAddTopic = () => {
    if (!newTopicName.trim()) return;
    
    // Auto-detect language from topic name
    const { english: topicEnglish, hindi: topicHindi } = extractLanguages(newTopicName);
    
    setTopics([
      ...topics,
      {
        name: topicEnglish || newTopicName.trim(),
        nameHindi: topicHindi || (newTopicNameHindi.trim() || undefined),
        difficulty: newTopicDifficulty || undefined,
      },
    ]);
    setNewTopicName("");
    setNewTopicNameHindi("");
    setNewTopicDifficulty("");
  };

  const handleRemoveTopic = (index: number) => {
    setTopics(topics.filter((_, i) => i !== index));
  };

  const handleSaveTopics = async () => {
    if (!createdSubjectId || !selectedGradeId) {
      toast.success("Subject created successfully!");
      handleClose();
      return;
    }
    
    try {
      for (let i = 0; i < topics.length; i++) {
        const topic = topics[i];
        await addTopic.mutateAsync({
          gradeId: selectedGradeId,
          subjectId: createdSubjectId,
          topicName: topic.name,
          topicNameHindi: topic.nameHindi,
          difficultyLevel: topic.difficulty,
          displayOrder: i + 1,
        });
      }
      
      toast.success("All chapters saved successfully!");
      handleClose();
    } catch (error) {
      toast.error("Error saving chapters. Please try again.");
    }
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const handleSkipAndClose = () => {
    toast.success("Subject created successfully!");
    handleClose();
  };

  const resetForm = () => {
    setStep("subject");
    setName("");
    setCode("");
    setCategory("");
    setSelectedGradeId("");
    setSelectedStream("");
    setCreatedSubjectId(null);
    setTopics([]);
    setNewTopicName("");
    setNewTopicNameHindi("");
    setNewTopicDifficulty("");
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            {step === "subject" && "Add New Subject"}
            {step === "topics" && "Add Chapters to Subject"}
          </DialogTitle>
          <DialogDescription>
            {step === "subject" && "Create a new subject and optionally assign it to a grade"}
            {step === "topics" && `Add chapters to ${name}`}
          </DialogDescription>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2 py-2">
          <div className={`flex items-center gap-1 ${step === "subject" ? "text-primary" : "text-muted-foreground"}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step === "subject" ? "bg-primary text-primary-foreground" : createdSubjectId ? "bg-green-500 text-white" : "bg-muted"
            }`}>
              {createdSubjectId ? <Check className="h-4 w-4" /> : "1"}
            </div>
            <span className="text-sm font-medium hidden sm:inline">Subject</span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <div className={`flex items-center gap-1 ${step === "topics" ? "text-primary" : "text-muted-foreground"}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step === "topics" ? "bg-primary text-primary-foreground" : "bg-muted"
            }`}>
              2
            </div>
            <span className="text-sm font-medium hidden sm:inline">Chapters</span>
          </div>
        </div>

        <Separator />

        {/* Step 1: Subject Details */}
        {step === "subject" && (
          <form onSubmit={handleSubjectSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Subject Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Mathematics"
                required
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="code">Subject Code</Label>
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g., MATH"
                  maxLength={10}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <SearchableSelect
                  value={category}
                  onValueChange={setCategory}
                  placeholder="Select category"
                  searchPlaceholder="Search categories..."
                  options={[
                    { value: "core", label: "Core" },
                    { value: "elective", label: "Elective" },
                    { value: "language", label: "Language" },
                    { value: "vocational", label: "Vocational" },
                  ]}
                />
              </div>
            </div>

            {/* Grade Selection (optional) */}
            <div className="space-y-2">
              <Label>Assign to Grade (Optional)</Label>
              <SearchableSelect
                value={selectedGradeId}
                onValueChange={setSelectedGradeId}
                placeholder="Select grade to assign..."
                searchPlaceholder="Search grades..."
                options={grades.map((grade) => ({
                  value: grade.id,
                  label: grade.grade_name,
                }))}
              />
              <p className="text-xs text-muted-foreground">
                Select a grade to enable adding chapters after creating the subject
              </p>
            </div>

            {/* Stream for Class 11-12 */}
            {isHigherSecondary && (
              <div className="space-y-2">
                <Label>Stream</Label>
                <SearchableSelect
                  value={selectedStream}
                  onValueChange={setSelectedStream}
                  placeholder="Select stream"
                  searchPlaceholder="Search streams..."
                  options={STREAMS.map((stream) => ({
                    value: stream.value,
                    label: stream.label,
                  }))}
                />
              </div>
            )}

            {/* Show selected configuration */}
            {(selectedGradeId || selectedStream || category) && (
              <div className="flex flex-wrap gap-2 p-3 bg-muted rounded-lg">
                {selectedGrade && (
                  <Badge variant="outline" className="flex items-center gap-1">
                    <GraduationCap className="h-3 w-3" />
                    {selectedGrade.grade_name}
                  </Badge>
                )}
                {selectedStream && (
                  <Badge variant="secondary" className="capitalize">
                    {selectedStream}
                  </Badge>
                )}
                {category && (
                  <Badge variant="default" className="capitalize">
                    {category}
                  </Badge>
                )}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={addSubject.isPending || !name}>
                {addSubject.isPending ? "Creating..." : selectedGradeId ? "Create & Add Chapters" : "Create Subject"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {/* Step 2: Add Chapters */}
        {step === "topics" && (
          <div className="space-y-4">
            {/* Context Badge */}
            <div className="p-3 bg-muted rounded-lg">
              <div className="flex items-center gap-2 flex-wrap">
                {selectedGrade && (
                  <Badge variant="outline" className="flex items-center gap-1">
                    <GraduationCap className="h-3 w-3" />
                    {selectedGrade.grade_name}
                  </Badge>
                )}
                <Badge variant="secondary" className="flex items-center gap-1">
                  <BookOpen className="h-3 w-3" />
                  {name}
                </Badge>
              </div>
            </div>

            {/* Add Chapter Form */}
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Add Chapters
              </Label>
              
              <div className="grid grid-cols-1 gap-2">
                <Input
                  placeholder="Chapter name *"
                  value={newTopicName}
                  onChange={(e) => setNewTopicName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTopic();
                    }
                  }}
                />
                <Input
                  placeholder="Chapter name in Hindi (optional)"
                  value={newTopicNameHindi}
                  onChange={(e) => setNewTopicNameHindi(e.target.value)}
                />
                <div className="flex gap-2">
                  <SearchableSelect
                    value={newTopicDifficulty}
                    onValueChange={setNewTopicDifficulty}
                    placeholder="Difficulty level"
                    searchPlaceholder="Search..."
                    options={[
                      { value: "easy", label: "Easy" },
                      { value: "medium", label: "Medium" },
                      { value: "hard", label: "Hard" },
                    ]}
                    className="flex-1"
                  />
                  <Button type="button" onClick={handleAddTopic} disabled={!newTopicName.trim()}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </div>
              </div>
            </div>

            {/* Added Chapters List */}
            {topics.length > 0 && (
              <div className="space-y-2">
                <Label>Added Chapters ({topics.length})</Label>
                <div className="flex flex-wrap gap-2 p-3 bg-muted/50 rounded-lg max-h-[200px] overflow-y-auto">
                  {topics.map((topic, index) => (
                    <Badge key={index} variant="outline" className="gap-1 py-1.5">
                      <Layers className="h-3 w-3" />
                      {topic.name}
                      {topic.difficulty && (
                        <span className="text-xs text-muted-foreground capitalize">({topic.difficulty})</span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveTopic(index)}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {!selectedGradeId && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  No grade was selected. Chapters can only be added when a grade is assigned.
                </p>
              </div>
            )}

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button type="button" variant="outline" onClick={handleSkipAndClose}>
                {topics.length > 0 ? "Skip Chapters & Finish" : "Finish Without Chapters"}
              </Button>
              {selectedGradeId && topics.length > 0 && (
                <Button 
                  type="button" 
                  onClick={handleSaveTopics}
                  disabled={addTopic.isPending}
                >
                  {addTopic.isPending ? "Saving..." : `Save ${topics.length} Chapter${topics.length !== 1 ? "s" : ""} & Finish`}
                </Button>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
