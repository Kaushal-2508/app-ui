import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  BookOpen, 
  Plus, 
  Search,
  GraduationCap,
  Layers,
  FileText,
  FolderOpen,
  Upload,
  TreePine,
  LayoutGrid,
  ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

// Components
import { GradeCard } from "@/components/syllabus/GradeCard";
import { SubjectCard } from "@/components/syllabus/SubjectCard";
import { TopicAccordion } from "@/components/syllabus/TopicAccordion";
import { SyllabusBreadcrumb } from "@/components/syllabus/SyllabusBreadcrumb";
import { AddTopicToSubjectDialog } from "@/components/syllabus/AddTopicToSubjectDialog";
import { AddMaterialToTopicDialog } from "@/components/syllabus/AddMaterialToTopicDialog";
import { AssignSubjectsDialog } from "@/components/syllabus/AssignSubjectsDialog";
import { AddGradeDialog } from "@/components/admin/AddGradeDialog";
import { AddSubjectDialog } from "@/components/admin/AddSubjectDialog";
import { SyllabusTreeView } from "@/components/syllabus/SyllabusTreeView";
import { BulkUploadGradesDialog } from "@/components/syllabus/BulkUploadGradesDialog";
import { BulkUploadSubjectsTopicsDialog } from "@/components/syllabus/BulkUploadSubjectsTopicsDialog";
import { BulkUploadMaterialsDialog } from "@/components/syllabus/BulkUploadMaterialsDialog";

// Hooks
import {
  useGradesWithCounts,
  useSubjectsByGrade,
  useAllSubjects,
  useTopicsByGradeAndSubject,
  useMaterialsByTopic,
  useDeleteTopic,
  useBulkDeleteTopics,
  useDeleteMaterial,
  useFullSyllabusTree,
  type GradeLevel,
  type Subject,
  type Topic,
} from "@/hooks/useSyllabusHierarchy";
import { useDeleteGradeLevel, useDeleteUniversalSubject } from "@/hooks/useStudyMaterials";

type ViewMode = "tree" | "panel";

