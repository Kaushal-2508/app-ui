import { useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { getDisplaySection } from "@/lib/sectionDisplay";
import { 
  ChevronRight, 
  ChevronDown, 
  GraduationCap, 
  BookOpen, 
  Users,
  Shield,
  CheckCircle2,
  AlertCircle,
  Search,
  Loader2,
  X,
  Tag,
  Plus,
  Building2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { motion, AnimatePresence } from "framer-motion";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { toast } from "sonner";
import { 
  useExamClassHierarchy, 
  useExamSubjectsForClass,
  type ClassGroup, 
  type ClassSection,
  type SubjectOption 
} from "@/hooks/useExamClassHierarchy";
import { useTopicsBySubjectsAndGrades, useSchoolCustomTopics } from "@/hooks/useTopics";
import { useGradeLevelFromClass } from "@/hooks/useTeacherClasses";
import { TopicAutocomplete } from "@/components/shared/TopicAutocomplete";

interface ClassSubjectSelectorProps {
  institutionId: string | null | undefined;
  selectedClassIds: string[];
  selectedSubjectId: string | null;
  onSelectionChange: (classIds: string[], subjectId: string | null) => void;
  selectedTopicIds?: string[];
  selectedCustomTopicIds?: string[];
  onTopicChange?: (topicIds: string[], customTopicIds: string[]) => void;
  errors?: { classIds?: string; subjectId?: string; topicIds?: string };
  multiSelect?: boolean;
  maxSelections?: number;
}

export function ClassSubjectSelector({
  institutionId,
  selectedClassIds,
  selectedSubjectId,
  onSelectionChange,
  selectedTopicIds = [],
  selectedCustomTopicIds = [],
  onTopicChange,
  errors,
  multiSelect = false,
  maxSelections,
}: ClassSubjectSelectorProps) {
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set());
  const [classSearch, setClassSearch] = useState("");
  const [showTopicAutocomplete, setShowTopicAutocomplete] = useState(false);
  const [selectedTopicName, setSelectedTopicName] = useState("");
  
  const { 
    classGroups, 
    isLoading: classesLoading, 
    teacherSubjectsMap,
    isAdmin,
    isCoordinator,
    isTeacher 
  } = useExamClassHierarchy(institutionId);
  
  // Find all selected class info
  const selectedClassesInfo = useMemo(() => {
    const infos: { group: ClassGroup; section: ClassSection }[] = [];
    for (const classId of selectedClassIds) {
      for (const group of classGroups) {
        const section = group.sections.find(s => s.id === classId);
        if (section) {
          infos.push({ group, section });
          break;
        }
      }
    }
    return infos;
  }, [classGroups, selectedClassIds]);
  
  // Use first selected class for subject fetching
  const primaryClassId = selectedClassIds[0] || null;
  const primaryClassInfo = selectedClassesInfo[0] || null;
  
  // Determine access type for subjects
  const accessType = useMemo(() => {
    if (isAdmin) return "admin" as const;
    
    if (primaryClassInfo) {
      if (isTeacher && !isCoordinator && teacherSubjectsMap.has(primaryClassId!)) {
        return "teacher" as const;
      }
    }
    
    if (isCoordinator) return "coordinator" as const;
    return "teacher" as const;
  }, [isAdmin, isCoordinator, isTeacher, primaryClassInfo, primaryClassId, teacherSubjectsMap]);
  
  // Fetch subjects for primary selected class
  const { 
    data: availableSubjects, 
    isLoading: subjectsLoading 
  } = useExamSubjectsForClass(primaryClassId, institutionId, accessType);
  
  // For teachers with limited access, use cached subjects
  const displaySubjects = useMemo(() => {
    if (accessType === "teacher" && primaryClassId && teacherSubjectsMap.has(primaryClassId)) {
      return teacherSubjectsMap.get(primaryClassId)!;
    }
    return availableSubjects || [];
  }, [accessType, teacherSubjectsMap, primaryClassId, availableSubjects]);
  
  // Filter classes by search
  const filteredGroups = useMemo(() => {
    if (!classSearch.trim()) return classGroups;
    
    const search = classSearch.toLowerCase();
    return classGroups
      .map(group => ({
        ...group,
        sections: group.sections.filter(s => 
          s.name.toLowerCase().includes(search) ||
          s.section?.toLowerCase().includes(search) ||
          group.className.toLowerCase().includes(search)
        ),
      }))
      .filter(group => group.sections.length > 0);
  }, [classGroups, classSearch]);
  
  // Find section by ID helper
  const findSectionById = useCallback((id: string): ClassSection | null => {
    for (const group of classGroups) {
      const section = group.sections.find(s => s.id === id);
      if (section) return section;
    }
    return null;
  }, [classGroups]);
  
  const toggleClassExpansion = (className: string) => {
    setExpandedClasses(prev => {
      const next = new Set(prev);
      if (next.has(className)) {
        next.delete(className);
      } else {
        next.add(className);
      }
      return next;
    });
  };
  
  const handleSectionToggle = (section: ClassSection) => {
    if (!multiSelect) {
      // Single selection mode
      onSelectionChange([section.id], null);
    } else {
      // Multi-select mode - toggle selection
      const isCurrentlySelected = selectedClassIds.includes(section.id);
      let newIds: string[];
      
      if (isCurrentlySelected) {
        newIds = selectedClassIds.filter(id => id !== section.id);
      } else {
        // Check max limit
        if (maxSelections && selectedClassIds.length >= maxSelections) {
          toast.warning(`Maximum ${maxSelections} classes can be selected`);
          return;
        }
        newIds = [...selectedClassIds, section.id];
      }
      
      // Reset subject if class selection changed
      onSelectionChange(newIds, newIds.length > 0 ? selectedSubjectId : null);
    }
    
    // Auto-expand the parent class
    const group = classGroups.find(g => g.sections.some(s => s.id === section.id));
    if (group) {
      setExpandedClasses(prev => new Set(prev).add(group.className));
    }
  };
  
  const handleSelectAllInClass = (group: ClassGroup) => {
    const allSectionIds = group.sections.map(s => s.id);
    const allSelected = allSectionIds.every(id => selectedClassIds.includes(id));
    
    let newIds: string[];
    if (allSelected) {
      // Deselect all sections in this class
      newIds = selectedClassIds.filter(id => !allSectionIds.includes(id));
    } else {
      // Select all sections in this class
      const toAdd = allSectionIds.filter(id => !selectedClassIds.includes(id));
      
      // Check max limit
      if (maxSelections && selectedClassIds.length + toAdd.length > maxSelections) {
        toast.warning(`Maximum ${maxSelections} classes can be selected`);
        return;
      }
      
      newIds = [...selectedClassIds, ...toAdd];
    }
    
    onSelectionChange(newIds, newIds.length > 0 ? selectedSubjectId : null);
  };
  
  const handleRemoveClass = (classId: string) => {
    const newIds = selectedClassIds.filter(id => id !== classId);
    onSelectionChange(newIds, newIds.length > 0 ? selectedSubjectId : null);
  };
  
  const handleClearAll = () => {
    onSelectionChange([], null);
  };
  
  const handleSubjectSelect = (subjectId: string) => {
    onSelectionChange(selectedClassIds, subjectId);
  };
  
  // Get role display
  const getRoleInfo = () => {
    if (isAdmin) return { label: "Admin", description: "All classes available" };
    if (isCoordinator && isTeacher) return { label: "Coordinator + Teacher", description: "Assigned classes & teaching subjects" };
    if (isCoordinator) return { label: "Coordinator", description: "All subjects in assigned classes" };
    if (isTeacher) return { label: "Teacher", description: "Only your assigned subjects" };
    return { label: "User", description: "" };
  };
  
  const roleInfo = getRoleInfo();

  // Topic hooks
  const subjectIds = selectedSubjectId ? [selectedSubjectId] : [];
  const { data: availableTopics } = useTopicsBySubjectsAndGrades(subjectIds, selectedClassIds);
  const { data: customTopics } = useSchoolCustomTopics(institutionId || null, subjectIds);
  const { data: resolvedGradeLevel } = useGradeLevelFromClass(selectedClassIds.length > 0 ? selectedClassIds[0] : null);

  const handleTopicToggle = (topicId: string, isCustom: boolean, checked: boolean) => {
    if (!onTopicChange) return;
    if (isCustom) {
      const newCustom = checked
        ? [...selectedCustomTopicIds, topicId]
        : selectedCustomTopicIds.filter(id => id !== topicId);
      onTopicChange(selectedTopicIds, newCustom);
    } else {
      const newTopics = checked
        ? [...selectedTopicIds, topicId]
        : selectedTopicIds.filter(id => id !== topicId);
      onTopicChange(newTopics, selectedCustomTopicIds);
    }
  };

  const handleAddNewTopic = (topicId: string | null, topicName: string) => {
    if (!onTopicChange || !topicId) return;
    if (!selectedCustomTopicIds.includes(topicId)) {
      onTopicChange(selectedTopicIds, [...selectedCustomTopicIds, topicId]);
    }
    setSelectedTopicName("");
    setShowTopicAutocomplete(false);
  };

  const totalTopics = selectedTopicIds.length + selectedCustomTopicIds.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold flex items-center justify-center gap-2">
          <GraduationCap className="h-6 w-6 text-primary" />
          Select Class{multiSelect ? "es" : ""} & Subject
        </h2>
        <p className="text-muted-foreground">
          {multiSelect 
            ? "Choose one or more classes and a subject for this exam"
            : "Choose the class and subject for this exam"
          }
        </p>
      </div>
      
      {/* Role indicator */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-3">
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-primary" />
            <div>
              <p className="font-medium text-sm flex items-center gap-2">
                {roleInfo.label}
                <Badge variant="outline" className="text-xs">{roleInfo.label}</Badge>
              </p>
              <p className="text-xs text-muted-foreground">{roleInfo.description}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Class Tree Panel */}
        <Card className="lg:row-span-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <GraduationCap className="h-5 w-5" />
                  Classes & Sections
                </CardTitle>
                <CardDescription>
                  {multiSelect 
                    ? "Select multiple classes for this exam"
                    : "Select the class and section for this exam"
                  }
                </CardDescription>
              </div>
              {multiSelect && selectedClassIds.length > 1 && (
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={handleClearAll}
                  className="text-muted-foreground hover:text-destructive"
                >
                  Clear All
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search classes..."
                value={classSearch}
                onChange={(e) => setClassSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            
            {/* Class Tree */}
            <ScrollArea className="h-[320px] pr-3">
              {classesLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Loading classes...
                </div>
              ) : filteredGroups.length === 0 ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {classSearch 
                      ? "No classes match your search" 
                      : "No classes assigned to you. Contact your administrator."
                    }
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-1">
                  {filteredGroups.map((group) => (
                    <ClassGroupItem
                      key={group.className}
                      group={group}
                      isExpanded={expandedClasses.has(group.className)}
                      selectedSectionIds={selectedClassIds}
                      multiSelect={multiSelect}
                      onToggle={() => toggleClassExpansion(group.className)}
                      onSelectSection={handleSectionToggle}
                      onSelectAll={() => handleSelectAllInClass(group)}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
            
            {errors?.classIds && (
              <p className="text-sm text-destructive">{errors.classIds}</p>
            )}
          </CardContent>
        </Card>
        
        {/* Subject Selection Panel */}
        <Card className="lg:row-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Available Subjects
            </CardTitle>
            <CardDescription>
              {primaryClassInfo 
                ? `Subjects for ${primaryClassInfo.section.displayName}${selectedClassIds.length > 1 ? ` (+${selectedClassIds.length - 1} more)` : ''}`
                : "Select a class first to see available subjects"
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedClassIds.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <Users className="h-12 w-12 mb-3 opacity-50" />
                <p className="font-medium">No Class Selected</p>
                <p className="text-sm">Select a class from the left panel to view subjects</p>
              </div>
            ) : subjectsLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading subjects...
              </div>
            ) : displaySubjects.length === 0 ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {accessType === "teacher"
                    ? "No subjects assigned to you for this class."
                    : "No subjects available for this class."
                  }
                </AlertDescription>
              </Alert>
            ) : (
              <ScrollArea className="h-[320px] pr-3">
                <RadioGroup
                  value={selectedSubjectId || ""}
                  onValueChange={handleSubjectSelect}
                  className="space-y-2"
                >
                  {displaySubjects.map((subject) => (
                    <SubjectRadioItem
                      key={subject.id}
                      subject={subject}
                      isSelected={selectedSubjectId === subject.id}
                    />
                  ))}
                </RadioGroup>
              </ScrollArea>
            )}
            
            {errors?.subjectId && (
              <p className="text-sm text-destructive mt-2">{errors.subjectId}</p>
            )}
          </CardContent>
        </Card>

        {/* Topics Panel */}
        <Card className="lg:row-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Tag className="h-5 w-5" />
              Select Chapters
            </CardTitle>
            <CardDescription>
              {selectedSubjectId 
                ? "Choose topics for this exam (required)"
                : "Select a subject first to see topics"
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedSubjectId ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <Tag className="h-12 w-12 mb-3 opacity-50" />
                <p className="font-medium">No Subject Selected</p>
                <p className="text-sm">Select a subject to view available topics</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowTopicAutocomplete(!showTopicAutocomplete)}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Chapter
                  </Button>
                  {totalTopics > 0 && (
                    <Badge variant="secondary">{totalTopics} selected</Badge>
                  )}
                </div>

                {showTopicAutocomplete && (
                  <div className="border rounded-lg p-3 bg-muted/30">
                    <TopicAutocomplete
                      institutionId={institutionId || null}
                      subjectId={selectedSubjectId}
                      gradeLevelId={resolvedGradeLevel?.id || ""}
                      value={null}
                      topicName={selectedTopicName}
                      onChange={handleAddNewTopic}
                    />
                    <p className="text-xs text-muted-foreground mt-2">Search or create a new topic.</p>
                  </div>
                )}

                <ScrollArea className="h-[250px] pr-3">
                  <div className="space-y-3">
                    {customTopics && customTopics.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <Building2 className="h-3 w-3" /> School Topics
                        </p>
                        <div className="grid gap-1">
                          {customTopics.map((topic: any) => {
                            const isSelected = selectedCustomTopicIds.includes(topic.id);
                            return (
                              <label key={topic.id} className={cn(
                                "flex items-center gap-2 text-sm cursor-pointer p-2 rounded-md transition-colors",
                                isSelected ? "bg-primary/10" : "hover:bg-muted"
                              )}>
                                <Checkbox checked={isSelected} onCheckedChange={(checked) => handleTopicToggle(topic.id, true, checked as boolean)} />
                                <span className="flex-1">{topic.topic_name}</span>
                                <Badge variant="outline" className="text-xs">Custom</Badge>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {availableTopics && availableTopics.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <BookOpen className="h-3 w-3" /> Syllabus Topics
                        </p>
                        <div className="grid gap-1">
                          {availableTopics.map((topic: any) => {
                            const isSelected = selectedTopicIds.includes(topic.id);
                            return (
                              <label key={topic.id} className={cn(
                                "flex items-center gap-2 text-sm cursor-pointer p-2 rounded-md transition-colors",
                                isSelected ? "bg-primary/10" : "hover:bg-muted"
                              )}>
                                <Checkbox checked={isSelected} onCheckedChange={(checked) => handleTopicToggle(topic.id, false, checked as boolean)} />
                                <span className="flex-1">{topic.topic_name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {(!availableTopics || availableTopics.length === 0) && (!customTopics || customTopics.length === 0) && (
                      <div className="text-center py-4 text-muted-foreground">
                        <Tag className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No chapters found for this subject.</p>
                        <p className="text-xs">Use "Add Chapter" to create custom chapters.</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}

            {errors?.topicIds && (
              <p className="text-sm text-destructive mt-2">{errors.topicIds}</p>
            )}
          </CardContent>
        </Card>
      </div>
      
      {/* Selection Summary */}
      <AnimatePresence>
        {(selectedClassIds.length > 0 || selectedSubjectId) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <Card className="bg-muted/50">
              <CardContent className="py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                    <span className="font-medium">Selected:</span>
                  </div>
                  
                  {/* Class badges */}
                  {selectedClassIds.length > 5 ? (
                    // Compact view for many selections
                    <Badge variant="secondary" className="text-sm py-1">
                      <GraduationCap className="h-3.5 w-3.5 mr-1" />
                      {selectedClassIds.length} classes selected
                    </Badge>
                  ) : (
                    // Individual badges
                    selectedClassIds.map(id => {
                      const section = findSectionById(id);
                      return section && (
                        <Badge key={id} variant="secondary" className="text-sm py-1 gap-1">
                          <GraduationCap className="h-3.5 w-3.5" />
                          {section.displayName}
                          {multiSelect && (
                            <X 
                              className="h-3 w-3 cursor-pointer hover:text-destructive ml-1" 
                              onClick={() => handleRemoveClass(id)}
                            />
                          )}
                        </Badge>
                      );
                    })
                  )}
                  
                  {selectedSubjectId && displaySubjects.find(s => s.id === selectedSubjectId) && (
                    <Badge variant="outline" className="text-sm py-1">
                      <BookOpen className="h-3.5 w-3.5 mr-1" />
                      {displaySubjects.find(s => s.id === selectedSubjectId)?.name}
                    </Badge>
                  )}

                  {totalTopics > 0 && (
                    <Badge variant="outline" className="text-sm py-1">
                      <Tag className="h-3.5 w-3.5 mr-1" />
                      {totalTopics} topic{totalTopics !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Class Group Accordion Item
interface ClassGroupItemProps {
  group: ClassGroup;
  isExpanded: boolean;
  selectedSectionIds: string[];
  multiSelect: boolean;
  onToggle: () => void;
  onSelectSection: (section: ClassSection) => void;
  onSelectAll: () => void;
}

function ClassGroupItem({ 
  group, 
  isExpanded, 
  selectedSectionIds,
  multiSelect,
  onToggle, 
  onSelectSection,
  onSelectAll,
}: ClassGroupItemProps) {
  const selectedCount = group.sections.filter(s => selectedSectionIds.includes(s.id)).length;
  const hasSelectedSection = selectedCount > 0;
  const allSelected = selectedCount === group.sections.length;
  const someSelected = selectedCount > 0 && !allSelected;
  
  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <button
          className={cn(
            "w-full flex items-center gap-2 p-3 rounded-lg text-left transition-colors",
            "hover:bg-accent",
            hasSelectedSection && "bg-primary/10 border border-primary/20"
          )}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0" />
          )}
          <GraduationCap className={cn(
            "h-4 w-4 shrink-0",
            hasSelectedSection ? "text-primary" : "text-muted-foreground"
          )} />
          <span className="font-medium flex-1">{group.className}</span>
          
          {/* Select All checkbox for multi-select mode */}
          {multiSelect && (
            <Checkbox
              checked={allSelected}
              data-indeterminate={someSelected}
              className={cn(someSelected && "opacity-70")}
              onClick={(e) => {
                e.stopPropagation();
                onSelectAll();
              }}
            />
          )}
          
          <Badge variant="outline" className="text-xs">
            {selectedCount > 0 && multiSelect 
              ? `${selectedCount}/${group.sections.length}` 
              : `${group.sections.length} ${group.sections.length === 1 ? "section" : "sections"}`
            }
          </Badge>
        </button>
      </CollapsibleTrigger>
      
      <CollapsibleContent>
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="ml-6 mt-1 space-y-1"
            >
              {group.sections.map((section) => (
                <SectionItem
                  key={section.id}
                  section={section}
                  isSelected={selectedSectionIds.includes(section.id)}
                  multiSelect={multiSelect}
                  onToggle={() => onSelectSection(section)}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Section Item
interface SectionItemProps {
  section: ClassSection;
  isSelected: boolean;
  multiSelect: boolean;
  onToggle: () => void;
}

function SectionItem({ section, isSelected, multiSelect, onToggle }: SectionItemProps) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "w-full flex items-center gap-2 p-2.5 pl-4 rounded-lg text-left transition-all",
        "border-l-2",
        isSelected 
          ? "bg-primary/10 border-l-primary text-primary font-medium" 
          : "border-l-transparent hover:bg-accent hover:border-l-muted-foreground/50"
      )}
    >
      {multiSelect ? (
        <Checkbox 
          checked={isSelected} 
          className="pointer-events-none"
        />
      ) : (
        <div className={cn(
          "h-2 w-2 rounded-full shrink-0",
          isSelected ? "bg-primary" : "bg-muted-foreground/30"
        )} />
      )}
      <span className="flex-1 text-sm">
        {section.section ? `Section ${getDisplaySection(section.name, section.section) ?? section.section}` : section.name}
      </span>
      {isSelected && (
        <CheckCircle2 className="h-4 w-4 text-primary" />
      )}
    </button>
  );
}

// Subject Radio Item
interface SubjectRadioItemProps {
  subject: SubjectOption;
  isSelected: boolean;
}

function SubjectRadioItem({ subject, isSelected }: SubjectRadioItemProps) {
  return (
    <Label
      htmlFor={subject.id}
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all",
        isSelected 
          ? "border-primary bg-primary/5 shadow-sm" 
          : "border-border hover:border-primary/50 hover:bg-muted/50"
      )}
    >
      <RadioGroupItem value={subject.id} id={subject.id} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{subject.name}</span>
          {subject.code && (
            <Badge variant="outline" className="text-xs shrink-0">
              {subject.code}
            </Badge>
          )}
          <SourceBadge 
            source={subject.isGlobal ? "global" : "institute"} 
            size="sm" 
          />
        </div>
        {subject.category && (
          <p className="text-xs text-muted-foreground mt-0.5 capitalize">
            {subject.category}
          </p>
        )}
      </div>
      {isSelected && (
        <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
      )}
    </Label>
  );
}
