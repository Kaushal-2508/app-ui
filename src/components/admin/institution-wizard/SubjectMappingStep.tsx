import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BookOpen, CheckCircle2, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { ClassConfig } from "./types";

interface SubjectMappingStepProps {
  classes: ClassConfig[];
  onClassesChange: (classes: ClassConfig[]) => void;
}

interface UniversalSubject {
  id: string;
  name: string;
  code: string;
  category: string | null;
  grade_level_id: string | null;
}

interface GradeLevel {
  id: string;
  grade_name: string;
}

export function SubjectMappingStep({ classes, onClassesChange }: SubjectMappingStepProps) {
  // Fetch grade levels
  const { data: gradeLevels = [], isLoading: gradeLevelsLoading } = useQuery({
    queryKey: ['grade-levels-mapping'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('grade_levels')
        .select('id, grade_name')
        .order('display_order');
      
      if (error) throw error;
      return data as GradeLevel[];
    }
  });

  // Fetch universal subjects
  const { data: subjects = [], isLoading: subjectsLoading } = useQuery({
    queryKey: ['universal-subjects-mapping'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('universal_subjects')
        .select('id, name, code, category, grade_level_id')
        .is('institution_id', null)
        .order('name');
      
      if (error) throw error;
      return data as UniversalSubject[];
    }
  });

  // Create mapping from grade name to grade level ID
  const gradeNameToLevelId = useMemo(() => {
    const mapping: Record<string, string> = {};
    gradeLevels.forEach(gl => {
      mapping[gl.grade_name] = gl.id;
    });
    return mapping;
  }, [gradeLevels]);

  // Get subjects for a specific grade
  const getSubjectsForGrade = (gradeName: string): UniversalSubject[] => {
    const gradeLevelId = gradeNameToLevelId[gradeName];
    if (!gradeLevelId) return subjects; // Return all if no specific grade mapping
    return subjects.filter(s => s.grade_level_id === gradeLevelId || s.grade_level_id === null);
  };

  const toggleSubject = (className: string, subjectId: string) => {
    onClassesChange(
      classes.map(c => {
        if (c.name !== className) return c;
        const newSubjectIds = c.subjectIds.includes(subjectId)
          ? c.subjectIds.filter(id => id !== subjectId)
          : [...c.subjectIds, subjectId];
        return { ...c, subjectIds: newSubjectIds };
      })
    );
  };

  const selectAllForClass = (className: string) => {
    const gradeSubjects = getSubjectsForGrade(className);
    onClassesChange(
      classes.map(c => c.name === className 
        ? { ...c, subjectIds: gradeSubjects.map(s => s.id) } 
        : c
      )
    );
  };

  const clearAllForClass = (className: string) => {
    onClassesChange(
      classes.map(c => c.name === className ? { ...c, subjectIds: [] } : c)
    );
  };

  const totalMappings = classes.reduce((sum, c) => sum + c.subjectIds.length * c.sections.length, 0);
  const incompleteClasses = classes.filter(c => c.subjectIds.length === 0);

  if (gradeLevelsLoading || subjectsLoading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Subject Mapping
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Select which subjects should be taught in each class
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span className="text-sm">{totalMappings} subject-section mappings</span>
          </div>
          {incompleteClasses.length > 0 && (
            <div className="flex items-center gap-2 text-amber-600">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{incompleteClasses.length} classes need subjects</span>
            </div>
          )}
        </div>

        {/* Class-Subject Matrix */}
        <ScrollArea className="h-[400px] border rounded-lg">
          <div className="p-4 space-y-6">
            {classes.map(classConfig => {
              const gradeSubjects = getSubjectsForGrade(classConfig.name);
              
              return (
                <div key={classConfig.name} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{classConfig.name}</h4>
                      <Badge variant="outline" className="text-xs">
                        {classConfig.sections.length} sections
                      </Badge>
                      <Badge 
                        variant={classConfig.subjectIds.length > 0 ? "default" : "secondary"} 
                        className="text-xs"
                      >
                        {classConfig.subjectIds.length} subjects
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        className="text-xs text-primary hover:underline"
                        onClick={() => selectAllForClass(classConfig.name)}
                      >
                        Select All
                      </button>
                      <button 
                        className="text-xs text-muted-foreground hover:underline"
                        onClick={() => clearAllForClass(classConfig.name)}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {gradeSubjects.map(subject => (
                      <label 
                        key={subject.id}
                        className={`flex items-center gap-2 p-2 rounded border cursor-pointer transition-colors ${
                          classConfig.subjectIds.includes(subject.id)
                            ? 'bg-primary/10 border-primary'
                            : 'hover:bg-muted/50'
                        }`}
                      >
                        <Checkbox
                          checked={classConfig.subjectIds.includes(subject.id)}
                          onCheckedChange={() => toggleSubject(classConfig.name, subject.id)}
                        />
                        <span className="text-sm truncate">{subject.name}</span>
                      </label>
                    ))}
                  </div>
                  
                  {gradeSubjects.length === 0 && (
                    <p className="text-sm text-muted-foreground italic p-2">
                      No subjects available for this grade level
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* Validation Message */}
        {incompleteClasses.length > 0 && (
          <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-200">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <p className="text-sm">
              Please select at least one subject for: {incompleteClasses.map(c => c.name).join(", ")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