export default function SyllabusPage() {
  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  
  // Selection state (for panel view)
  const [selectedGrade, setSelectedGrade] = useState<GradeLevel | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null);
  
  // Search state
  const [gradeSearch, setGradeSearch] = useState("");
  const [subjectSearch, setSubjectSearch] = useState("");
  const [topicSearch, setTopicSearch] = useState("");

  // Dialog states
  const [isAddGradeOpen, setIsAddGradeOpen] = useState(false);
  const [isAddSubjectOpen, setIsAddSubjectOpen] = useState(false);
  const [isAssignSubjectsOpen, setIsAssignSubjectsOpen] = useState(false);
  const [isAddTopicOpen, setIsAddTopicOpen] = useState(false);
  const [isBulkUploadGradesOpen, setIsBulkUploadGradesOpen] = useState(false);
  const [isBulkUploadSubjectsTopicsOpen, setIsBulkUploadSubjectsTopicsOpen] = useState(false);
  const [isBulkUploadMaterialsOpen, setIsBulkUploadMaterialsOpen] = useState(false);
  const [addMaterialContext, setAddMaterialContext] = useState<{
    topic: Topic;
  } | null>(null);
  const [addTopicContext, setAddTopicContext] = useState<{
    gradeId: string;
    gradeName: string;
    subjectId: string;
    subjectName: string;
  } | null>(null);
  const [addMaterialTreeContext, setAddMaterialTreeContext] = useState<{
    topicId: string;
    topicName: string;
    gradeId: string;
    gradeName: string;
    subjectId: string;
    subjectName: string;
  } | null>(null);

  // Queries
  const { data: grades = [], isLoading: gradesLoading } = useGradesWithCounts();
  const { data: gradeSubjects = [], isLoading: subjectsLoading } = useSubjectsByGrade(selectedGrade?.id || null);
  const { data: allSubjects = [] } = useAllSubjects();
  const { data: topics = [], isLoading: topicsLoading } = useTopicsByGradeAndSubject(
    selectedGrade?.id || null,
    selectedSubject?.id || null
  );
  const { data: expandedTopicMaterials = [], isLoading: materialsLoading } = useMaterialsByTopic(expandedTopicId);
  const { data: treeData = [], isLoading: treeLoading } = useFullSyllabusTree();

  // Mutations
  const deleteGrade = useDeleteGradeLevel();
  const deleteSubject = useDeleteUniversalSubject();
  const deleteTopic = useDeleteTopic();
  const bulkDeleteTopics = useBulkDeleteTopics();
  const deleteMaterial = useDeleteMaterial();

  // Computed
  const subjects = selectedGrade ? gradeSubjects : allSubjects;
  const filteredGrades = grades.filter(g => 
    g.grade_name.toLowerCase().includes(gradeSearch.toLowerCase()) ||
    g.grade_number.toString().includes(gradeSearch)
  );
  const filteredSubjects = subjects.filter(s =>
    s.name.toLowerCase().includes(subjectSearch.toLowerCase()) ||
    (s.code && s.code.toLowerCase().includes(subjectSearch.toLowerCase()))
  );
  const filteredTopics = topics.filter(t =>
    t.topic_name.toLowerCase().includes(topicSearch.toLowerCase()) ||
    (t.topic_name_hindi && t.topic_name_hindi.includes(topicSearch))
  );

  // Stats
  const totalTopics = grades.reduce((acc, g) => acc + (g.topic_count || 0), 0);
  const totalSubjects = allSubjects.length;

  // Navigation handlers
  const handleNavigateToGrades = () => {
    setSelectedGrade(null);
    setSelectedSubject(null);
    setExpandedTopicId(null);
  };

  const handleNavigateToSubjects = () => {
    setSelectedSubject(null);
    setExpandedTopicId(null);
  };

  const handleSelectGrade = (grade: GradeLevel) => {
    setSelectedGrade(grade);
    setSelectedSubject(null);
    setExpandedTopicId(null);
  };

  const handleSelectSubject = (subject: Subject) => {
    setSelectedSubject(subject);
    setExpandedTopicId(null);
  };

  // Delete handlers
  const handleDeleteGrade = (gradeId: string) => {
    if (confirm("Delete this grade? This action cannot be undone.")) {
      deleteGrade.mutate(gradeId);
      if (selectedGrade?.id === gradeId) {
        handleNavigateToGrades();
      }
    }
  };

  const handleDeleteSubject = (subjectId: string) => {
    if (confirm("Delete this subject? This action cannot be undone.")) {
      deleteSubject.mutate(subjectId);
      if (selectedSubject?.id === subjectId) {
        handleNavigateToSubjects();
      }
    }
  };

  const handleDeleteTopic = (topicId: string) => {
    deleteTopic.mutate(topicId);
  };

  const handleBulkDeleteTopics = (topicIds: string[]) => {
    bulkDeleteTopics.mutate(topicIds);
  };

  const handleDeleteMaterial = (materialId: string) => {
    deleteMaterial.mutate(materialId);
  };

  // Tree view handlers
  const handleTreeAddTopic = (gradeId: string, subjectId: string, gradeName: string, subjectName: string) => {
    setAddTopicContext({ gradeId, subjectId, gradeName, subjectName });
    setIsAddTopicOpen(true);
  };

  const handleTreeAddMaterial = (topicId: string, topicName: string, gradeId: string, gradeName: string, subjectId: string, subjectName: string) => {
    setAddMaterialTreeContext({ topicId, topicName, gradeId, gradeName, subjectId, subjectName });
  };

  return (
    <div className="h-full flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <BookOpen className="h-8 w-8 text-primary" />
            Syllabus & Study Materials
          </h1>
          <p className="text-muted-foreground">
            Manage grades, subjects, chapters, and study materials
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex items-center rounded-lg border bg-muted p-1">
            <Button
              variant={viewMode === "tree" ? "secondary" : "ghost"}
              size="sm"
              className="gap-1.5"
              onClick={() => setViewMode("tree")}
            >
              <TreePine className="h-4 w-4" />
              Tree
            </Button>
            <Button
              variant={viewMode === "panel" ? "secondary" : "ghost"}
              size="sm"
              className="gap-1.5"
              onClick={() => setViewMode("panel")}
            >
              <LayoutGrid className="h-4 w-4" />
              Panel
            </Button>
          </div>
          
          {/* Add Subject Button */}
          <Button variant="outline" onClick={() => setIsAddSubjectOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Subject
          </Button>
          
          {/* Bulk Upload Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="gap-2">
                <Upload className="h-4 w-4" />
                Bulk Upload
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-popover">
              <DropdownMenuItem onClick={() => setIsBulkUploadGradesOpen(true)}>
                <GraduationCap className="h-4 w-4 mr-2" />
                Upload Grades
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsBulkUploadSubjectsTopicsOpen(true)}>
                <BookOpen className="h-4 w-4 mr-2" />
                Upload Subjects & Chapters
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsBulkUploadMaterialsOpen(true)}>
                <FileText className="h-4 w-4 mr-2" />
                Upload Study Materials
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-primary/10">
              <GraduationCap className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Grades</p>
              <p className="text-2xl font-bold">{grades.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-chart-2/10">
              <BookOpen className="h-6 w-6 text-chart-2" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Subjects</p>
              <p className="text-2xl font-bold">{totalSubjects}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-chart-3/10">
              <Layers className="h-6 w-6 text-chart-3" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Chapters</p>
              <p className="text-2xl font-bold">{totalTopics}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-chart-4/10">
              <FileText className="h-6 w-6 text-chart-4" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Current View</p>
              <p className="text-lg font-semibold truncate capitalize">
                {viewMode} View
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      {viewMode === "tree" ? (
        /* Tree View */
        <Card className="flex-1 min-h-0 overflow-hidden">
          <SyllabusTreeView
            data={treeData}
            isLoading={treeLoading}
            onAddTopic={handleTreeAddTopic}
            onAddMaterial={handleTreeAddMaterial}
            onDeleteGrade={handleDeleteGrade}
            onDeleteTopic={handleDeleteTopic}
            onBulkDeleteTopics={handleBulkDeleteTopics}
            onDeleteMaterial={handleDeleteMaterial}
          />
        </Card>
      ) : (
        /* Panel View */
        <>
          {/* Breadcrumb */}
          <SyllabusBreadcrumb
            gradeName={selectedGrade?.grade_name}
            subjectName={selectedSubject?.name}
            onNavigateToGrades={handleNavigateToGrades}
            onNavigateToSubjects={handleNavigateToSubjects}
          />

          {/* 3-Panel Layout */}
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0">
            {/* Panel 1: Grades */}
            <Card className={cn(
              "lg:col-span-3 flex flex-col min-h-0",
              selectedGrade && "hidden lg:flex"
            )}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <GraduationCap className="h-5 w-5" />
                    Grades
                  </CardTitle>
                  <Button size="sm" onClick={() => setIsAddGradeOpen(true)}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search grades..."
                    className="pl-9"
                    value={gradeSearch}
                    onChange={(e) => setGradeSearch(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent className="flex-1 pt-0 min-h-0">
                <ScrollArea className="h-full pr-3">
                  {gradesLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
                    </div>
                  ) : filteredGrades.length === 0 ? (
                    <EmptyState
                      icon={GraduationCap}
                      title="No grades yet"
                      description="Add your first grade to get started"
                      action={
                        <Button size="sm" onClick={() => setIsAddGradeOpen(true)}>
                          <Plus className="h-4 w-4 mr-1" />
                          Add Grade
                        </Button>
                      }
                    />
                  ) : (
                    <div className="space-y-2">
                      <AnimatePresence mode="popLayout">
                        {filteredGrades.map((grade) => (
                          <GradeCard
                            key={grade.id}
                            id={grade.id}
                            gradeNumber={grade.grade_number}
                            gradeName={grade.grade_name}
                            subjectCount={grade.subject_count}
                            topicCount={grade.topic_count}
                            isSelected={selectedGrade?.id === grade.id}
                            onSelect={() => handleSelectGrade(grade)}
                            onDelete={() => handleDeleteGrade(grade.id)}
                          />
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Panel 2: Subjects */}
            <Card className={cn(
              "lg:col-span-4 flex flex-col min-h-0",
              !selectedGrade && "hidden lg:flex",
              selectedSubject && "hidden lg:flex"
            )}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <BookOpen className="h-5 w-5" />
                    Subjects
                    {selectedGrade && (
                      <span className="text-sm font-normal text-muted-foreground">
                        ({selectedGrade.grade_name})
                      </span>
                    )}
                  </CardTitle>
                  {selectedGrade && (
                    <Button size="sm" onClick={() => setIsAssignSubjectsOpen(true)}>
                      <Plus className="h-4 w-4 mr-1" />
                      Manage
                    </Button>
                  )}
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search subjects..."
                    className="pl-9"
                    value={subjectSearch}
                    onChange={(e) => setSubjectSearch(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent className="flex-1 pt-0 min-h-0">
                <ScrollArea className="h-full pr-3">
                  {subjectsLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
                    </div>
                  ) : !selectedGrade ? (
                    <EmptyState
                      icon={FolderOpen}
                      title="Select a grade"
                      description="Choose a grade from the left to see its subjects"
                    />
                  ) : filteredSubjects.length === 0 ? (
                    <EmptyState
                      icon={BookOpen}
                      title="No subjects assigned"
                      description="Click 'Manage' to assign subjects to this grade"
                      action={
                        <Button size="sm" onClick={() => setIsAssignSubjectsOpen(true)}>
                          <Plus className="h-4 w-4 mr-1" />
                          Manage Subjects
                        </Button>
                      }
                    />
                  ) : (
                    <div className="space-y-2">
                      <AnimatePresence mode="popLayout">
                        {filteredSubjects.map((subject) => (
                          <SubjectCard
                            key={subject.id}
                            id={subject.id}
                            name={subject.name}
                            code={subject.code}
                            category={subject.category}
                            topicCount={subject.topic_count}
                            isSelected={selectedSubject?.id === subject.id}
                            onSelect={() => handleSelectSubject(subject)}
                            onDelete={() => handleDeleteSubject(subject.id)}
                          />
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Panel 3: Chapters & Materials */}
            <Card className={cn(
              "lg:col-span-5 flex flex-col min-h-0",
              !selectedSubject && "hidden lg:flex"
            )}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Layers className="h-5 w-5" />
                    Chapters & Materials
                    {selectedSubject && (
                      <span className="text-sm font-normal text-muted-foreground">
                        ({selectedSubject.name})
                      </span>
                    )}
                  </CardTitle>
                  {selectedGrade && selectedSubject && (
                    <Button size="sm" onClick={() => {
                      setAddTopicContext(null);
                      setIsAddTopicOpen(true);
                    }}>
                      <Plus className="h-4 w-4 mr-1" />
                      Add Chapter
                    </Button>
                  )}
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search chapters..."
                    className="pl-9"
                    value={topicSearch}
                    onChange={(e) => setTopicSearch(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent className="flex-1 pt-0 min-h-0">
                <ScrollArea className="h-full pr-3">
                  {topicsLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
                    </div>
                  ) : !selectedSubject ? (
                    <EmptyState
                      icon={FolderOpen}
                      title="Select a subject"
                      description="Choose a subject to see its chapters and materials"
                    />
                  ) : filteredTopics.length === 0 ? (
                    <EmptyState
                      icon={Layers}
                      title="No topics yet"
                      description="Add topics to organize study materials"
                      action={
                        <Button size="sm" onClick={() => {
                          setAddTopicContext(null);
                          setIsAddTopicOpen(true);
                        }}>
                          <Plus className="h-4 w-4 mr-1" />
                          Add Chapter
                        </Button>
                      }
                    />
                  ) : (
                    <div className="space-y-3">
                      <AnimatePresence mode="popLayout">
                        {filteredTopics.map((topic) => (
                          <TopicAccordion
                            key={topic.id}
                            id={topic.id}
                            topicName={topic.topic_name}
                            topicNameHindi={topic.topic_name_hindi}
                            difficultyLevel={topic.difficulty_level}
                            learningOutcomes={topic.learning_outcomes}
                            materials={expandedTopicId === topic.id ? expandedTopicMaterials : []}
                            materialCount={topic.material_count}
                            isLoadingMaterials={expandedTopicId === topic.id && materialsLoading}
                            onToggle={(topicId, isOpen) => setExpandedTopicId(isOpen ? topicId : null)}
                            onDelete={() => handleDeleteTopic(topic.id)}
                            onAddMaterial={() => setAddMaterialContext({ topic })}
                            onDeleteMaterial={(materialId) => handleDeleteMaterial(materialId)}
                          />
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Dialogs */}
      <AddGradeDialog open={isAddGradeOpen} onOpenChange={setIsAddGradeOpen} />
      <AddSubjectDialog open={isAddSubjectOpen} onOpenChange={setIsAddSubjectOpen} />
      <BulkUploadGradesDialog open={isBulkUploadGradesOpen} onOpenChange={setIsBulkUploadGradesOpen} />
      <BulkUploadSubjectsTopicsDialog open={isBulkUploadSubjectsTopicsOpen} onOpenChange={setIsBulkUploadSubjectsTopicsOpen} />
      <BulkUploadMaterialsDialog open={isBulkUploadMaterialsOpen} onOpenChange={setIsBulkUploadMaterialsOpen} />
      
      {selectedGrade && (
        <AssignSubjectsDialog
          open={isAssignSubjectsOpen}
          onOpenChange={setIsAssignSubjectsOpen}
          gradeId={selectedGrade.id}
          gradeName={selectedGrade.grade_name}
        />
      )}
      
      {/* Add Chapter Dialog */}
      {(addTopicContext || (selectedGrade && selectedSubject)) && (
        <AddTopicToSubjectDialog
          open={isAddTopicOpen}
          onOpenChange={(open) => {
            setIsAddTopicOpen(open);
            if (!open) setAddTopicContext(null);
          }}
          gradeId={addTopicContext?.gradeId || selectedGrade!.id}
          gradeName={addTopicContext?.gradeName || selectedGrade!.grade_name}
          subjectId={addTopicContext?.subjectId || selectedSubject!.id}
          subjectName={addTopicContext?.subjectName || selectedSubject!.name}
          institutionId={null} // Super Admin creates global topics (no institution scope)
        />
      )}

      {/* Add Material Dialog - Panel View */}
      {addMaterialContext && selectedGrade && selectedSubject && (
        <AddMaterialToTopicDialog
          open={!!addMaterialContext}
          onOpenChange={(open) => !open && setAddMaterialContext(null)}
          topicId={addMaterialContext.topic.id}
          topicName={addMaterialContext.topic.topic_name}
          gradeId={selectedGrade.id}
          gradeName={selectedGrade.grade_name}
          subjectId={selectedSubject.id}
          subjectName={selectedSubject.name}
        />
      )}

      {/* Add Material Dialog - Tree View */}
      {addMaterialTreeContext && (
        <AddMaterialToTopicDialog
          open={!!addMaterialTreeContext}
          onOpenChange={(open) => !open && setAddMaterialTreeContext(null)}
          topicId={addMaterialTreeContext.topicId}
          topicName={addMaterialTreeContext.topicName}
          gradeId={addMaterialTreeContext.gradeId}
          gradeName={addMaterialTreeContext.gradeName}
          subjectId={addMaterialTreeContext.subjectId}
          subjectName={addMaterialTreeContext.subjectName}
        />
      )}
    </div>
  );
}

// Empty State Component
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center py-12 text-center"
    >
      <div className="p-4 rounded-full bg-muted mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="font-medium text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-4">{description}</p>
      {action}
    </motion.div>
  );
}
