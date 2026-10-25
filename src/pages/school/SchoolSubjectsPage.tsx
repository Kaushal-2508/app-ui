import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GradientKPICard } from "@/components/ui/gradient-kpi-card";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Label } from "@/components/ui/label";
import { Search, BookOpen, Library, GraduationCap, Plus, Upload, Trash2, Link2 } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { useUserRole } from "@/hooks/useUserRole";
import { AssignSubjectToClassDialog } from "@/components/school/AssignSubjectToClassDialog";
import { formatNumber } from "@/lib/formatNumber";

interface Subject {
  id: string;
  name: string;
  code: string;
  category: string;
  name_hindi: string | null;
}

interface GradeLevel {
  id: string;
  grade_name: string;
  grade_number: number;
}

export default function SchoolSubjectsPage() {
  const queryClient = useQueryClient();
  const { data: userRoleInfo } = useUserRole();
  const institutionId = userRoleInfo?.institutionId;
  
  const [search, setSearch] = useState("");
  const [gradeFilter, setGradeFilter] = useState<string>("all");
  const [isSubjectDialogOpen, setIsSubjectDialogOpen] = useState(false);
  const [isTopicDialogOpen, setIsTopicDialogOpen] = useState(false);
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [subjectForm, setSubjectForm] = useState({ name: "", code: "", category: "core", name_hindi: "" });
  const [topicForm, setTopicForm] = useState({
    grade_level_id: "",
    subject_id: "",
    topic_name: "",
    topic_name_hindi: "",
    difficulty_level: "medium",
  });

  // Fetch universal subjects (fixed: was querying wrong table)
  const { data: subjects, isLoading } = useQuery({
    queryKey: ["universal-subjects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("universal_subjects")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as Subject[];
    },
  });

  // Fetch grade levels
  const { data: gradeLevels } = useQuery({
    queryKey: ["grade-levels"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grade_levels")
        .select("*")
        .eq("is_active", true)
        .order("grade_number");
      if (error) throw error;
      return data as GradeLevel[];
    },
  });

  // Fetch topic counts per subject
  const { data: topicCounts } = useQuery({
    queryKey: ["topic-counts-by-subject", gradeFilter],
    queryFn: async () => {
      let query = supabase.from("syllabus_topics").select("subject_id");
      if (gradeFilter !== "all") {
        query = query.eq("grade_level_id", gradeFilter);
      }
      const { data, error } = await query;
      if (error) throw error;

      const counts: Record<string, number> = {};
      data?.forEach((topic) => {
        counts[topic.subject_id] = (counts[topic.subject_id] || 0) + 1;
      });
      return counts;
    },
  });

  // Add subject mutation
  const addSubjectMutation = useMutation({
    mutationFn: async (data: typeof subjectForm) => {
      const { error } = await supabase
        .from("universal_subjects")
        .insert([data])
        .select("id")
        .maybeSingle();
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["universal-subjects"] });
      setIsSubjectDialogOpen(false);
      setSubjectForm({ name: "", code: "", category: "core", name_hindi: "" });
      toast.success("Subject added successfully");
    },
    onError: (error: Error) => toast.error("Failed to add subject: " + error.message),
  });

  // Add topic mutation
  const addTopicMutation = useMutation({
    mutationFn: async (data: typeof topicForm) => {
      const { error } = await supabase
        .from("syllabus_topics")
        .insert([data])
        .select("id")
        .maybeSingle();
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["topic-counts-by-subject"] });
      setIsTopicDialogOpen(false);
      setTopicForm({ grade_level_id: "", subject_id: "", topic_name: "", topic_name_hindi: "", difficulty_level: "medium" });
      toast.success("Chapter added successfully");
    },
    onError: (error: Error) => toast.error("Failed to add chapter: " + error.message),
  });

  // Delete subject mutation
  const deleteSubjectMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("universal_subjects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["universal-subjects"] });
      toast.success("Subject deleted");
    },
    onError: (error: Error) => toast.error("Failed to delete: " + error.message),
  });

  // Import syllabus handler
  const handleImport = async () => {
    setIsImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("import-syllabus");
      if (error) throw error;
      toast.success(`Import completed: ${data.inserted} topics added, ${data.skipped} duplicates skipped`);
      queryClient.invalidateQueries({ queryKey: ["topic-counts-by-subject"] });
    } catch (error) {
      toastError(error, { fallback: "Couldn't import the syllabus.", context: "importSyllabus" });
    } finally {
      setIsImporting(false);
    }
  };

  const filteredSubjects = subjects?.filter((subject) =>
    subject.name.toLowerCase().includes(search.toLowerCase()) ||
    subject.code.toLowerCase().includes(search.toLowerCase())
  );

  const totalTopics = Object.values(topicCounts || {}).reduce((sum, count) => sum + count, 0);

  if (isLoading) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-emerald-400 to-green-500 text-white shadow-sm">
              <BookOpen className="h-4 w-4" />
            </div>
            Subjects & Syllabus
          </h1>
          <p className="text-muted-foreground">Manage universal subjects and syllabus topics</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {institutionId && (
            <Button variant="outline" onClick={() => setIsAssignDialogOpen(true)}>
              <Link2 className="h-4 w-4 mr-2" />
              Assign to Class
            </Button>
          )}
          
          <Button variant="outline" onClick={handleImport} disabled={isImporting}>
            <Upload className="h-4 w-4 mr-2" />
            {isImporting ? "Importing..." : "Import Topics"}
          </Button>

          <Dialog open={isSubjectDialogOpen} onOpenChange={setIsSubjectDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                Add Subject
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Subject</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Subject Name</Label>
                  <Input
                    value={subjectForm.name}
                    onChange={(e) => setSubjectForm({ ...subjectForm, name: e.target.value })}
                    placeholder="e.g., Mathematics"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Subject Code</Label>
                  <Input
                    value={subjectForm.code}
                    onChange={(e) => setSubjectForm({ ...subjectForm, code: e.target.value })}
                    placeholder="e.g., MATH"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <SearchableSelect
                    value={subjectForm.category}
                    onValueChange={(v) => setSubjectForm({ ...subjectForm, category: v })}
                    placeholder="Select category"
                    searchPlaceholder="Search..."
                    options={[
                      { value: "language", label: "Language" },
                      { value: "core", label: "Core" },
                      { value: "elective", label: "Elective" },
                      { value: "vocational", label: "Vocational" },
                    ]}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Name (Hindi)</Label>
                  <Input
                    value={subjectForm.name_hindi}
                    onChange={(e) => setSubjectForm({ ...subjectForm, name_hindi: e.target.value })}
                    placeholder="e.g., गणित"
                  />
                </div>
                <Button
                  onClick={() => addSubjectMutation.mutate(subjectForm)}
                  disabled={!subjectForm.name || !subjectForm.code || addSubjectMutation.isPending}
                  className="w-full"
                >
                  {addSubjectMutation.isPending ? "Adding..." : "Add Subject"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={isTopicDialogOpen} onOpenChange={setIsTopicDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Chapter
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Chapter</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Grade Level</Label>
                  <SearchableSelect
                    value={topicForm.grade_level_id}
                    onValueChange={(v) => setTopicForm({ ...topicForm, grade_level_id: v })}
                    placeholder="Select grade"
                    searchPlaceholder="Search grades..."
                    options={gradeLevels?.map((g) => ({
                      value: g.id,
                      label: g.grade_name,
                    })) || []}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Subject</Label>
                  <SearchableSelect
                    value={topicForm.subject_id}
                    onValueChange={(v) => setTopicForm({ ...topicForm, subject_id: v })}
                    placeholder="Select subject"
                    searchPlaceholder="Search subjects..."
                    options={subjects?.map((s) => ({
                      value: s.id,
                      label: s.name,
                    })) || []}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Chapter Name (English)</Label>
                  <Input
                    value={topicForm.topic_name}
                    onChange={(e) => setTopicForm({ ...topicForm, topic_name: e.target.value })}
                    placeholder="e.g., Algebraic Expressions"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Chapter Name (Hindi)</Label>
                  <Input
                    value={topicForm.topic_name_hindi}
                    onChange={(e) => setTopicForm({ ...topicForm, topic_name_hindi: e.target.value })}
                    placeholder="e.g., बीजीय व्यंजक"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Difficulty Level</Label>
                  <SearchableSelect
                    value={topicForm.difficulty_level}
                    onValueChange={(v) => setTopicForm({ ...topicForm, difficulty_level: v })}
                    placeholder="Select difficulty"
                    searchPlaceholder="Search..."
                    options={[
                      { value: "easy", label: "Easy" },
                      { value: "medium", label: "Medium" },
                      { value: "hard", label: "Hard" },
                    ]}
                  />
                </div>
                <Button
                  onClick={() => addTopicMutation.mutate(topicForm)}
                  disabled={!topicForm.grade_level_id || !topicForm.subject_id || !topicForm.topic_name || addTopicMutation.isPending}
                  className="w-full"
                >
                  {addTopicMutation.isPending ? "Adding..." : "Add Chapter"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search subjects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <SearchableSelect
          value={gradeFilter}
          onValueChange={setGradeFilter}
          placeholder="Filter by grade"
          searchPlaceholder="Search grades..."
          className="w-full sm:w-48"
          options={[
            { value: "all", label: "All Grades" },
            ...(gradeLevels?.map((g) => ({
              value: g.id,
              label: g.grade_name,
            })) || []),
          ]}
        />
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <GradientKPICard icon={BookOpen} value={formatNumber(subjects?.length || 0)} label="Total Subjects" variant="emerald" />
        <GradientKPICard icon={Library} value={formatNumber(totalTopics)} label="Total Topics" variant="blue" />
        <GradientKPICard icon={GraduationCap} value={formatNumber(gradeLevels?.length || 0)} label="Grade Levels" variant="purple" />
        <GradientKPICard icon={BookOpen} value={subjects?.length ? (totalTopics / subjects.length).toFixed(1) : "0"} label="Avg Topics/Subject" variant="amber" />
      </div>

      <DashboardSection
        title="Subjects"
        icon={BookOpen}
        iconGradient="from-emerald-400 to-green-500"
        contentClassName="p-0"
      >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Hindi Name</TableHead>
                <TableHead>Chapters</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSubjects?.map((subject) => (
                <TableRow key={subject.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <BookOpen className="h-4 w-4" />
                      </div>
                      <p className="font-medium">{subject.name}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="text-sm bg-muted px-2 py-1 rounded">{subject.code}</code>
                  </TableCell>
                  <TableCell className="capitalize">{subject.category}</TableCell>
                  <TableCell>
                    <span className="text-muted-foreground text-sm max-w-xs truncate block">
                      {subject.name_hindi || "-"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-muted-foreground">{topicCounts?.[subject.id] || 0} topics</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (confirm("Delete this subject?")) deleteSubjectMutation.mutate(subject.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filteredSubjects?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No subjects found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
        </Table>
      </DashboardSection>

      {/* Assign Subject to Class Dialog */}
      {institutionId && (
        <AssignSubjectToClassDialog
          open={isAssignDialogOpen}
          onOpenChange={setIsAssignDialogOpen}
          institutionId={institutionId}
        />
      )}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-64 mt-2" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
