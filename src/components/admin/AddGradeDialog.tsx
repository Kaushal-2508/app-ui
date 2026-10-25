import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useAddGradeLevel } from "@/hooks/useStudyMaterials";
import { useAddUniversalSubject } from "@/hooks/useStudyMaterials";
import { useAssignSubjectToGrade, useAddTopic, useAllSubjects } from "@/hooks/useSyllabusHierarchy";
import { Plus, X, GraduationCap, BookOpen, Layers, ChevronRight, Check } from "lucide-react";
import { toast } from "sonner";

interface AddGradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STREAMS = [
  { value: "science", label: "Science" },
  { value: "commerce", label: "Commerce" },
  { value: "arts", label: "Arts/Humanities" },
];

interface AddedSubject {
  id: string;
  name: string;
  isNew: boolean;
  topics: { name: string; nameHindi?: string; difficulty?: string }[];
}

export function AddGradeDialog({ open, onOpenChange }: AddGradeDialogProps) {
  // Step state
  const [step, setStep] = useState<"grade" | "subjects" | "topics">("grade");
  
  // Grade form state
  const [gradeNumber, setGradeNumber] = useState("");
  const [gradeName, setGradeName] = useState("");
  const [sections, setSections] = useState<string[]>(["A"]);
  const [selectedStreams, setSelectedStreams] = useState<string[]>([]);
  const [newSection, setNewSection] = useState("");
  const [createdGradeId, setCreatedGradeId] = useState<string | null>(null);
  
  // Subject form state
  const [addedSubjects, setAddedSubjects] = useState<AddedSubject[]>([]);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [newSubjectCode, setNewSubjectCode] = useState("");
  const [selectedExistingSubject, setSelectedExistingSubject] = useState("");
  const [activeSubjectIndex, setActiveSubjectIndex] = useState<number | null>(null);
  
  // Topic form state for active subject
  const [newTopicName, setNewTopicName] = useState("");
  const [newTopicNameHindi, setNewTopicNameHindi] = useState("");
  const [newTopicDifficulty, setNewTopicDifficulty] = useState("");
  
  const addGrade = useAddGradeLevel();
  const addUniversalSubject = useAddUniversalSubject();
  const assignSubject = useAssignSubjectToGrade();
  const addTopic = useAddTopic();
  const { data: existingSubjects = [] } = useAllSubjects();

  const isHigherSecondary = parseInt(gradeNumber) >= 11 && parseInt(gradeNumber) <= 12;

  useEffect(() => {
    if (!isHigherSecondary) {
      setSelectedStreams([]);
    }
  }, [gradeNumber, isHigherSecondary]);

  const handleAddSection = () => {
    if (newSection && !sections.includes(newSection.toUpperCase())) {
      setSections([...sections, newSection.toUpperCase()]);
      setNewSection("");
    }
  };

  const handleRemoveSection = (section: string) => {
    setSections(sections.filter(s => s !== section));
  };

  const handleToggleStream = (stream: string) => {
    if (selectedStreams.includes(stream)) {
      setSelectedStreams(selectedStreams.filter(s => s !== stream));
    } else {
      setSelectedStreams([...selectedStreams, stream]);
    }
  };

  const handleGradeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseInt(gradeNumber);
    if (isNaN(num)) return;

    addGrade.mutate(
      {
        grade_number: num,
        grade_name: gradeName || `Class ${num}`,
      },
      {
        onSuccess: (data) => {
          setCreatedGradeId(data.id);
          setStep("subjects");
          toast.success("Grade created! Now add subjects.");
        },
      }
    );
  };

  const handleAddNewSubject = () => {
    if (!newSubjectName.trim()) return;
    
    setAddedSubjects([
      ...addedSubjects,
      {
        id: `new-${Date.now()}`,
        name: newSubjectName.trim(),
        isNew: true,
        topics: [],
      },
    ]);
    setNewSubjectName("");
    setNewSubjectCode("");
  };

  const handleAddExistingSubject = () => {
    if (!selectedExistingSubject) return;
    
    const subject = existingSubjects.find(s => s.id === selectedExistingSubject);
    if (!subject) return;
    
    // Check if already added
    if (addedSubjects.some(s => s.id === subject.id)) {
      toast.error("Subject already added");
      return;
    }
    
    setAddedSubjects([
      ...addedSubjects,
      {
        id: subject.id,
        name: subject.name,
        isNew: false,
        topics: [],
      },
    ]);
    setSelectedExistingSubject("");
  };

  const handleRemoveSubject = (index: number) => {
    setAddedSubjects(addedSubjects.filter((_, i) => i !== index));
    if (activeSubjectIndex === index) {
      setActiveSubjectIndex(null);
    }
  };

  const handleAddTopic = () => {
    if (activeSubjectIndex === null || !newTopicName.trim()) return;
    
    const updatedSubjects = [...addedSubjects];
    updatedSubjects[activeSubjectIndex].topics.push({
      name: newTopicName.trim(),
      nameHindi: newTopicNameHindi.trim() || undefined,
      difficulty: newTopicDifficulty || undefined,
    });
    setAddedSubjects(updatedSubjects);
    setNewTopicName("");
    setNewTopicNameHindi("");
    setNewTopicDifficulty("");
  };

  const handleRemoveTopic = (subjectIndex: number, topicIndex: number) => {
    const updatedSubjects = [...addedSubjects];
    updatedSubjects[subjectIndex].topics.splice(topicIndex, 1);
    setAddedSubjects(updatedSubjects);
  };

  const handleSaveAll = async () => {
    if (!createdGradeId) return;
    
    try {
      for (const subject of addedSubjects) {
        let subjectId = subject.id;
        
        // Create new subject if needed
        if (subject.isNew) {
          const newSubject = await addUniversalSubject.mutateAsync({ name: subject.name });
          subjectId = newSubject.id;
        }
        
        // Assign subject to grade
        await assignSubject.mutateAsync({
          gradeId: createdGradeId,
          subjectId,
        });
        
        // Add topics
        for (let i = 0; i < subject.topics.length; i++) {
          const topic = subject.topics[i];
          await addTopic.mutateAsync({
            gradeId: createdGradeId,
            subjectId,
            topicName: topic.name,
            topicNameHindi: topic.nameHindi,
            difficultyLevel: topic.difficulty,
            displayOrder: i + 1,
          });
        }
      }
      
      toast.success("All subjects and chapters saved successfully!");
      handleClose();
    } catch (error) {
      toast.error("Error saving data. Please try again.");
    }
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const handleSkipAndClose = () => {
    toast.success("Grade created successfully!");
    handleClose();
  };

  const resetForm = () => {
    setStep("grade");
    setGradeNumber("");
    setGradeName("");
    setSections(["A"]);
    setSelectedStreams([]);
    setNewSection("");
    setCreatedGradeId(null);
    setAddedSubjects([]);
    setNewSubjectName("");
    setNewSubjectCode("");
    setSelectedExistingSubject("");
    setActiveSubjectIndex(null);
    setNewTopicName("");
    setNewTopicNameHindi("");
    setNewTopicDifficulty("");
  };

  const availableSubjects = existingSubjects.filter(
    s => !addedSubjects.some(added => added.id === s.id)
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            {step === "grade" && "Add New Grade"}
            {step === "subjects" && "Add Subjects to Grade"}
            {step === "topics" && "Add Chapters to Subject"}
          </DialogTitle>
          <DialogDescription>
            {step === "grade" && "Create a new grade level with sections"}
            {step === "subjects" && `Add subjects to ${gradeName || `Class ${gradeNumber}`} and their chapters`}
          </DialogDescription>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2 py-2">
          <div className={`flex items-center gap-1 ${step === "grade" ? "text-primary" : "text-muted-foreground"}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step === "grade" ? "bg-primary text-primary-foreground" : createdGradeId ? "bg-green-500 text-white" : "bg-muted"
            }`}>
              {createdGradeId ? <Check className="h-4 w-4" /> : "1"}
            </div>
            <span className="text-sm font-medium hidden sm:inline">Grade</span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <div className={`flex items-center gap-1 ${step === "subjects" ? "text-primary" : "text-muted-foreground"}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step === "subjects" ? "bg-primary text-primary-foreground" : "bg-muted"
            }`}>
              2
            </div>
            <span className="text-sm font-medium hidden sm:inline">Subjects & Chapters</span>
          </div>
        </div>

        <Separator />

        {/* Step 1: Grade Details */}
        {step === "grade" && (
          <form onSubmit={handleGradeSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="gradeNumber">Grade Number *</Label>
                <Input
                  id="gradeNumber"
                  type="number"
                  value={gradeNumber}
                  onChange={(e) => setGradeNumber(e.target.value)}
                  placeholder="e.g., 5"
                  required
                  min={0}
                  max={12}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gradeName">Grade Name</Label>
                <Input
                  id="gradeName"
                  value={gradeName}
                  onChange={(e) => setGradeName(e.target.value)}
                  placeholder="e.g., Class 5"
                />
                <p className="text-xs text-muted-foreground">
                  Auto-generates if blank
                </p>
              </div>
            </div>

            {/* Sections */}
            <div className="space-y-2">
              <Label>Sections</Label>
              <div className="flex flex-wrap gap-2 mb-2">
                {sections.map((section) => (
                  <Badge key={section} variant="secondary" className="gap-1">
                    Section {section}
                    {sections.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveSection(section)}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="New section (e.g., B)"
                  value={newSection}
                  onChange={(e) => setNewSection(e.target.value.toUpperCase())}
                  maxLength={2}
                  className="flex-1"
                />
                <Button type="button" variant="outline" size="sm" onClick={handleAddSection}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Streams for Class 11-12 */}
            {isHigherSecondary && (
              <div className="space-y-2">
                <Label>Streams (for Class 11-12)</Label>
                <div className="flex flex-wrap gap-2">
                  {STREAMS.map((stream) => (
                    <Badge
                      key={stream.value}
                      variant={selectedStreams.includes(stream.value) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => handleToggleStream(stream.value)}
                    >
                      {stream.label}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={addGrade.isPending || !gradeNumber}>
                {addGrade.isPending ? "Creating..." : "Create Grade & Add Subjects"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {/* Step 2: Add Subjects & Chapters */}
        {step === "subjects" && (
          <div className="space-y-4">
            {/* Context Badge */}
            <div className="p-3 bg-muted rounded-lg">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="flex items-center gap-1">
                  <GraduationCap className="h-3 w-3" />
                  {gradeName || `Class ${gradeNumber}`}
                </Badge>
              </div>
            </div>

            {/* Add Subject Section */}
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                Add Subjects
              </Label>
              
              {/* Add existing subject */}
              <div className="flex gap-2">
                <SearchableSelect
                  value={selectedExistingSubject}
                  onValueChange={setSelectedExistingSubject}
                  placeholder="Select existing subject..."
                  searchPlaceholder="Search subjects..."
                  options={availableSubjects.map(s => ({ value: s.id, label: s.name }))}
                  className="flex-1"
                />
                <Button type="button" variant="outline" onClick={handleAddExistingSubject} disabled={!selectedExistingSubject}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              
              {/* Or create new subject */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">OR create new</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              
              <div className="flex gap-2">
                <Input
                  placeholder="New subject name..."
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  className="flex-1"
                />
                <Button type="button" variant="outline" onClick={handleAddNewSubject} disabled={!newSubjectName.trim()}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Added Subjects List */}
            {addedSubjects.length > 0 && (
              <div className="space-y-3">
                <Label>Added Subjects ({addedSubjects.length})</Label>
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {addedSubjects.map((subject, index) => (
                    <Card 
                      key={subject.id} 
                      className={`cursor-pointer transition-all ${activeSubjectIndex === index ? "border-primary ring-1 ring-primary" : ""}`}
                      onClick={() => setActiveSubjectIndex(activeSubjectIndex === index ? null : index)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <BookOpen className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">{subject.name}</span>
                            {subject.isNew && <Badge variant="outline" className="text-xs">New</Badge>}
                            <Badge variant="secondary" className="text-xs">
                              {subject.topics.length} chapter{subject.topics.length !== 1 ? "s" : ""}
                            </Badge>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveSubject(index);
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        
                        {/* Topics list when expanded */}
                        {activeSubjectIndex === index && (
                          <div className="mt-3 pt-3 border-t space-y-3">
                            {/* Added topics */}
                            {subject.topics.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {subject.topics.map((topic, topicIndex) => (
                                  <Badge key={topicIndex} variant="outline" className="gap-1">
                                    <Layers className="h-3 w-3" />
                                    {topic.name}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRemoveTopic(index, topicIndex);
                                      }}
                                      className="ml-1 hover:text-destructive"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </Badge>
                                ))}
                              </div>
                            )}
                            
                            {/* Add topic form */}
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                                <Layers className="h-3 w-3" />
                                Add Chapters to {subject.name}
                              </Label>
                              <div className="grid grid-cols-2 gap-2">
                                <Input
                                  placeholder="Chapter name *"
                                  value={newTopicName}
                                  onChange={(e) => setNewTopicName(e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <Input
                                  placeholder="Hindi name (optional)"
                                  value={newTopicNameHindi}
                                  onChange={(e) => setNewTopicNameHindi(e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </div>
                              <div className="flex gap-2">
                                <SearchableSelect
                                  value={newTopicDifficulty}
                                  onValueChange={setNewTopicDifficulty}
                                  placeholder="Difficulty"
                                  searchPlaceholder="Search..."
                                  options={[
                                    { value: "easy", label: "Easy" },
                                    { value: "medium", label: "Medium" },
                                    { value: "hard", label: "Hard" },
                                  ]}
                                  className="flex-1"
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAddTopic();
                                  }}
                                  disabled={!newTopicName.trim()}
                                >
                                  <Plus className="h-4 w-4 mr-1" />
                                  Add Chapter
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button type="button" variant="outline" onClick={handleSkipAndClose}>
                Skip & Finish
              </Button>
              <Button 
                type="button" 
                onClick={handleSaveAll}
                disabled={addedSubjects.length === 0 || addUniversalSubject.isPending || assignSubject.isPending || addTopic.isPending}
              >
                {(addUniversalSubject.isPending || assignSubject.isPending || addTopic.isPending) 
                  ? "Saving..." 
                  : `Save ${addedSubjects.length} Subject${addedSubjects.length !== 1 ? "s" : ""} & Finish`
                }
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
