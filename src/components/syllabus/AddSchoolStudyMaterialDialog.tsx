import { useState, useEffect, useMemo, useRef } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  FileText,
  GraduationCap,
  BookOpen,
  Layers,
  Building2,
  Loader2,
  Upload,
  X,
  Plus,
  Video,
  Link as LinkIcon,
  File,
  Image,
  Headphones,
  Info,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { uploadResumable } from "@/lib/storageUpload";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { useAuth } from "@/contexts/AuthContext";
import { formatClassName } from "@/lib/utils";
import { invalidateSyllabusCache } from "@/lib/queryKeys";
import { sortClassRows } from "@/lib/classSort";
import { extractGradeNumberFromClassName } from "@/lib/gradeLookup";

interface AddSchoolStudyMaterialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string;
  teacherUserId?: string | null;
  /** When the dialog is opened with a pre-loaded file (e.g. via the syllabus
   * page's drag-and-drop), seed `selectedFile`, derive the material type from
   * the extension, and pre-fill the title from the filename. The user only
   * needs to pick class → subject → chapter and confirm. */
  initialFile?: File | null;
  onInitialFileConsumed?: () => void;
  /** Pre-fill class / subject / chapter when the drop happened on top of a
   * specific tree row. Each level is optional — if the user dropped on a
   * subject row we pre-fill class+subject and leave chapter for them to pick.
   * The subject and chapter are applied once the class's subjects load. */
  initialContext?: {
    classId?: string | null;
    subjectId?: string | null;
    topicId?: string | null;
  } | null;
  onInitialContextConsumed?: () => void;
}

type ClassRow = {
  id: string;
  name: string;
  section: string | null;
  academic_year: string | null;
  class_group_id: string | null;
};

type SubjectRow = { id: string; name: string; code: string | null };

type TopicRow = {
  id: string;
  topic_name: string;
  topic_name_hindi: string | null;
  institution_id: string | null;
};

/**
 * One chapter picker, and one study_materials row once saved.
 *
 * study_materials has no class column: a row belongs to a chapter, and a
 * chapter belongs to a subject + grade. Sections of one class share their
 * subjects (subject_class_group_mappings fans out to every section), so they
 * land on the same target and share one copy, exactly as a single-section
 * upload always has. Different classes have different subjects and chapters,
 * so each becomes its own target with its own row and its own file, and
 * deleting one never touches another.
 */
interface ChapterTarget {
  key: string;
  subjectId: string;
  gradeNumber: number | null;
  gradeLevelId: string | null;
  classes: ClassRow[];
}

interface MaterialRowPlan {
  topicId: string;
  subjectId: string;
  gradeLevelId: string | null;
}

/** Map a filename's extension to a MATERIAL_TYPES `value`. Returns empty
 * string when the extension isn't recognised — the user is still allowed to
 * pick a type manually. */
function detectMaterialType(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (["doc", "docx", "odt", "rtf", "txt"].includes(ext)) return "document";
  if (["ppt", "pptx", "odp"].includes(ext)) return "presentation";
  if (["xls", "xlsx", "xlsm", "xlsb", "csv", "tsv", "ods"].includes(ext))
    return "spreadsheet";
  if (["mp4", "mov", "avi", "mkv", "webm", "m4v", "wmv"].includes(ext))
    return "video";
  if (["mp3", "wav", "m4a", "ogg", "flac", "aac"].includes(ext)) return "audio";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "heif"].includes(ext))
    return "image";
  return "";
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return fileName;
  return fileName.slice(0, dot);
}

const MATERIAL_TYPES = [
  { value: "pdf", label: "PDF Document", icon: FileText },
  { value: "document", label: "Word/Doc", icon: File },
  { value: "presentation", label: "PowerPoint", icon: File },
  { value: "spreadsheet", label: "Excel", icon: File },
  { value: "video", label: "Video", icon: Video },
  { value: "audio", label: "Audio", icon: Headphones },
  { value: "image", label: "Image", icon: Image },
  { value: "link", label: "External Link", icon: LinkIcon },
];

const ACCEPTED_FILE_TYPES =
  ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,video/*,audio/*,image/*";

const STUDY_MATERIALS_BUCKET = "study-materials";

const EMPTY_CLASSES: ClassRow[] = [];

/** Subjects are separate rows per class, so "English" in Class 1 and
 * "English" in Class 2 are matched by name. */
