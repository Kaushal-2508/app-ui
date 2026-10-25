import { useState, useMemo, forwardRef, type ForwardedRef } from "react";
import { cn } from "@/lib/utils";
import { openExternal } from "@/lib/native";
import {
  ChevronRight,
  ChevronDown,
  GraduationCap,
  BookOpen,
  Layers,
  FileText,
  Search,
  Plus,
  Pencil,
  Trash2,
  FolderOpen,
  ChevronUp,
  Calculator,
  FlaskConical,
  Languages,
  Globe,
  Palette,
  Music,
  Dumbbell,
  Code,
  CheckSquare,
  Square,
  X,
  ExternalLink,
  MoreHorizontal,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { motion, AnimatePresence } from "framer-motion";
import type { SyllabusTreeData, SyllabusTreeTopic } from "@/hooks/useSyllabusHierarchy";
import { SourceBadge } from "@/components/shared/SourceBadge";

// Drag-to-reorder (chapters within one subject — tree view).
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChapterReorderHandle } from "@/components/syllabus/ChapterReorderHandle";

interface SyllabusTreeViewProps {
  data: SyllabusTreeData[];
  isLoading: boolean;
  onAddTopic?: (gradeId: string, subjectId: string, gradeName: string, subjectName: string) => void;
  onAddMaterial?: (topicId: string, topicName: string, gradeId: string, gradeName: string, subjectId: string, subjectName: string) => void;
  onDeleteGrade?: (gradeId: string) => void;
  /** Called when the user confirms removal of a chapter from the visible
   *  tree. The second argument is the chapter's institution_id (NULL for
   *  globally-seeded NCERT chapters). The parent uses this to decide
   *  whether to actually DELETE the row or just hide it from this
   *  institution; from the user's perspective both feel like "delete". */
  onDeleteTopic?: (topicId: string, institutionId: string | null, topicName?: string) => void;
  onBulkDeleteTopics?: (topicIds: string[]) => void;
  onDeleteMaterial?: (materialId: string, materialTitle?: string) => void;
  onEditSubject?: (args: {
    subjectId: string;
    subjectName: string;
    category: string | null;
    institutionId: string | null;
    classId: string;
    className: string;
  }) => void;
  onDeleteSubject?: (args: {
    subjectId: string;
    subjectName: string;
    institutionId: string | null;
    classId: string;
    className: string;
  }) => void;
  onManageSegments?: (args: {
    classId: string;
    subjectId: string;
    subjectName: string;
    className: string;
  }) => void;
  /** Current user id — present so a future surface can show whose order this
   *  is; passed through for parity with the panel view. */
  userId?: string | null;
  /** When provided (and the user can reorder), chapters within a subject become
   *  drag-sortable. Called with the subject and the new full ordering of its
   *  (visible) topic ids. Reorder is per-user; persistence is the parent's job. */
  onReorderChapters?: (subjectId: string, orderedTopicIds: string[]) => void;
}

import { TONES, type Tone } from "@/components/shared/design-system";

/** A tone per subject family so a list of subjects is not a column of grey
 *  discs (Naman, 2026-10-07: "make it a little distinguishable"). */
const getSubjectTone = (name: string): Tone => {
  const n = name.toLowerCase();
  if (n.includes("math") || n.includes("algebra") || n.includes("geometry")) return "teal";
  if (n.includes("science") || n.includes("physics") || n.includes("chemistry") || n.includes("biology") || n.includes("evs")) return "mint";
  if (n.includes("english") || n.includes("hindi") || n.includes("punjabi") || n.includes("language")) return "violet";
  if (n.includes("social") || n.includes("history") || n.includes("geography") || n.includes("gk")) return "sky";
  if (n.includes("art") || n.includes("craft") || n.includes("drawing")) return "peach";
  if (n.includes("music") || n.includes("dance")) return "rose";
  if (n.includes("computer") || n.includes("programming") || n.includes("coding") || n.includes("robot")) return "sky";
  return "teal";
};

