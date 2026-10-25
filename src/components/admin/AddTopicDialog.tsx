import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BookOpen, GraduationCap, Layers, Plus, X, ArrowRight, Check } from "lucide-react";
import { extractLanguages } from "@/lib/languageUtils";

interface AddTopicDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STREAMS = [
  { value: "science", label: "Science" },
  { value: "commerce", label: "Commerce" },
  { value: "arts", label: "Arts/Humanities" },
];

export function AddTopicDialog({ open, onOpenChange }: AddTopicDialogProps) {
  const queryClient = useQueryClient();
  
  // Step state
  const [step, setStep] = useState(1);
  
  // Selection state
  const [selectedGradeId, setSelectedGradeId] = useState("");
  const [selectedStream, setSelectedStream] = useState("");
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  
  // Form state
  const [formData, setFormData] = useState({
    topic_name: "",
    topic_name_hindi: "",
    difficulty_level: "",
    display_order: 1,
    chapter_name: "",
    chapter_number: 1,
    learning_outcomes: "",
    estimated_hours: 2,
    prerequisite_topics: "",
    keywords: [] as string[],
    is_optional: false,
  });
  const [newKeyword, setNewKeyword] = useState("");

  // Fetch grade levels
  const { data: grades = [] } = useQuery({
    queryKey: ["grade-levels"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grade_levels")
        .select("*")
        .order("grade_number");
      if (error) throw error;
      return data;
    },
  });

  // Fetch subjects
  const { data: subjects = [] } = useQuery({
    queryKey: ["universal-subjects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("universal_subjects")
        .select("*")
        .order("display_order");
      if (error) throw error;
      return data;
    },
  });

  const selectedGrade = grades.find(g => g.id === selectedGradeId);
  const isHigherSecondary = selectedGrade && selectedGrade.grade_number >= 11;

  useEffect(() => {
    if (!isHigherSecondary) {
      setSelectedStream("");
    }
  }, [selectedGradeId, isHigherSecondary]);

  // Save mutation with auto language detection
  const saveMutation = useMutation({
    mutationFn: async () => {
      // Auto-detect language from topic name
      const { english: topicEnglish, hindi: topicHindi } = extractLanguages(formData.topic_name);
      
      const { error } = await supabase
        .from("syllabus_topics")
        .insert({
          grade_level_id: selectedGradeId,
          subject_id: selectedSubjectId,
          topic_name: topicEnglish,
          topic_name_hindi: topicHindi || formData.topic_name_hindi || null,
          difficulty_level: formData.difficulty_level || null,
          display_order: formData.display_order,
        })
        .select("id")
        .maybeSingle();
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["syllabus-topics"] });
      toast.success("Chapter added successfully!");
      resetAndClose();
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  const resetAndClose = () => {
    setStep(1);
    setSelectedGradeId("");
    setSelectedStream("");
    setSelectedSubjectId("");
    setFormData({
      topic_name: "",
      topic_name_hindi: "",
      difficulty_level: "",
      display_order: 1,
      chapter_name: "",
      chapter_number: 1,
      learning_outcomes: "",
      estimated_hours: 2,
      prerequisite_topics: "",
      keywords: [],
      is_optional: false,
    });
    setNewKeyword("");
    onOpenChange(false);
  };

  const addKeyword = () => {
    if (newKeyword.trim() && !formData.keywords.includes(newKeyword.trim())) {
      setFormData(prev => ({
        ...prev,
        keywords: [...prev.keywords, newKeyword.trim()]
      }));
      setNewKeyword("");
    }
  };

  const removeKeyword = (keyword: string) => {
    setFormData(prev => ({
      ...prev,
      keywords: prev.keywords.filter(k => k !== keyword)
    }));
  };

  const canProceedStep1 = selectedGradeId !== "";
  const canProceedStep2 = selectedSubjectId !== "";
  const canSubmit = formData.topic_name.trim() !== "";

  const renderStepIndicator = () => (
    <div className="flex items-center justify-center gap-2 mb-6">
      {[1, 2, 3].map((s) => (
        <div key={s} className="flex items-center">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
            step === s 
              ? "bg-primary text-primary-foreground" 
              : step > s 
                ? "bg-green-500 text-white"
                : "bg-muted text-muted-foreground"
          }`}>
            {step > s ? <Check className="h-4 w-4" /> : s}
          </div>
          {s < 3 && (
            <ArrowRight className={`h-4 w-4 mx-2 ${step > s ? "text-green-500" : "text-muted-foreground"}`} />
          )}
        </div>
      ))}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(open) => {
      if (!open) resetAndClose();
      else onOpenChange(open);
    }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Chapter</DialogTitle>
          <DialogDescription>
            {step === 1 && "Step 1: Select the grade and stream"}
            {step === 2 && "Step 2: Select the subject"}
            {step === 3 && "Step 3: Enter chapter details"}
          </DialogDescription>
        </DialogHeader>

        {renderStepIndicator()}

        {/* Step 1: Grade & Stream Selection */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <GraduationCap className="h-4 w-4" />
                Select Grade *
              </Label>
              <div className="grid grid-cols-3 gap-2">
                {grades.map((grade) => (
                  <Card 
                    key={grade.id}
                    className={`cursor-pointer transition-all hover:border-primary ${
                      selectedGradeId === grade.id ? "border-primary bg-primary/5" : ""
                    }`}
                    onClick={() => setSelectedGradeId(grade.id)}
                  >
                    <CardContent className="p-3 text-center">
                      <p className="font-medium">{grade.grade_name}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            {/* Stream for Class 11-12 */}
            {isHigherSecondary && (
              <div className="space-y-2">
                <Label>Select Stream *</Label>
                <div className="flex flex-wrap gap-2">
                  {STREAMS.map((stream) => (
                    <Badge
                      key={stream.value}
                      variant={selectedStream === stream.value ? "default" : "outline"}
                      className="cursor-pointer py-2 px-4"
                      onClick={() => setSelectedStream(stream.value)}
                    >
                      {stream.label}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Selection Summary */}
            {selectedGradeId && (
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm font-medium">Selected:</p>
                <div className="flex flex-wrap gap-2 mt-1">
                  <Badge variant="secondary">{selectedGrade?.grade_name}</Badge>
                  {selectedStream && (
                    <Badge variant="default" className="capitalize">{selectedStream}</Badge>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Subject Selection */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-lg mb-4">
              <p className="text-sm text-muted-foreground">Adding topic for:</p>
              <div className="flex flex-wrap gap-2 mt-1">
                <Badge variant="secondary">{selectedGrade?.grade_name}</Badge>
                {selectedStream && (
                  <Badge variant="default" className="capitalize">{selectedStream}</Badge>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                Select Subject *
              </Label>
              <div className="grid grid-cols-2 gap-2 max-h-[300px] overflow-y-auto">
                {subjects.map((subject) => (
                  <Card 
                    key={subject.id}
                    className={`cursor-pointer transition-all hover:border-primary ${
                      selectedSubjectId === subject.id ? "border-primary bg-primary/5" : ""
                    }`}
                    onClick={() => setSelectedSubjectId(subject.id)}
                  >
                    <CardContent className="p-3">
                      <p className="font-medium">{subject.name}</p>
                      {subject.code && (
                        <p className="text-xs text-muted-foreground">{subject.code}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Topic Details */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-lg mb-4">
              <p className="text-sm text-muted-foreground">Adding topic for:</p>
              <div className="flex flex-wrap gap-2 mt-1">
                <Badge variant="secondary">{selectedGrade?.grade_name}</Badge>
                {selectedStream && (
                  <Badge variant="default" className="capitalize">{selectedStream}</Badge>
                )}
                <Badge variant="outline">
                  {subjects.find(s => s.id === selectedSubjectId)?.name}
                </Badge>
              </div>
            </div>

            {/* Chapter Info */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2 col-span-2">
                <Label>Chapter Name</Label>
                <Input
                  value={formData.chapter_name}
                  onChange={(e) => setFormData({ ...formData, chapter_name: e.target.value })}
                  placeholder="e.g., Algebra Basics"
                />
              </div>
              <div className="space-y-2">
                <Label>Chapter #</Label>
                <Input
                  type="number"
                  min={1}
                  value={formData.chapter_number}
                  onChange={(e) => setFormData({ ...formData, chapter_number: parseInt(e.target.value) || 1 })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Chapter Name *
              </Label>
              <Input
                value={formData.topic_name}
                onChange={(e) => setFormData({ ...formData, topic_name: e.target.value })}
                placeholder="Enter topic name"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Chapter Name (Hindi)</Label>
              <Input
                value={formData.topic_name_hindi}
                onChange={(e) => setFormData({ ...formData, topic_name_hindi: e.target.value })}
                placeholder="हिंदी में विषय का नाम"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Difficulty</Label>
                <SearchableSelect
                  value={formData.difficulty_level}
                  onValueChange={(value) => setFormData({ ...formData, difficulty_level: value })}
                  placeholder="Select"
                  searchPlaceholder="Search difficulty..."
                  options={[
                    { value: "easy", label: "Easy" },
                    { value: "medium", label: "Medium" },
                    { value: "hard", label: "Hard" },
                  ]}
                />
              </div>
              <div className="space-y-2">
                <Label>Order</Label>
                <Input
                  type="number"
                  value={formData.display_order}
                  onChange={(e) => setFormData({ ...formData, display_order: parseInt(e.target.value) || 1 })}
                  min={1}
                />
              </div>
              <div className="space-y-2">
                <Label>Est. Hours</Label>
                <Input
                  type="number"
                  value={formData.estimated_hours}
                  onChange={(e) => setFormData({ ...formData, estimated_hours: parseFloat(e.target.value) || 1 })}
                  min={0.5}
                  step={0.5}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Learning Outcomes</Label>
              <Textarea
                value={formData.learning_outcomes}
                onChange={(e) => setFormData({ ...formData, learning_outcomes: e.target.value })}
                placeholder="After completing this topic, students will be able to..."
                rows={3}
              />
            </div>

            {/* Keywords */}
            <div className="space-y-2">
              <Label>Keywords (for search & AI)</Label>
              <div className="flex gap-2">
                <Input
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  placeholder="Add keyword..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addKeyword();
                    }
                  }}
                />
                <Button type="button" variant="outline" size="icon" onClick={addKeyword}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {formData.keywords.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {formData.keywords.map((keyword) => (
                    <Badge key={keyword} variant="secondary" className="gap-1">
                      {keyword}
                      <button
                        type="button"
                        onClick={() => removeKeyword(keyword)}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step > 1 && (
            <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          {step === 1 && (
            <Button 
              type="button" 
              onClick={() => setStep(2)}
              disabled={!canProceedStep1 || (isHigherSecondary && !selectedStream)}
            >
              Next: Select Subject
            </Button>
          )}
          {step === 2 && (
            <Button 
              type="button" 
              onClick={() => setStep(3)}
              disabled={!canProceedStep2}
            >
              Next: Chapter Details
            </Button>
          )}
          {step === 3 && (
            <Button 
              type="button" 
              onClick={() => saveMutation.mutate()}
              disabled={!canSubmit || saveMutation.isPending}
            >
              {saveMutation.isPending ? "Adding..." : "Add Chapter"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