function subjectKeyOf(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function targetKeyOf(subjectId: string, gradeNumber: number | null): string {
  return `${subjectId}|${gradeNumber ?? "none"}`;
}

/** Sections of one class share a class_group; the name is a fallback for a
 * row cached before class_group_id was selected. */
function classGroupKeyOf(c: ClassRow): string {
  return c.class_group_id ?? `name:${c.name.trim().toLowerCase()}`;
}

function classLabel(c: ClassRow): string {
  return formatClassName(c.name, c.section);
}

function joinClassLabels(classes: ClassRow[]): string {
  return classes.map(classLabel).join(", ");
}

/** The subjects a class offers, narrowed for a teacher to the ones they are
 * assigned in that class (all of them when the assignment carries no subject,
 * as before). */
async function fetchClassSubjects(
  classId: string,
  teacherUserId: string | null,
): Promise<SubjectRow[]> {
  let teacherSubjectIds: string[] | null = null;
  if (teacherUserId) {
    const { data: assignments, error: assignmentError } = await supabase
      .from("class_assignments")
      .select("subject_id")
      .eq("user_id", teacherUserId)
      .eq("class_id", classId)
      .eq("role", "teacher")
      .range(0, 499);
    if (assignmentError) throw assignmentError;
    teacherSubjectIds = (assignments ?? [])
      .map((a) => a.subject_id)
      .filter((id): id is string => !!id);
  }

  // subject_class_mappings.subject_id points at universal_subjects, which
  // holds institution-scoped subjects too, so one join covers them all.
  const { data: mappings, error } = await supabase
    .from("subject_class_mappings")
    .select("subject_id, universal_subjects(id, name, code)")
    .eq("class_id", classId)
    .range(0, 499);
  if (error) throw error;

  type UniversalMapping = { universal_subjects: SubjectRow | SubjectRow[] | null };
  const seen = new Set<string>();
  const subjects: SubjectRow[] = [];
  for (const m of (mappings ?? []) as UniversalMapping[]) {
    // PostgREST joins return T | T[] depending on the relationship.
    const s = Array.isArray(m.universal_subjects)
      ? m.universal_subjects[0] ?? null
      : m.universal_subjects;
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    subjects.push({ id: s.id, name: s.name, code: s.code });
  }

  if (teacherSubjectIds && teacherSubjectIds.length > 0) {
    const allowed = new Set(teacherSubjectIds);
    return subjects.filter((s) => allowed.has(s.id));
  }
  return subjects;
}

async function fetchChapters(
  subjectId: string,
  gradeLevelId: string,
  institutionId: string,
): Promise<TopicRow[]> {
  const { data, error } = await supabase
    .from("syllabus_topics")
    .select("id, topic_name, topic_name_hindi, institution_id")
    .eq("grade_level_id", gradeLevelId)
    .eq("subject_id", subjectId)
    .eq("is_active", true)
    .or(`institution_id.eq.${institutionId},institution_id.is.null`)
    .order("display_order")
    .order("id")
    .range(0, 999);
  if (error) throw error;
  return data ?? [];
}

export function AddSchoolStudyMaterialDialog({
  open,
  onOpenChange,
  institutionId,
  teacherUserId,
  initialFile,
  onInitialFileConsumed,
  initialContext,
  onInitialContextConsumed,
}: AddSchoolStudyMaterialDialogProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state - hierarchy. The subject is held as a name key so it can
  // match across classes; chapters are held per target.
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [subjectKey, setSubjectKey] = useState("");
  const [topicByTarget, setTopicByTarget] = useState<Record<string, string>>({});

  // New chapter creation, for one target at a time
  const [creatingTarget, setCreatingTarget] = useState<string | null>(null);
  const [newTopicName, setNewTopicName] = useState("");
  const [newTopicNameHindi, setNewTopicNameHindi] = useState("");

  // Material form
  const [title, setTitle] = useState("");
  const [materialType, setMaterialType] = useState("");
  const [publisher, setPublisher] = useState("");
  const [externalLink, setExternalLink] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Single-flight guard: state updates land a render late, a ref does not.
  const submittingRef = useRef(false);

  // Subject + chapter from a drop, applied once that class's subjects load.
  const [pendingSeed, setPendingSeed] = useState<{
    classId: string;
    subjectId: string;
    topicId: string | null;
  } | null>(null);

  // Page-level drag-and-drop hands a file in via `initialFile`. Seed file +
  // type + title once per open so the user only has to pick class/subject/
  // topic. A ref guards against re-runs on unrelated re-renders.
  const lastConsumedFileRef = useRef<File | null>(null);
  useEffect(() => {
    if (!open) {
      lastConsumedFileRef.current = null;
      return;
    }
    if (initialFile && lastConsumedFileRef.current !== initialFile) {
      lastConsumedFileRef.current = initialFile;
      if (initialFile.size > 50 * 1024 * 1024) {
        toast.error("File size must be less than 50MB");
        return;
      }
      setSelectedFile(initialFile);
      setExternalLink("");
      const detected = detectMaterialType(initialFile.name);
      if (detected) setMaterialType(detected);
      const seedTitle = stripExtension(initialFile.name).trim();
      if (seedTitle) setTitle((current) => current || seedTitle);
      onInitialFileConsumed?.();
    }
  }, [open, initialFile, onInitialFileConsumed]);

  // Pre-fill the class when the drop happened on top of a specific tree row;
  // the subject and chapter follow in the seed effect below. Once the dialog
  // closes we clear the consumed-ref so a future re-open with new context
  // still works.
  const lastConsumedContextRef = useRef<typeof initialContext>(null);
  useEffect(() => {
    if (!open) {
      lastConsumedContextRef.current = null;
      return;
    }
    if (initialContext && lastConsumedContextRef.current !== initialContext) {
      lastConsumedContextRef.current = initialContext;
      const { classId, subjectId, topicId } = initialContext;
      if (classId) {
        setSelectedClassIds([classId]);
        setSubjectKey("");
        setTopicByTarget({});
        setPendingSeed(subjectId ? { classId, subjectId, topicId: topicId ?? null } : null);
      }
      onInitialContextConsumed?.();
    }
  }, [open, initialContext, onInitialContextConsumed]);

  // Fetch classes (filtered by teacher assignments if teacherUserId is set)
  const classesQuery = useQuery({
    queryKey: ["institution-classes-materials-v2", institutionId, teacherUserId ?? null],
    queryFn: async (): Promise<ClassRow[]> => {
      if (teacherUserId) {
        // For teachers, only show their assigned classes
        const { data: assignments, error } = await supabase
          .from("class_assignments")
          .select(
            "class_id, classes!class_assignments_class_id_fkey(id, name, section, academic_year, is_active, class_group_id)",
          )
          .eq("user_id", teacherUserId)
          .eq("role", "teacher")
          .range(0, 999);

        if (error) throw error;
        type JoinedClass = ClassRow & { is_active: boolean };
        type AssignmentRow = { classes: JoinedClass | JoinedClass[] | null };
        const uniqueClasses = new Map<string, ClassRow>();
        ((assignments ?? []) as AssignmentRow[]).forEach((a) => {
          // PostgREST joins return either an object or an array depending
          // on the relationship type — pick the single related row.
          const cls = Array.isArray(a.classes) ? a.classes[0] : a.classes;
          if (cls?.is_active && !uniqueClasses.has(cls.id)) {
            uniqueClasses.set(cls.id, {
              id: cls.id,
              name: cls.name,
              section: cls.section,
              academic_year: cls.academic_year,
              class_group_id: cls.class_group_id,
            });
          }
        });
        return sortClassRows(
          Array.from(uniqueClasses.values()),
          (c) => c.name,
          (c) => c.section,
        );
      }

      const { data, error } = await supabase
        .from("classes")
        .select("id, name, section, academic_year, class_group_id")
        .eq("institution_id", institutionId)
        .eq("is_active", true)
        .order("name")
        .range(0, 999);

      if (error) throw error;
      return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
    },
    enabled: open && !!institutionId,
    staleTime: 5 * 60_000,
  });
  const classes = classesQuery.data ?? EMPTY_CLASSES;

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  // Selection order, limited to classes this user can actually see.
  const selectedClasses = useMemo(
    () =>
      selectedClassIds.flatMap((id) => {
        const c = classById.get(id);
        return c ? [c] : [];
      }),
    [selectedClassIds, classById],
  );
  const spansSeveralClasses =
    new Set(selectedClasses.map(classGroupKeyOf)).size > 1;

  // Subjects, one cached query per selected class so ticking another section
  // only fetches that section.
  const subjectQueries = useQueries({
    queries: selectedClasses.map((c) => ({
      queryKey: ["class-subjects-for-material", c.id, institutionId, teacherUserId ?? null],
      queryFn: () => fetchClassSubjects(c.id, teacherUserId ?? null),
      enabled: open,
      staleTime: 60_000,
    })),
  });
  const subjectsByClass: Record<string, SubjectRow[] | undefined> = {};
  selectedClasses.forEach((c, i) => {
    subjectsByClass[c.id] = subjectQueries[i]?.data;
  });
  const subjectsLoading = subjectQueries.some((q) => q.isLoading);
  const subjectsError = subjectQueries.find((q) => q.error)?.error ?? null;

  // Only subjects every selected class offers can be picked.
  const subjectOptions: { value: string; label: string; name: string }[] = [];
  if (selectedClasses.length > 0 && !subjectsLoading && !subjectsError) {
    const perClass = selectedClasses.map((c) => {
      const byKey = new Map<string, SubjectRow>();
      for (const s of subjectsByClass[c.id] ?? []) {
        const k = subjectKeyOf(s.name);
        if (!byKey.has(k)) byKey.set(k, s);
      }
      return byKey;
    });
    const [first, ...rest] = perClass;
    for (const [k, s] of first) {
      if (!rest.every((m) => m.has(k))) continue;
      const codes = new Set(perClass.map((m) => m.get(k)?.code ?? null));
      const code = codes.size === 1 ? s.code : null;
      subjectOptions.push({ value: k, label: `${s.name}${code ? ` (${code})` : ""}`, name: s.name });
    }
  }
  const selectedSubject = subjectOptions.find((o) => o.value === subjectKey) ?? null;
  const effectiveSubjectKey = selectedSubject?.value ?? "";

  // Apply a dropped subject + chapter once the class and its subjects are in.
  const seedClass = pendingSeed ? classById.get(pendingSeed.classId) : undefined;
  const seedSubjects = pendingSeed ? subjectsByClass[pendingSeed.classId] : undefined;
  useEffect(() => {
    if (!pendingSeed || !seedClass || !seedSubjects) return;
    setPendingSeed(null);
    const subject = seedSubjects.find((s) => s.id === pendingSeed.subjectId);
    if (!subject) return;
    setSubjectKey(subjectKeyOf(subject.name));
    if (pendingSeed.topicId) {
      const key = targetKeyOf(subject.id, extractGradeNumberFromClassName(seedClass.name));
      setTopicByTarget({ [key]: pendingSeed.topicId });
    }
  }, [pendingSeed, seedClass, seedSubjects]);

  // grade_levels is global; resolve every selected class's grade in one read.
  const gradeNumbers = Array.from(
    new Set(
      selectedClasses
        .map((c) => extractGradeNumberFromClassName(c.name))
        .filter((n): n is number => n !== null),
    ),
  ).sort((a, b) => a - b);
  const gradesQuery = useQuery({
    queryKey: ["grade-level-ids-by-number", gradeNumbers],
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase
        .from("grade_levels")
        .select("id, grade_number")
        .in("grade_number", gradeNumbers)
        .order("id")
        .range(0, 199);
      if (error) throw error;
      // Plain object keyed by the stringified number: the query cache is
      // persisted as JSON, so no Map here.
      const byNumber: Record<string, string> = {};
      for (const g of data ?? []) {
        const k = String(g.grade_number);
        if (!(k in byNumber)) byNumber[k] = g.id;
      }
      return byNumber;
    },
    enabled: open && gradeNumbers.length > 0,
    staleTime: 10 * 60_000,
  });

  // One target per distinct subject + grade.
  const targets: ChapterTarget[] = [];
  if (effectiveSubjectKey) {
    const byKey = new Map<string, ChapterTarget>();
    for (const c of selectedClasses) {
      const subject = (subjectsByClass[c.id] ?? []).find(
        (s) => subjectKeyOf(s.name) === effectiveSubjectKey,
      );
      if (!subject) continue;
      const gradeNumber = extractGradeNumberFromClassName(c.name);
      const key = targetKeyOf(subject.id, gradeNumber);
      const existing = byKey.get(key);
      if (existing) {
        existing.classes.push(c);
        continue;
      }
      byKey.set(key, {
        key,
        subjectId: subject.id,
        gradeNumber,
        gradeLevelId:
          gradeNumber === null ? null : gradesQuery.data?.[String(gradeNumber)] ?? null,
        classes: [c],
      });
    }
    targets.push(...byKey.values());
  }

  const topicQueries = useQueries({
    queries: targets.map((t) => ({
      queryKey: ["class-topics-for-material", t.subjectId, t.gradeLevelId, institutionId],
      queryFn: () => fetchChapters(t.subjectId, t.gradeLevelId ?? "", institutionId),
      enabled: open && !!t.gradeLevelId,
      staleTime: 60_000,
    })),
  });

  /** The chapter picked for a target, only while it is still in that list. */
  const chosenTopicId = (i: number): string => {
    const id = topicByTarget[targets[i].key];
    const list = topicQueries[i]?.data;
    return id && list?.some((t) => t.id === id) ? id : "";
  };
  const chosenTopicName = (i: number): string => {
    const id = chosenTopicId(i);
    return topicQueries[i]?.data?.find((t) => t.id === id)?.topic_name ?? "";
  };
  const allChaptersChosen =
    targets.length > 0 && targets.every((_, i) => chosenTopicId(i) !== "");

  // Create chapter on-the-go, for one target
  const createTopicMutation = useMutation({
    mutationFn: async ({
      target,
      existing,
    }: {
      target: ChapterTarget;
      existing: TopicRow[];
    }) => {
      const name = newTopicName.trim();
      if (!name) throw new Error("Enter a chapter name.");

      // A second click, or a name that is already there, picks the existing
      // chapter instead of adding a duplicate.
      const dup = existing.find((t) => t.topic_name.trim().toLowerCase() === name.toLowerCase());
      if (dup) return { targetKey: target.key, topicId: dup.id, created: false };

      if (!target.gradeLevelId) {
        throw new Error(
          `The grade for ${classLabel(target.classes[0])} isn't set up yet. Ask your admin to add it before creating chapters.`,
        );
      }

      const { data: topic, error } = await supabase
        .from("syllabus_topics")
        .insert({
          grade_level_id: target.gradeLevelId,
          subject_id: target.subjectId,
          topic_name: name,
          topic_name_hindi: newTopicNameHindi.trim() || null,
          institution_id: institutionId,
          is_active: true,
          display_order: 1,
        })
        .select("id")
        .single();

      if (error) throw error;
      return { targetKey: target.key, topicId: topic.id, created: true };
    },
    onSuccess: ({ targetKey, topicId, created }) => {
      queryClient.invalidateQueries({ queryKey: ["class-topics-for-material"] });
      setTopicByTarget((prev) => ({ ...prev, [targetKey]: topicId }));
      setCreatingTarget(null);
      setNewTopicName("");
      setNewTopicNameHindi("");
      toast.success(created ? "Chapter created successfully" : "That chapter already exists, so it's selected");
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't create the chapter.", context: "createMaterialChapter" });
    },
  });

  // Add material: one row per target, written in a single INSERT so they
  // land together or not at all. Each row gets its own file: the first is
  // uploaded, the rest are server-side copies, so no row shares a stored
  // object with another.
  const addMaterialMutation = useMutation({
    mutationFn: async (plan: MaterialRowPlan[]) => {
      const storedPaths: string[] = [];
      try {
        const fileUrls: (string | null)[] = plan.map(() => null);

        if (selectedFile) {
          const fileExt = selectedFile.name.split(".").pop();
          const stamp = Date.now();
          const paths = plan.map(
            (_, i) =>
              `materials/${institutionId}/${stamp}-${i}-${Math.random().toString(36).substring(7)}.${fileExt}`,
          );

          // Resumable (TUS) upload: the standard POST endpoint caps the
          // request body at 50 MB regardless of the bucket's file_size_limit.
          await uploadResumable({
            bucket: STUDY_MATERIALS_BUCKET,
            path: paths[0],
            file: selectedFile,
            contentType: selectedFile.type || undefined,
          });
          storedPaths.push(paths[0]);

          const copies = await Promise.allSettled(
            paths.slice(1).map(async (path) => {
              const { error } = await supabase.storage
                .from(STUDY_MATERIALS_BUCKET)
                .copy(paths[0], path);
              if (error) throw error;
              return path;
            }),
          );
          for (const c of copies) {
            if (c.status === "fulfilled") storedPaths.push(c.value);
          }
          const failed = copies.find((c): c is PromiseRejectedResult => c.status === "rejected");
          if (failed) throw failed.reason;

          paths.forEach((path, i) => {
            fileUrls[i] = supabase.storage.from(STUDY_MATERIALS_BUCKET).getPublicUrl(path).data.publicUrl;
          });
        }

        const rows = plan.map((p, i) => ({
          topic_id: p.topicId,
          grade_level_id: p.gradeLevelId,
          subject_id: p.subjectId,
          institution_id: institutionId,
          title: title.trim(),
          publisher: publisher.trim() || null,
          material_type: materialType,
          file_url: fileUrls[i],
          external_link: externalLink.trim() || null,
          description: description.trim() || null,
          is_active: true,
          created_by: user?.id ?? null,
        }));

        const { data, error } = await supabase
          .from("study_materials")
          .insert(rows)
          .select("id");

        if (error) throw error;
        return data?.length ?? rows.length;
      } catch (err) {
        // No row was written, so the files have no owner: clear them out.
        // Best effort only; the error the user sees is the original one.
        if (storedPaths.length > 0) {
          void supabase.storage.from(STUDY_MATERIALS_BUCKET).remove(storedPaths);
        }
        throw err;
      }
    },
    onSuccess: () => {
      invalidateSyllabusCache(queryClient);
      toast.success(
        selectedClasses.length > 1
          ? `Study material added to ${selectedClasses.length} classes`
          : "Study material added successfully",
      );
      handleClose();
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't add the study material.", context: "addSchoolStudyMaterial" });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 50 * 1024 * 1024) {
        toast.error("File size must be less than 50MB");
        return;
      }
      setSelectedFile(file);
      setExternalLink(""); // Clear link when file is selected
    }
  };

  const busy = isSubmitting || addMaterialMutation.isPending;
  const canSubmit =
    allChaptersChosen &&
    !!title.trim() &&
    !!materialType &&
    (!!selectedFile || !!externalLink.trim()) &&
    !busy;

  const runAdd = async () => {
    if (submittingRef.current || !canSubmit) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    const seen = new Set<string>();
    const plan: MaterialRowPlan[] = [];
    targets.forEach((t, i) => {
      const topicId = chosenTopicId(i);
      if (seen.has(topicId)) return;
      seen.add(topicId);
      plan.push({ topicId, subjectId: t.subjectId, gradeLevelId: t.gradeLevelId });
    });
    try {
      await addMaterialMutation.mutateAsync(plan);
    } catch {
      // Already surfaced by onError.
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    // Different classes get separate copies; say so before writing. Sections
    // of one class share a syllabus, so they go straight through.
    if (spansSeveralClasses) {
      setConfirmOpen(true);
      return;
    }
    void runAdd();
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const resetForm = () => {
    setSelectedClassIds([]);
    setSubjectKey("");
    setTopicByTarget({});
    setPendingSeed(null);
    setCreatingTarget(null);
    setNewTopicName("");
    setNewTopicNameHindi("");
    setTitle("");
    setMaterialType("");
    setPublisher("");
    setExternalLink("");
    setDescription("");
    setSelectedFile(null);
    setConfirmOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const isDirty =
    selectedClassIds.length > 0 ||
    !!title.trim() ||
    !!selectedFile ||
    !!externalLink.trim() ||
    !!description.trim();

  const classOptions = classes.map((c) => ({
    value: c.id,
    label: `${classLabel(c)}${c.academic_year ? ` (${c.academic_year})` : ""}`,
  }));

  const classPlaceholder = classesQuery.isLoading
    ? "Loading..."
    : classes.length === 0
    ? teacherUserId
      ? "No classes assigned to you"
      : "No classes found"
    : "Select one or more classes";

  const subjectPlaceholder =
    selectedClasses.length === 0
      ? "Select a class first"
      : subjectsLoading
      ? "Loading..."
      : subjectOptions.length === 0
      ? selectedClasses.length > 1
        ? "No subject is shared by all the selected classes"
        : "No subjects in this class"
      : "Select a subject";

  const renderChapterField = (target: ChapterTarget, i: number) => {
    const query = topicQueries[i];
    const topics = query?.data ?? [];
    const isCreating = creatingTarget === target.key;

    if (isCreating) {
      return (
        <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">New Chapter</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Cancel new chapter"
              onClick={() => {
                setCreatingTarget(null);
                setNewTopicName("");
                setNewTopicNameHindi("");
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <Input
            placeholder="Chapter name (English) *"
            value={newTopicName}
            onChange={(e) => setNewTopicName(e.target.value)}
          />
          <Input
            placeholder="Chapter name (Hindi)"
            value={newTopicNameHindi}
            onChange={(e) => setNewTopicNameHindi(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            onClick={() => createTopicMutation.mutate({ target, existing: topics })}
            disabled={!newTopicName.trim() || createTopicMutation.isPending}
          >
            {createTopicMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-1" />
            )}
            Create Chapter
          </Button>
        </div>
      );
    }

    if (query?.error) {
      return (
        <p className="text-sm text-destructive">
          Couldn't load chapters. Close this and try again.
        </p>
      );
    }

    const gradeMissing =
      !target.gradeLevelId && (target.gradeNumber === null || !gradesQuery.isLoading);
    if (gradesQuery.error) {
      return (
        <p className="text-sm text-destructive">
          Couldn't load chapters. Close this and try again.
        </p>
      );
    }
    if (gradeMissing) {
      return (
        <p className="text-sm text-muted-foreground">
          The grade for {classLabel(target.classes[0])} isn't set up yet, so it has no chapters.
        </p>
      );
    }

    const loading = gradesQuery.isLoading || !!query?.isLoading;
    return (
      <SearchableSelect
        value={chosenTopicId(i)}
        onValueChange={(value) =>
          setTopicByTarget((prev) => ({ ...prev, [target.key]: value }))
        }
        placeholder={
          loading
            ? "Loading..."
            : topics.length === 0
            ? "No chapters yet, create one"
            : "Select a chapter"
        }
        searchPlaceholder="Search chapters..."
        options={topics.map((t) => ({
          value: t.id,
          label: t.topic_name,
        }))}
        disabled={loading || topics.length === 0}
      />
    );
  };

  const newChapterButton = (target: ChapterTarget) =>
    creatingTarget === target.key ? null : (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setCreatingTarget(target.key);
          setNewTopicName("");
          setNewTopicNameHindi("");
        }}
        className="text-xs shrink-0"
      >
        <Plus className="h-3 w-3 mr-1" />
        Create New Chapter
      </Button>
    );

  const singleTopicName = targets.length === 1 ? chosenTopicName(0) : "";

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Add Study Material
            </DialogTitle>
            <DialogDescription>
              Upload a file or add a link to study material for your students.
            </DialogDescription>
          </DialogHeader>

          {/* Context badges */}
          <div className="flex items-center gap-2 flex-wrap p-3 rounded-lg bg-muted/50">
            <Badge variant="outline" className="flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              School Repository
            </Badge>
            {selectedClasses.slice(0, 3).map((c) => (
              <Badge key={c.id} variant="secondary" className="flex items-center gap-1">
                <GraduationCap className="h-3 w-3" />
                {classLabel(c)}
              </Badge>
            ))}
            {selectedClasses.length > 3 && (
              <Badge variant="secondary">+{selectedClasses.length - 3} more</Badge>
            )}
            {selectedSubject && (
              <Badge
                variant="secondary"
                className="flex items-center gap-1 max-w-full"
                title={selectedSubject.name}
              >
                <BookOpen className="h-3 w-3 shrink-0" />
                <span className="truncate">{selectedSubject.name}</span>
              </Badge>
            )}
            {singleTopicName && (
              <Badge
                variant="secondary"
                className="flex items-center gap-1 max-w-full"
                title={singleTopicName}
              >
                <Layers className="h-3 w-3 shrink-0" />
                <span className="truncate">{singleTopicName}</span>
              </Badge>
            )}
          </div>

          <form
            onSubmit={handleSubmit}
            className="space-y-4"
            data-dirty={isDirty ? "true" : undefined}
          >
            {/* Step 1: Classes */}
            <div className="space-y-2">
              <Label htmlFor="class">Select Class *</Label>
              {classesQuery.error ? (
                <p className="text-sm text-destructive">
                  Couldn't load your classes. Close this and try again.
                </p>
              ) : (
                <SearchableMultiSelect
                  values={selectedClasses.map((c) => c.id)}
                  onValuesChange={setSelectedClassIds}
                  options={classOptions}
                  placeholder={classPlaceholder}
                  searchPlaceholder="Search classes..."
                  emptyText="No classes found."
                  disabled={classesQuery.isLoading || classes.length === 0}
                  summary={(count, selected) =>
                    count <= 2
                      ? selected
                          .map((o) => {
                            const c = classById.get(o.value);
                            return c ? classLabel(c) : o.label;
                          })
                          .join(", ")
                      : `${count} classes selected`
                  }
                />
              )}
              {spansSeveralClasses && targets.length !== 1 && (
                <div className="flex gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                  <Info className="h-4 w-4 shrink-0 text-primary" />
                  <span>
                    Each class has its own chapters, so pick one for each class below. Every class
                    gets its own copy that can be deleted on its own.
                  </span>
                </div>
              )}
            </div>

            {/* Step 2: Subject */}
            <div className="space-y-2">
              <Label htmlFor="subject">Select Subject *</Label>
              {subjectsError ? (
                <p className="text-sm text-destructive">
                  Couldn't load subjects. Close this and try again.
                </p>
              ) : (
                <SearchableSelect
                  value={effectiveSubjectKey}
                  onValueChange={setSubjectKey}
                  placeholder={subjectPlaceholder}
                  searchPlaceholder="Search subjects..."
                  options={subjectOptions.map((o) => ({ value: o.value, label: o.label }))}
                  disabled={selectedClasses.length === 0 || subjectOptions.length === 0}
                />
              )}
            </div>

            {/* Step 3: Chapter, one per class when the classes differ */}
            {targets.length <= 1 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="topic">Select Chapter *</Label>
                  {targets[0] && newChapterButton(targets[0])}
                </div>
                {targets[0] ? (
                  renderChapterField(targets[0], 0)
                ) : (
                  <SearchableSelect
                    value=""
                    onValueChange={() => undefined}
                    placeholder="Select a subject first"
                    options={[]}
                    disabled
                  />
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Select Chapter for each class *</Label>
                <div className="space-y-3">
                  {targets.map((target, i) => (
                    <div key={target.key} className="space-y-2 rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1 text-sm font-medium">
                          <GraduationCap className="h-4 w-4 shrink-0 text-primary" />
                          <span className="truncate" title={joinClassLabels(target.classes)}>
                            {joinClassLabels(target.classes)}
                          </span>
                        </span>
                        {newChapterButton(target)}
                      </div>
                      {renderChapterField(target, i)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Separator />

            {/* Material Details */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Material Title *</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Chapter 3 Notes"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="materialType">Type *</Label>
                  <SearchableSelect
                    value={materialType}
                    onValueChange={setMaterialType}
                    placeholder="Select type"
                    searchPlaceholder="Search..."
                    options={MATERIAL_TYPES.map((t) => ({
                      value: t.value,
                      label: t.label,
                    }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="publisher">Publisher / Author</Label>
                  <Input
                    id="publisher"
                    value={publisher}
                    onChange={(e) => setPublisher(e.target.value)}
                    placeholder="e.g., NCERT"
                  />
                </div>
              </div>

              {/* File Upload */}
              <div className="space-y-2">
                <Label>Upload File</Label>
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_FILE_TYPES}
                    onChange={handleFileChange}
                    className="hidden"
                    id="material-file-upload"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1"
                    disabled={busy}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {selectedFile ? "Change File" : "Choose File"}
                  </Button>
                  {selectedFile && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove file"
                      onClick={() => {
                        setSelectedFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {selectedFile && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                  </p>
                )}
              </div>

              {/* OR Separator */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">Or add link</span>
                </div>
              </div>

              {/* External Link */}
              <div className="space-y-2">
                <Label htmlFor="externalLink">External Link / Drive URL</Label>
                <Input
                  id="externalLink"
                  type="url"
                  value={externalLink}
                  onChange={(e) => {
                    setExternalLink(e.target.value);
                    if (e.target.value) {
                      setSelectedFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }
                  }}
                  placeholder="https://drive.google.com/..."
                  disabled={!!selectedFile}
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of the material..."
                  rows={2}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {selectedFile ? "Uploading..." : "Adding..."}
                  </>
                ) : selectedClasses.length > 1 ? (
                  `Add to ${selectedClasses.length} classes`
                ) : (
                  "Add Material"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add to more than one class?</AlertDialogTitle>
            <AlertDialogDescription>
              {targets.length > 1
                ? "You picked different classes, so this material is saved as a separate copy for each one. Deleting it from one class leaves the others as they are."
                : "You picked different classes. They share this chapter, so they share one copy of the material."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-2 text-sm">
            {targets.map((target, i) => (
              <li key={target.key} className="rounded-lg bg-muted/50 p-3">
                <p className="font-medium text-foreground">{joinClassLabels(target.classes)}</p>
                <p className="text-muted-foreground">
                  {selectedSubject?.name}
                  {chosenTopicName(i) ? ` · ${chosenTopicName(i)}` : ""}
                </p>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runAdd()}>
              Add to {selectedClasses.length} classes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