/** Solid tone for the accent bar on a subject row (TONES only has tints). */
const TONE_BAR: Record<Tone, string> = {
  teal: "bg-brand-primary",
  violet: "bg-brand-secondary",
  peach: "bg-brand-accent",
  mint: "bg-emerald-500",
  sky: "bg-sky-500",
  rose: "bg-rose-500",
};

// Subject icon mapping
const getSubjectIcon = (name: string) => {
  const lowerName = name.toLowerCase();
  if (lowerName.includes("math") || lowerName.includes("algebra") || lowerName.includes("geometry")) return Calculator;
  if (lowerName.includes("science") || lowerName.includes("physics") || lowerName.includes("chemistry") || lowerName.includes("biology")) return FlaskConical;
  if (lowerName.includes("english") || lowerName.includes("hindi") || lowerName.includes("language")) return Languages;
  if (lowerName.includes("social") || lowerName.includes("history") || lowerName.includes("geography")) return Globe;
  if (lowerName.includes("art") || lowerName.includes("craft") || lowerName.includes("drawing")) return Palette;
  if (lowerName.includes("music") || lowerName.includes("dance")) return Music;
  if (lowerName.includes("physical") || lowerName.includes("sports") || lowerName.includes("yoga")) return Dumbbell;
  if (lowerName.includes("computer") || lowerName.includes("programming") || lowerName.includes("coding")) return Code;
  return BookOpen;
};

export function SyllabusTreeView({
  data,
  isLoading,
  onAddTopic,
  onAddMaterial,
  onDeleteGrade,
  onDeleteTopic,
  onBulkDeleteTopics,
  onDeleteMaterial,
  onEditSubject,
  onDeleteSubject,
  onManageSegments,
  onReorderChapters,
}: SyllabusTreeViewProps) {
  const [search, setSearch] = useState("");
  const [expandedGrades, setExpandedGrades] = useState<Set<string>>(new Set());
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  // Filter data based on search
  const filteredData = useMemo(() => {
    if (!search.trim()) return data;
    
    const lowerSearch = search.toLowerCase();
    
    return data.map(grade => {
      const matchingSubjects = grade.subjects.map(subject => {
        const matchingTopics = subject.topics.filter(topic =>
          topic.topic_name.toLowerCase().includes(lowerSearch) ||
          topic.topic_name_hindi?.toLowerCase().includes(lowerSearch) ||
          topic.materials.some(m => m.title.toLowerCase().includes(lowerSearch))
        );
        
        if (
          subject.name.toLowerCase().includes(lowerSearch) ||
          matchingTopics.length > 0
        ) {
          return { ...subject, topics: matchingTopics.length > 0 ? matchingTopics : subject.topics };
        }
        return null;
      }).filter(Boolean);
      
      if (
        grade.grade_name.toLowerCase().includes(lowerSearch) ||
        matchingSubjects.length > 0
      ) {
        return { ...grade, subjects: matchingSubjects.length > 0 ? matchingSubjects : grade.subjects };
      }
      return null;
    }).filter(Boolean) as SyllabusTreeData[];
  }, [data, search]);

  // Expand/Collapse handlers
  const toggleGrade = (gradeId: string) => {
    const next = new Set(expandedGrades);
    if (next.has(gradeId)) next.delete(gradeId);
    else next.add(gradeId);
    setExpandedGrades(next);
  };

  const toggleSubject = (key: string) => {
    const next = new Set(expandedSubjects);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpandedSubjects(next);
  };

  const toggleTopic = (topicId: string) => {
    const next = new Set(expandedTopics);
    if (next.has(topicId)) next.delete(topicId);
    else next.add(topicId);
    setExpandedTopics(next);
  };

  const expandAll = () => {
    const allGrades = new Set(data.map(g => g.id));
    const allSubjects = new Set(
      data.flatMap(g => g.subjects.map(s => `${g.id}-${s.id}`))
    );
    const allTopics = new Set(
      data.flatMap(g => g.subjects.flatMap(s => s.topics.map(t => t.id)))
    );
    setExpandedGrades(allGrades);
    setExpandedSubjects(allSubjects);
    setExpandedTopics(allTopics);
  };

  const collapseAll = () => {
    setExpandedGrades(new Set());
    setExpandedSubjects(new Set());
    setExpandedTopics(new Set());
  };

  // Selection handlers
  const toggleTopicSelection = (topicId: string) => {
    const next = new Set(selectedTopics);
    if (next.has(topicId)) next.delete(topicId);
    else next.add(topicId);
    setSelectedTopics(next);
  };

  const selectAllTopicsInSubject = (topics: { id: string }[]) => {
    const next = new Set(selectedTopics);
    topics.forEach(t => next.add(t.id));
    setSelectedTopics(next);
  };

  const deselectAllTopicsInSubject = (topics: { id: string }[]) => {
    const next = new Set(selectedTopics);
    topics.forEach(t => next.delete(t.id));
    setSelectedTopics(next);
  };

  const clearSelection = () => {
    setSelectedTopics(new Set());
    setIsSelectionMode(false);
  };

  const handleBulkDelete = async () => {
    if (selectedTopics.size === 0) return;
    setShowBulkDeleteConfirm(true);
  };

  const executeBulkDelete = async () => {
    setShowBulkDeleteConfirm(false);
    setIsDeleting(true);
    try {
      if (onBulkDeleteTopics) {
        onBulkDeleteTopics(Array.from(selectedTopics));
      } else if (onDeleteTopic) {
        for (const topicId of selectedTopics) {
          // Bulk-delete path: institution_id not available per-topic here;
          // pass null so the parent treats these as institution-owned rows
          // (global chapters are excluded from the selectable set by UX).
          onDeleteTopic(topicId, null);
        }
      }
      clearSelection();
    } finally {
      setIsDeleting(false);
    }
  };

  // Stats — distinct counts. A subject (and its chapters/materials) shared by
  // several class-sections appears once per section in `data`; counting by id
  // de-duplicates so these totals match the page's KPI tiles ("how much is in
  // my syllabus") rather than summing per-section appearances.
  const stats = useMemo(() => {
    const subjectIds = new Set<string>();
    const topicIds = new Set<string>();
    const materialIds = new Set<string>();
    data.forEach(g => {
      g.subjects.forEach(s => {
        subjectIds.add(s.id);
        s.topics.forEach(t => {
          topicIds.add(t.id);
          t.materials.forEach(m => materialIds.add(m.id));
        });
      });
    });
    return { grades: data.length, subjects: subjectIds.size, topics: topicIds.size, materials: materialIds.size };
  }, [data]);

  // Drag-to-reorder is only valid when there's no search filter (reordering a
  // filtered subset would corrupt the saved order) and not while selecting
  // chapters for bulk delete (the leading slot is the selection checkbox then).
  const reorderEnabled = !!onReorderChapters && !isSelectionMode && search.trim() === "";

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Selection Action Bar */}
      <AnimatePresence>
        {isSelectionMode && selectedTopics.size > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-primary text-primary-foreground px-4 py-3 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <CheckSquare className="h-5 w-5" />
              <span className="font-medium">
                {selectedTopics.size} chapter{selectedTopics.size > 1 ? 's' : ''} selected
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={clearSelection}
                className="gap-1.5"
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkDelete}
                disabled={isDeleting}
                className="gap-1.5"
              >
                <Trash2 className="h-4 w-4" />
                {isDeleting ? 'Deleting...' : 'Delete Selected'}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header with search and controls.
          Mobile: search on its own row, actions wrap below with short labels.
          sm+: single row, search flexes, full labels. */}
      <div className="flex flex-col gap-3 p-3 border-b bg-card sm:flex-row sm:items-center sm:gap-4 sm:p-4">
        <div className="relative w-full sm:flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search grades, subjects, topics, materials..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            // Card-coloured with a hairline and a shadow so it reads as a field
            // and not as a grey band (Naman, 2026-10-07).
            className="pl-9 border-[hsl(var(--surface-stroke))] bg-[hsl(var(--surface-card))] shadow-card placeholder:text-ink-500 focus-visible:ring-brand-primary/40"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <Button
            variant={isSelectionMode ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setIsSelectionMode(!isSelectionMode);
              if (isSelectionMode) setSelectedTopics(new Set());
            }}
            className="gap-1.5"
          >
            {isSelectionMode ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            <span className="hidden sm:inline">{isSelectionMode ? 'Exit Selection' : 'Select Chapters'}</span>
            <span className="sm:hidden">{isSelectionMode ? 'Exit' : 'Select'}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={expandAll} className="gap-1">
            <ChevronDown className="h-4 w-4" />
            <span className="hidden sm:inline">Expand All</span>
            <span className="sm:hidden">Expand</span>
          </Button>
          <Button variant="outline" size="sm" onClick={collapseAll} className="gap-1">
            <ChevronUp className="h-4 w-4" />
            Collapse
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 bg-muted/30 border-b text-xs text-muted-foreground sm:gap-6 sm:px-4 sm:text-sm">
        <span><strong className="text-foreground">{stats.grades}</strong> grades</span>
        <span><strong className="text-foreground">{stats.subjects}</strong> subjects</span>
        <span><strong className="text-foreground">{stats.topics}</strong> topics</span>
        <span><strong className="text-foreground">{stats.materials}</strong> materials</span>
      </div>

      {/* Tree content. A plain scroll box, not the Radix ScrollArea: its
          viewport lays content out as display:table with min-width 100%, so
          any row whose minimum content width exceeds the screen (a subject
          name, its code, the badge, the count and four icon buttons on one
          line) widened the whole tree past the phone and every class card was
          cut at the right edge (2026-09-21 phone test). */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="p-2 space-y-2 sm:p-4">
          {filteredData.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="p-4 rounded-full bg-muted mb-4">
                <FolderOpen className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="font-medium text-foreground mb-1">
                {search ? "No results found" : "No subjects assigned to classes"}
              </h3>
              <p className="text-sm text-muted-foreground max-w-md">
                {search 
                  ? "Try a different search term" 
                  : "Use the Institution management to assign subjects to your classes, or contact your administrator to set up the syllabus for your institution."}
              </p>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              {filteredData.map((grade) => (
                <GradeNode
                  key={grade.id}
                  grade={grade}
                  isExpanded={expandedGrades.has(grade.id)}
                  expandedSubjects={expandedSubjects}
                  expandedTopics={expandedTopics}
                  onToggle={() => toggleGrade(grade.id)}
                  onToggleSubject={toggleSubject}
                  onToggleTopic={toggleTopic}
                  onAddTopic={onAddTopic}
                  onAddMaterial={onAddMaterial}
                  onDeleteGrade={onDeleteGrade}
                  onDeleteTopic={onDeleteTopic}
                  onDeleteMaterial={onDeleteMaterial}
                  onEditSubject={onEditSubject}
                  onDeleteSubject={onDeleteSubject}
                  onManageSegments={onManageSegments}
                  isSelectionMode={isSelectionMode}
                  selectedTopics={selectedTopics}
                  onToggleTopicSelection={toggleTopicSelection}
                  onSelectAllTopicsInSubject={selectAllTopicsInSubject}
                  onDeselectAllTopicsInSubject={deselectAllTopicsInSubject}
                  reorderEnabled={reorderEnabled}
                  onReorderChapters={onReorderChapters}
                />
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* Bulk Delete Confirmation */}
      <AlertDialog open={showBulkDeleteConfirm} onOpenChange={setShowBulkDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedTopics.size} chapter{selectedTopics.size > 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The selected chapters will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executeBulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Grade Node Component
//
// Wrapped in forwardRef because it is rendered as a direct child of
// <AnimatePresence mode="popLayout"> in SyllabusTreeView. popLayout attaches a
// measuring ref to each child via framer-motion's PopChild; a plain function
// component can't receive that ref ("Function components cannot be given refs").
const GradeNode = forwardRef(function GradeNode({
  grade,
  isExpanded,
  expandedSubjects,
  expandedTopics,
  onToggle,
  onToggleSubject,
  onToggleTopic,
  onAddTopic,
  onAddMaterial,
  onDeleteGrade,
  onDeleteTopic,
  onDeleteMaterial,
  onEditSubject,
  onDeleteSubject,
  onManageSegments,
  isSelectionMode,
  selectedTopics,
  onToggleTopicSelection,
  onSelectAllTopicsInSubject,
  onDeselectAllTopicsInSubject,
  reorderEnabled,
  onReorderChapters,
}: {
  grade: SyllabusTreeData;
  isExpanded: boolean;
  expandedSubjects: Set<string>;
  expandedTopics: Set<string>;
  onToggle: () => void;
  onToggleSubject: (key: string) => void;
  onToggleTopic: (topicId: string) => void;
  onAddTopic?: (gradeId: string, subjectId: string, gradeName: string, subjectName: string) => void;
  onAddMaterial?: (topicId: string, topicName: string, gradeId: string, gradeName: string, subjectId: string, subjectName: string) => void;
  onDeleteGrade?: (gradeId: string) => void;
  onDeleteTopic?: (topicId: string, institutionId: string | null, topicName?: string) => void;
  onDeleteMaterial?: (materialId: string, materialTitle?: string) => void;
  onEditSubject?: (args: {
    subjectId: string;
    subjectName: string;
    category: string | null;
    institutionId: string | null;
    classId: string;
    className: string;
  }) => void;
  onDeleteSubject?: (args: {
    subjectId: string;
    subjectName: string;
    institutionId: string | null;
    classId: string;
    className: string;
  }) => void;
  onManageSegments?: (args: {
    classId: string;
    subjectId: string;
    subjectName: string;
    className: string;
  }) => void;
  isSelectionMode?: boolean;
  selectedTopics?: Set<string>;
  onToggleTopicSelection?: (topicId: string) => void;
  onSelectAllTopicsInSubject?: (topics: { id: string }[]) => void;
  onDeselectAllTopicsInSubject?: (topics: { id: string }[]) => void;
  reorderEnabled?: boolean;
  onReorderChapters?: (subjectId: string, orderedTopicIds: string[]) => void;
}, ref: ForwardedRef<HTMLDivElement>) {
  const subjectCount = grade.subjects.length;
  const topicCount = grade.subjects.reduce((acc, s) => acc + s.topics.length, 0);

  // Sensors for drag-to-reorder. PointerSensor mirrors the panel view's
  // 3-second press-and-hold gate (tolerance 8px), so an accidental tap never
  // starts a drag; KeyboardSensor enables accessible reordering.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 2000, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="rounded-xl border bg-card overflow-hidden"
      // Drop targets — the page-level drag handler walks up from e.target
      // via closest('[data-drop-class-id]') etc. to pre-fill the Add Study
      // Material dialog with the class/subject/chapter the user dropped on.
      data-drop-class-id={grade.id}
      data-drop-class-name={grade.grade_name}
    >
      {/* Grade header */}
      <div
        className="group flex items-center gap-3 p-3 cursor-pointer hover:bg-brand-primary/[0.04] transition-colors"
        onClick={onToggle}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <GraduationCap className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">{grade.grade_name}</span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground">
            <span>{subjectCount} subjects</span>
            <span>•</span>
            <span>{topicCount} topics</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onDeleteGrade && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 transition-opacity text-muted-foreground hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm("Delete this grade and all its contents?")) {
                  onDeleteGrade(grade.id);
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          {isExpanded ? (
            <ChevronDown className="h-5 w-5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Subjects */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t"
          >
            <div className="pl-2 py-2 space-y-1 sm:pl-6">
              {grade.subjects.length === 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  No subjects assigned to this grade
                </div>
              ) : (
                grade.subjects.map((subject) => {
                  const subjectKey = `${grade.id}-${subject.id}`;
                  const SubjectIcon = getSubjectIcon(subject.name);
                  const subjectToneKey = getSubjectTone(subject.name);
                  const subjectTone = TONES[subjectToneKey];
                  const isSubjectExpanded = expandedSubjects.has(subjectKey);

                  return (
                    <div
                      key={subject.id}
                      className="rounded-lg border bg-background overflow-hidden"
                      data-drop-subject-id={subject.id}
                      data-drop-subject-name={subject.name}
                    >
                      {/* Subject header (Naman, 2026-10-07: "the placing is not
                          perfect, make it a little distinguishable"): a tone
                          disc per subject family, the name / code / source as one
                          aligned cluster, the topic count as a pill on the right,
                          a soft teal hover instead of the orange block, and the
                          actions always reachable on a touch screen (they only
                          hide until hover from md up). */}
                      <div
                        className={cn(
                          "group relative flex items-center gap-3 py-2.5 pl-4 pr-3 cursor-pointer transition-colors hover:bg-brand-primary/[0.04]",
                          isSubjectExpanded && "bg-brand-primary/[0.04]",
                        )}
                        onClick={() => onToggleSubject(subjectKey)}
                      >
                        {/* The family's colour as a bar on the left edge: the one
                            thing that tells ten subject rows apart at a glance. */}
                        <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-1", TONE_BAR[subjectToneKey])} />
                        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", subjectTone.bg, subjectTone.fg)}>
                          <SubjectIcon className="h-4 w-4" />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="truncate text-sm font-medium text-ink-900">{subject.name}</span>
                          {subject.code && (
                            <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-ink-500">{subject.code}</span>
                          )}
                          <SourceBadge 
                            source={subject.institution_id === null || subject.institution_id === undefined ? "global" : "institute"} 
                            size="sm" 
                            showIcon={false}
                          />
                        </div>
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-ink-600">
                          {subject.topics.length} {subject.topics.length === 1 ? "topic" : "topics"}
                        </span>
                        <div className="flex items-center gap-1">
                          {/* Select All checkbox for this subject */}
                          {isSelectionMode && subject.topics.length > 0 && onSelectAllTopicsInSubject && onDeselectAllTopicsInSubject && (
                            <div onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={subject.topics.every(t => selectedTopics?.has(t.id))}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    onSelectAllTopicsInSubject(subject.topics);
                                  } else {
                                    onDeselectAllTopicsInSubject(subject.topics);
                                  }
                                }}
                                className="h-4 w-4"
                              />
                            </div>
                          )}
                          {/* One always-visible menu instead of four buttons that
                              only appeared on hover: no reserved blank width before
                              the chevron, and reachable on a touch screen. */}
                          {!isSelectionMode &&
                            (onAddTopic || (onEditSubject && subject.institution_id != null) || onDeleteSubject || onManageSegments) && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-ink-500 hover:text-ink-900"
                                    aria-label={`Actions for ${subject.name}`}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                {/* Portal events still bubble through React to the
                                    row, which would toggle it: stop them here. */}
                                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                  {onAddTopic && (
                                    <DropdownMenuItem onClick={() => onAddTopic(grade.id, subject.id, grade.grade_name, subject.name)}>
                                      <Plus className="mr-2 h-4 w-4" />
                                      Add chapter
                                    </DropdownMenuItem>
                                  )}
                                  {onEditSubject && subject.institution_id != null && (
                                    <DropdownMenuItem
                                      onClick={() =>
                                        onEditSubject({
                                          subjectId: subject.id,
                                          subjectName: subject.name,
                                          category: subject.category ?? null,
                                          institutionId: subject.institution_id ?? null,
                                          classId: grade.id,
                                          className: grade.grade_name,
                                        })
                                      }
                                    >
                                      <Pencil className="mr-2 h-4 w-4" />
                                      Edit subject
                                    </DropdownMenuItem>
                                  )}
                                  {onManageSegments && (
                                    <DropdownMenuItem
                                      onClick={() =>
                                        onManageSegments({
                                          classId: grade.id,
                                          subjectId: subject.id,
                                          subjectName: subject.name,
                                          className: grade.grade_name,
                                        })
                                      }
                                    >
                                      <Layers className="mr-2 h-4 w-4" />
                                      Manage parts
                                    </DropdownMenuItem>
                                  )}
                                  {onDeleteSubject && (
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      onClick={() =>
                                        onDeleteSubject({
                                          subjectId: subject.id,
                                          subjectName: subject.name,
                                          institutionId: subject.institution_id ?? null,
                                          classId: grade.id,
                                          className: grade.grade_name,
                                        })
                                      }
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" />
                                      {subject.institution_id == null ? "Remove from class" : "Delete subject"}
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          {isSubjectExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </div>

                      {/* Topics */}
                      <AnimatePresence>
                        {isSubjectExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="border-t bg-muted/20"
                          >
                            <div className="pl-2 py-1.5 space-y-1 sm:pl-6">
                              {subject.topics.length === 0 ? (
                                <div className="py-3 text-center text-xs text-muted-foreground">
                                  No topics yet
                                </div>
                              ) : (() => {
                                  // Hidden rows never render (parent already filters
                                  // them, but keep the guard for safety). The visible
                                  // set drives both the rows and the SortableContext
                                  // items, keeping drag indices consistent.
                                  const visibleTopics = subject.topics.filter(
                                    (t) => !t.hidden_in_institution,
                                  );
                                  const visibleTopicIds = visibleTopics.map((t) => t.id);

                                  const rows = visibleTopics.map((topic) => (
                                    <TreeChapterRow
                                      key={topic.id}
                                      topic={topic}
                                      gradeId={grade.id}
                                      gradeName={grade.grade_name}
                                      subjectId={subject.id}
                                      subjectName={subject.name}
                                      isSelectionMode={!!isSelectionMode}
                                      isSelected={selectedTopics?.has(topic.id) || false}
                                      isTopicExpanded={expandedTopics.has(topic.id)}
                                      sortable={!!reorderEnabled}
                                      onToggleTopic={onToggleTopic}
                                      onToggleTopicSelection={onToggleTopicSelection}
                                      onAddMaterial={onAddMaterial}
                                      onDeleteTopic={onDeleteTopic}
                                      onDeleteMaterial={onDeleteMaterial}
                                    />
                                  ));

                                  // Only wrap in DnD machinery when reordering is
                                  // active — otherwise render plain rows (identical
                                  // to the pre-feature behavior).
                                  if (!reorderEnabled || !onReorderChapters) return rows;

                                  return (
                                    <DndContext
                                      sensors={sensors}
                                      onDragEnd={(e: DragEndEvent) => {
                                        const { active, over } = e;
                                        if (!over || active.id === over.id) return;
                                        const oldI = visibleTopicIds.indexOf(String(active.id));
                                        const newI = visibleTopicIds.indexOf(String(over.id));
                                        if (oldI < 0 || newI < 0) return;
                                        onReorderChapters(
                                          subject.id,
                                          arrayMove(visibleTopicIds, oldI, newI),
                                        );
                                      }}
                                    >
                                      <SortableContext
                                        items={visibleTopicIds}
                                        strategy={verticalListSortingStrategy}
                                      >
                                        {rows}
                                      </SortableContext>
                                    </DndContext>
                                  );
                                })()}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

// One chapter (topic) row in the tree. Extracted from GradeNode so it can host
// the drag-sortable hook. ALL existing behavior is preserved verbatim — the
// selection checkbox / Layers icon, expand-materials accordion, add-material,
// delete, the data-drop-* attrs (the page-level file-drop relies on them), and
// the materials list with open-link behavior.
//
// Hooks can't be conditional, so useSortable is ALWAYS called. Outside a
// SortableContext it returns no-op defaults (identity transform, null refs),
// which is harmless. We only attach the drag handle + listeners + transform
// style when `sortable` is true; otherwise the row renders exactly as before
// (the leading Layers icon, no transform). When sortable, the leading Layers
// icon is replaced by the 3s-hold ChapterReorderHandle (selection mode and
// sortable are mutually exclusive via reorderEnabled in the parent).
function TreeChapterRow({
  topic,
  gradeId,
  gradeName,
  subjectId,
  subjectName,
  isSelectionMode,
  isSelected,
  isTopicExpanded,
  sortable,
  onToggleTopic,
  onToggleTopicSelection,
  onAddMaterial,
  onDeleteTopic,
  onDeleteMaterial,
}: {
  topic: SyllabusTreeTopic;
  gradeId: string;
  gradeName: string;
  subjectId: string;
  subjectName: string;
  isSelectionMode: boolean;
  isSelected: boolean;
  isTopicExpanded: boolean;
  sortable: boolean;
  onToggleTopic: (topicId: string) => void;
  onToggleTopicSelection?: (topicId: string) => void;
  onAddMaterial?: (topicId: string, topicName: string, gradeId: string, gradeName: string, subjectId: string, subjectName: string) => void;
  onDeleteTopic?: (topicId: string, institutionId: string | null, topicName?: string) => void;
  onDeleteMaterial?: (materialId: string, materialTitle?: string) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: topic.id });

  const dragStyle: React.CSSProperties = sortable
    ? {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }
    : {};

  return (
    <div
      ref={sortable ? setNodeRef : undefined}
      style={dragStyle}
      className={cn(
        "rounded-md border bg-background overflow-hidden",
        isSelectionMode && isSelected && "ring-2 ring-primary"
      )}
      data-drop-topic-id={topic.id}
      data-drop-topic-name={topic.topic_name}
    >
      {/* Topic header */}
      <div
        className="group flex items-center gap-2 p-2 cursor-pointer hover:bg-brand-primary/[0.04] transition-colors"
        onClick={() => {
          if (isSelectionMode && onToggleTopicSelection) {
            if (topic.institution_id !== null) onToggleTopicSelection(topic.id);
          } else {
            onToggleTopic(topic.id);
          }
        }}
      >
        {/* Leading slot: selection checkbox, drag handle, or Layers icon */}
        {isSelectionMode && onToggleTopicSelection ? (
          <div onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleTopicSelection(topic.id)}
              className="h-4 w-4"
            />
          </div>
        ) : sortable ? (
          <div onClick={(e) => e.stopPropagation()}>
            <ChapterReorderHandle
              chapterName={topic.topic_name}
              attributes={attributes}
              listeners={listeners}
              setActivatorNodeRef={setActivatorNodeRef}
            />
          </div>
        ) : (
          <Layers className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <span className="text-sm text-foreground">{topic.topic_name}</span>
          {topic.topic_name_hindi && (
            <span className="ml-2 text-xs text-muted-foreground hindi-text">
              {topic.topic_name_hindi}
            </span>
          )}
          <span className="ml-2 text-xs text-muted-foreground">
            ({topic.materials.length} materials)
          </span>
        </div>
        <div className="flex items-center gap-1">
          {!isSelectionMode && onAddMaterial && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                onAddMaterial(topic.id, topic.topic_name, gradeId, gradeName, subjectId, subjectName);
              }}
            >
              <Plus className="h-3 w-3" />
            </Button>
          )}
          {!isSelectionMode && onDeleteTopic && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              title="Delete this chapter"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm("Delete this chapter?")) {
                  onDeleteTopic(topic.id, topic.institution_id, topic.topic_name);
                }
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
          {!isSelectionMode && topic.materials.length > 0 && (
            isTopicExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )
          )}
        </div>
      </div>

      {/* Materials */}
      <AnimatePresence>
        {isTopicExpanded && topic.materials.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t bg-muted/10"
          >
            <div className="pl-2 py-1 space-y-0.5 sm:pl-6">
              {topic.materials.map((material) => {
                const materialUrl = material.file_url || material.external_link;
                const handleOpenMaterial = () => {
                  if (materialUrl) {
                    openExternal(materialUrl);
                  }
                };
                return (
                  <div
                    key={material.id}
                    role={materialUrl ? "button" : undefined}
                    tabIndex={materialUrl ? 0 : undefined}
                    onClick={materialUrl ? handleOpenMaterial : undefined}
                    onKeyDown={
                      materialUrl
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleOpenMaterial();
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      "group flex items-center gap-2 p-1.5 rounded transition-colors",
                      materialUrl
                        ? "cursor-pointer hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        : "hover:bg-brand-primary/[0.04]",
                    )}
                    title={materialUrl ? "Open material" : undefined}
                  >
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-foreground flex-1 truncate group-hover:text-primary">
                      {material.title}
                    </span>
                    <Badge variant="outline" className="text-[10px] h-4">
                      {material.material_type}
                    </Badge>
                    {materialUrl && (
                      <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 opacity-60 group-hover:opacity-100 group-hover:text-primary" />
                    )}
                    {onDeleteMaterial && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm("Delete this material?")) {
                            onDeleteMaterial(material.id, material.title);
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
