import { saveBlob } from "@/lib/native";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { invalidateSyllabusCache } from "@/lib/queryKeys";
import { useQueryClient } from "@tanstack/react-query";
import { extractLanguages, isHindiText } from "@/lib/languageUtils";
import { useUserRole } from "@/hooks/useUserRole";
import { generateSubjectCode, formatGradeForCode } from "@/lib/subjectCode";
import { extractGradeNumberFromClassName } from "@/lib/gradeLookup";

interface BulkUploadSubjectsTopicsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Page-level drop hands the file in via this prop. The dialog parses it
   * automatically once it opens, then signals back via onInitialFileConsumed
   * so the parent can clear the slot (or the same file would re-ingest on
   * the next open). */
  initialFile?: File | null;
  onInitialFileConsumed?: () => void;
}

interface RawCsvRow {
  // The CSV's first column (class identifier). We accept both `class_name`
  // (preferred) and `grade_name` (legacy) so existing user templates still
  // parse. Resolved into `class_name` on `ParsedRow`.
  class_name?: string;
  grade_name?: string;
  subject_name?: string;
  subject_category?: string;
  topic_name?: string;
}

interface ParsedRow {
  class_name: string;
  subject_name: string;
  subject_category?: string;
  topic_name: string;
}

interface ProcessingStats {
  subjectsCreated: number;
  subjectsSkipped: number;
  topicsCreated: number;
  topicsSkipped: number;
  topicsCascadeSkipped: number;
  errors: string[];
}

type UploadStep = "upload" | "preview";
type ProcessingState = "idle" | "processing" | "complete";

const VALID_CATEGORIES = ["core", "elective", "language", "vocational"] as const;
type ValidCategory = (typeof VALID_CATEGORIES)[number];

function normalizeCategory(category: string | undefined): ValidCategory {
  if (!category) return "core";
  const lower = category.toLowerCase().trim();
  if (VALID_CATEGORIES.includes(lower as ValidCategory)) {
    return lower as ValidCategory;
  }
  return "core";
}

function pickClassName(row: RawCsvRow): string {
  // Prefer `class_name` (new canonical header); fall back to `grade_name` so
  // CSVs generated before the class-group refactor still parse.
  return (row.class_name ?? row.grade_name ?? "").toString();
}

/** Reuse the file-loading path for both drop and click. */
function readFileIntoRows(
  file: File,
  onRows: (rows: ParsedRow[]) => void,
): void {
  const fileName = file.name.toLowerCase();
  // Excel: any xlsx-js-readable workbook variant. CSV / TSV / TXT go through
  // PapaParse (PapaParse handles tab-separated when the header parses anyway).
  const isExcel = /\.(xlsx|xls|xlsm|xlsb|xltx|xltm)$/i.test(fileName);
  const isCsv = /\.(csv|tsv|txt)$/i.test(fileName);

  if (!isExcel && !isCsv) {
    toast.error(
      `Can't read "${file.name}". Drop a CSV or Excel file (.csv, .xlsx, .xls).`,
    );
    return;
  }

  if (isExcel) {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json<RawCsvRow>(sheet, { defval: "" });
        onRows(
          jsonData.map((r) => ({
            class_name: pickClassName(r).trim(),
            subject_name: (r.subject_name ?? "").toString().trim(),
            subject_category: (r.subject_category ?? "").toString().trim() || undefined,
            topic_name: (r.topic_name ?? "").toString().trim(),
          })),
        );
      } catch (error) {
        toast.error(`Failed to parse Excel file: ${String(error)}`);
      }
    };
    reader.onerror = () => toast.error("Failed to read Excel file");
    reader.readAsBinaryString(file);
    return;
  }

  Papa.parse<RawCsvRow>(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      onRows(
        results.data.map((r) => ({
          class_name: pickClassName(r).trim(),
          subject_name: (r.subject_name ?? "").toString().trim(),
          subject_category: (r.subject_category ?? "").toString().trim() || undefined,
          topic_name: (r.topic_name ?? "").toString().trim(),
        })),
      );
    },
    error: (error) => {
      toast.error(`Failed to parse CSV: ${error.message}`);
    },
  });
}

export function BulkUploadSubjectsTopicsDialog({
  open,
  onOpenChange,
  initialFile,
  onInitialFileConsumed,
}: BulkUploadSubjectsTopicsDialogProps) {
  const queryClient = useQueryClient();
  const { data: roleInfo } = useUserRole();
  const institutionId = roleInfo?.institutionId ?? null;

  const [step, setStep] = useState<UploadStep>("upload");
  const [processingState, setProcessingState] = useState<ProcessingState>("idle");
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<ProcessingStats | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [droppedFileName, setDroppedFileName] = useState<string | null>(null);

  const resetState = () => {
    setStep("upload");
    setProcessingState("idle");
    setParsedData([]);
    setValidationErrors([]);
    setProgress(0);
    setStats(null);
    setIsDragging(false);
    setDroppedFileName(null);
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const downloadTemplate = () => {
    // class_name = the class as named in School → Classes (e.g. "Class 3",
    // "Class 11 Commerce"). Each row creates one subject (per class) + one
    // chapter under that subject. Same subject across rows is collapsed.
    const template = `class_name,subject_name,subject_category,topic_name
Class 3,English,language,Bird Talk
Class 3,English,language,Little by Little
Class 3,Mathematics,core,Fractions
Class 3,Mathematics,core,Decimals
Class 4,English,language,The Giving Tree
Class 4,Mathematics,core,Geometry Basics
Class 11 Commerce,Economics,elective,Introduction to Economics
Class 11 Commerce,Economics,elective,Consumer Equilibrium
Class 12 Commerce,Economics,elective,National Income
Class 12 Commerce,Economics,elective,Money and Banking
Class 12 Science - Medical,Physics,core,Electric Charges
Class 12 Science - Medical,Biology,elective,Reproduction`;

    const blob = new Blob([template], { type: "text/csv" });
    saveBlob(blob, "subjects_chapters_template.csv");
  };

  const processFileData = useCallback((data: ParsedRow[]) => {
    const errors: string[] = [];

    data.forEach((row, index) => {
      if (!row.class_name?.trim()) errors.push(`Row ${index + 2}: Missing class_name`);
      if (!row.subject_name?.trim()) errors.push(`Row ${index + 2}: Missing subject_name`);
      if (!row.topic_name?.trim()) errors.push(`Row ${index + 2}: Missing topic_name`);
    });

    const validData = data.filter(
      (row) =>
        row.class_name?.trim() && row.subject_name?.trim() && row.topic_name?.trim(),
    );

    setValidationErrors(errors);
    setParsedData(validData);
    setStep("preview");
  }, []);

  const ingestFile = useCallback(
    (file: File) => {
      setDroppedFileName(file.name);
      readFileIntoRows(file, processFileData);
    },
    [processFileData],
  );

  // Auto-ingest a page-level dropped file once the dialog opens. Track the
  // last-consumed File ref so re-renders with the same prop don't re-parse
  // the same file. Cleared when the dialog closes so a future open with a
  // fresh file ingests normally.
  const lastConsumedFileRef = useRef<File | null>(null);
  useEffect(() => {
    if (!open) {
      lastConsumedFileRef.current = null;
      return;
    }
    if (initialFile && lastConsumedFileRef.current !== initialFile) {
      lastConsumedFileRef.current = initialFile;
      ingestFile(initialFile);
      onInitialFileConsumed?.();
    }
  }, [open, initialFile, ingestFile, onInitialFileConsumed]);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      ingestFile(file);
      e.target.value = "";
    },
    [ingestFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      if (e.dataTransfer.files.length > 1) {
        toast.info("Multiple files dropped, using the first one.");
      }
      ingestFile(file);
    },
    [ingestFile],
  );

  const processUpload = async () => {
    if (!institutionId) {
      toast.error("Can't determine your school. Please sign in again.");
      return;
    }
    setProcessingState("processing");
    setProgress(0);

    const processingStats: ProcessingStats = {
      subjectsCreated: 0,
      subjectsSkipped: 0,
      topicsCreated: 0,
      topicsSkipped: 0,
      topicsCascadeSkipped: 0,
      errors: [],
    };

    try {
      // ========================================
      // STEP 1: Load class_groups for this institution (10%)
      // ========================================
      // The CSV identifies classes by name (e.g. "Class 11 Commerce"). We
      // resolve those names against this school's class_groups — never write
      // institution-less globals (RLS denies that for non-super-admins, which
      // was the original "Failed to create subject" error).
      const { data: classGroupsRaw, error: classGroupsError } = await supabase
        .from("class_groups" as never)
        .select("id, name, grade_level_id, grade_levels(grade_number, grade_name)")
        .eq("institution_id", institutionId)
        .eq("is_active", true);

      if (classGroupsError) throw classGroupsError;

      type ClassGroupRow = {
        id: string;
        name: string;
        grade_level_id: string | null;
        grade_levels:
          | { grade_number: number; grade_name: string }
          | { grade_number: number; grade_name: string }[]
          | null;
      };

      const pickOne = <T,>(v: T | T[] | null | undefined): T | null =>
        Array.isArray(v) ? v[0] ?? null : v ?? null;

      // class_name (lowercased) → resolved class_group context. We carry
      // grade_number + grade_level_id forward so topic inserts can populate
      // syllabus_topics.grade_level_id without re-querying per row.
      const classGroupMap = new Map<
        string,
        {
          id: string;
          name: string;
          gradeLevelId: string | null;
          gradeNumber: number | null;
          gradeName: string;
        }
      >();

      for (const row of (classGroupsRaw ?? []) as unknown as ClassGroupRow[]) {
        const gl = pickOne(row.grade_levels);
        let gradeNumber = gl?.grade_number ?? null;
        let gradeName = gl?.grade_name ?? row.name;

        // Fallback for pre-school class_groups whose grade_levels link is
        // missing (legacy rows). Derive from the group's name the same way
        // useClassGroups + subjectCode do.
        if (gradeNumber == null) {
          const derived = extractGradeNumberFromClassName(row.name);
          if (derived !== null) {
            gradeNumber = derived;
            if (!gradeName) gradeName = row.name;
          }
        }

        classGroupMap.set(row.name.toLowerCase().trim(), {
          id: row.id,
          name: row.name,
          gradeLevelId: row.grade_level_id,
          gradeNumber,
          gradeName,
        });
      }

      // Detect unresolved class names in the CSV early. Better than letting
      // each row fail silently with no subject_map entry.
      const csvClassNames = new Set(parsedData.map((r) => r.class_name.toLowerCase().trim()));
      const missingClasses = [...csvClassNames].filter((c) => !classGroupMap.has(c));

      if (missingClasses.length > 0) {
        processingStats.errors.push(
          `Class names not found in your school: ${missingClasses.slice(0, 5).join(", ")}${
            missingClasses.length > 5 ? ` and ${missingClasses.length - 5} more` : ""
          }. Check spelling against the School → Classes page, or create them first.`,
        );
        setStats(processingStats);
        setProcessingState("complete");
        toast.error("Some classes weren't found. See errors for details.");
        return;
      }

      setProgress(10);

      // ========================================
      // STEP 2: Load existing subject mappings per class_group (20%)
      // ========================================
      const classGroupIds = [...classGroupMap.values()].map((cg) => cg.id);

      const { data: existingMappings, error: mappingsError } = await supabase
        .from("subject_class_group_mappings" as never)
        .select(
          "class_group_id, subject_id, universal_subjects!inner(id, name, is_active)",
        )
        .eq("institution_id", institutionId)
        .in("class_group_id", classGroupIds);

      if (mappingsError) throw mappingsError;

      type MappingRow = {
        class_group_id: string;
        subject_id: string;
        universal_subjects:
          | { id: string; name: string; is_active: boolean }
          | { id: string; name: string; is_active: boolean }[]
          | null;
      };

      // Key: `${classGroupId}-${subjectNameLower}` → subject_id
      const subjectMap = new Map<string, string>();
      for (const m of (existingMappings ?? []) as unknown as MappingRow[]) {
        const us = pickOne(m.universal_subjects);
        if (!us || !us.is_active) continue;
        const key = `${m.class_group_id}-${us.name.toLowerCase().trim()}`;
        subjectMap.set(key, us.id);
      }

      // Load institution-wide existing codes once. We grow this set as we
      // mint new codes so within-batch codes don't collide either.
      const { data: existingCodeRows, error: codesError } = await supabase
        .from("universal_subjects")
        .select("code")
        .eq("institution_id", institutionId)
        .eq("is_active", true)
        .not("code", "is", null);

      if (codesError) throw codesError;
      const existingCodes = new Set<string>(
        (existingCodeRows ?? [])
          .map((r: { code: string | null }) => r.code)
          .filter((c): c is string => !!c),
      );

      setProgress(20);

      // ========================================
      // STEP 3: Plan + create subjects per class_group (50%)
      // ========================================
      // Unique (class_group_id, subjectName) pairs across the CSV.
      const subjectPlan = new Map<
        string,
        {
          classGroupId: string;
          gradeNumber: number | null;
          gradeName: string;
          className: string;
          subjectName: string;
          subjectNameLower: string;
          category: ValidCategory;
          dependentTopicCount: number;
        }
      >();

      for (const row of parsedData) {
        const cg = classGroupMap.get(row.class_name.toLowerCase().trim());
        if (!cg) continue;
        const subjectNameLower = row.subject_name.toLowerCase().trim();
        const key = `${cg.id}-${subjectNameLower}`;
        const planRow = subjectPlan.get(key);
        if (planRow) {
          planRow.dependentTopicCount += 1;
        } else {
          subjectPlan.set(key, {
            classGroupId: cg.id,
            gradeNumber: cg.gradeNumber,
            gradeName: cg.gradeName,
            className: cg.name,
            subjectName: row.subject_name.trim(),
            subjectNameLower,
            category: normalizeCategory(row.subject_category),
            dependentTopicCount: 1,
          });
        }
      }

      // Track subjects that failed to create so the matching topic rows can
      // be reported as cascade skips rather than silent drops.
      const failedSubjectKeys = new Set<string>();

      let subjectsProcessed = 0;
      const totalSubjects = subjectPlan.size;

      for (const [key, plan] of subjectPlan) {
        // Already exists in this class_group — reuse.
        if (subjectMap.has(key)) {
          processingStats.subjectsSkipped++;
        } else if (plan.gradeNumber === null) {
          // Can't generate a code without a grade_number — flag and cascade.
          processingStats.errors.push(
            `Can't determine the grade for "${plan.className}". Couldn't add subject "${plan.subjectName}" (${plan.dependentTopicCount} chapters skipped). Ask your admin to link this class to a grade.`,
          );
          failedSubjectKeys.add(key);
          processingStats.topicsCascadeSkipped += plan.dependentTopicCount;
        } else {
          // Mint a fresh code. Account for codes generated earlier in this
          // batch so two new "Physics" subjects in different grades each get
          // a unique code (PHY11, PHY12).
          const code = generateSubjectCode({
            name: plan.subjectName,
            gradeNumber: plan.gradeNumber,
            gradeName: plan.gradeName,
            existingCodes,
          });
          existingCodes.add(code);

          const { data: newSubject, error: insertError } = await supabase
            .from("universal_subjects")
            .insert({
              name: plan.subjectName,
              code,
              institution_id: institutionId,
              category: plan.category,
              is_active: true,
            })
            .select("id")
            .single();

          if (insertError || !newSubject) {
            const msg = insertError?.message ?? "unknown error";
            // Friendly RLS hint — same surface the user saw in the original
            // screenshot, but now grouped with the cascade count.
            const isRls =
              /row-level security|policy|permission|denied/i.test(msg);
            processingStats.errors.push(
              isRls
                ? `Couldn't add subject "${plan.subjectName}" in ${plan.className}: you need admin rights to add subjects (${plan.dependentTopicCount} chapters skipped).`
                : `Couldn't add subject "${plan.subjectName}" in ${plan.className}: ${msg} (${plan.dependentTopicCount} chapters skipped).`,
            );
            failedSubjectKeys.add(key);
            processingStats.topicsCascadeSkipped += plan.dependentTopicCount;
          } else {
            // Map subject → class_group. RLS-bound, mandatory. Trigger fans
            // out to subject_class_mappings for every section under this
            // class_group, so the syllabus tree picks it up automatically.
            const { error: mapError } = await supabase
              .from("subject_class_group_mappings" as never)
              .insert({
                class_group_id: plan.classGroupId,
                subject_id: newSubject.id,
                institution_id: institutionId,
              } as never);

            if (mapError) {
              processingStats.errors.push(
                `Subject "${plan.subjectName}" was added but couldn't be assigned to ${plan.className}: ${mapError.message} (${plan.dependentTopicCount} chapters skipped).`,
              );
              failedSubjectKeys.add(key);
              processingStats.topicsCascadeSkipped += plan.dependentTopicCount;
            } else {
              subjectMap.set(key, newSubject.id);
              processingStats.subjectsCreated++;
            }
          }
        }

        subjectsProcessed++;
        setProgress(20 + Math.round((subjectsProcessed / Math.max(totalSubjects, 1)) * 30));
      }

      setProgress(50);

      // ========================================
      // STEP 4: Load existing topics for these subjects (60%)
      // ========================================
      const allSubjectIds = [...new Set([...subjectMap.values()])];
      const existingTopicKeys = new Set<string>();

      if (allSubjectIds.length > 0) {
        // Paginate — PostgREST caps at 1000 rows per request (CLAUDE.md §23.1).
        let offset = 0;
        const pageSize = 1000;
        while (true) {
          const { data: topicBatch, error: topicsError } = await supabase
            .from("syllabus_topics")
            .select("grade_level_id, subject_id, topic_name, topic_name_hindi")
            .in("subject_id", allSubjectIds)
            .or(`institution_id.eq.${institutionId},institution_id.is.null`)
            .range(offset, offset + pageSize - 1);

          if (topicsError) throw topicsError;
          if (!topicBatch || topicBatch.length === 0) break;

          for (const t of topicBatch as Array<{
            grade_level_id: string | null;
            subject_id: string;
            topic_name: string | null;
            topic_name_hindi: string | null;
          }>) {
            if (t.topic_name) {
              existingTopicKeys.add(
                `${t.grade_level_id ?? ""}-${t.subject_id}-${t.topic_name.toLowerCase().trim()}`,
              );
            }
            if (t.topic_name_hindi) {
              existingTopicKeys.add(
                `${t.grade_level_id ?? ""}-${t.subject_id}-hindi-${t.topic_name_hindi.toLowerCase().trim()}`,
              );
            }
          }
          if (topicBatch.length < pageSize) break;
          offset += pageSize;
        }
      }

      setProgress(60);

      // ========================================
      // STEP 5: Insert new topics (100%)
      // ========================================
      const topicsToCreate: Array<{
        grade_level_id: string;
        subject_id: string;
        topic_name: string | null;
        topic_name_hindi: string | null;
        institution_id: string;
        display_order: number;
        is_active: true;
      }> = [];

      const pendingTopicKeys = new Set<string>();
      let displayOrder = 1;

      for (const row of parsedData) {
        const cg = classGroupMap.get(row.class_name.toLowerCase().trim());
        if (!cg) continue;

        const subjectKey = `${cg.id}-${row.subject_name.toLowerCase().trim()}`;
        // Subject creation failed → already counted in topicsCascadeSkipped.
        if (failedSubjectKeys.has(subjectKey)) continue;

        const subjectId = subjectMap.get(subjectKey);
        if (!subjectId) {
          // No mapping AND not flagged as failed — defensive cascade count.
          processingStats.topicsCascadeSkipped++;
          continue;
        }

        if (!cg.gradeLevelId) {
          // Can't write syllabus_topics without grade_level_id (FK NOT NULL).
          processingStats.errors.push(
            `Can't add chapter "${row.topic_name}" in ${cg.name}: this class has no grade linked.`,
          );
          continue;
        }

        const topicName = row.topic_name.trim();
        const { english: topicEnglish, hindi: topicHindi } = extractLanguages(topicName);

        const topicKey = isHindiText(topicName)
          ? `${cg.gradeLevelId}-${subjectId}-hindi-${topicName.toLowerCase()}`
          : `${cg.gradeLevelId}-${subjectId}-${topicName.toLowerCase()}`;

        if (existingTopicKeys.has(topicKey) || pendingTopicKeys.has(topicKey)) {
          processingStats.topicsSkipped++;
          continue;
        }

        topicsToCreate.push({
          grade_level_id: cg.gradeLevelId,
          subject_id: subjectId,
          topic_name: topicEnglish,
          topic_name_hindi: topicHindi,
          institution_id: institutionId,
          display_order: displayOrder++,
          is_active: true,
        });
        pendingTopicKeys.add(topicKey);
      }

      const BATCH_SIZE = 50;
      for (let i = 0; i < topicsToCreate.length; i += BATCH_SIZE) {
        const batch = topicsToCreate.slice(i, i + BATCH_SIZE);

        const { error: insertError } = await supabase
          .from("syllabus_topics")
          .insert(batch);

        if (insertError) {
          // Fall back to per-row inserts so one bad chapter doesn't drop the
          // whole batch.
          for (const topic of batch) {
            const { error: singleError } = await supabase
              .from("syllabus_topics")
              .insert(topic);

            if (singleError) {
              if (!singleError.message.toLowerCase().includes("duplicate")) {
                const displayName =
                  topic.topic_name || topic.topic_name_hindi || "Unknown";
                processingStats.errors.push(
                  `Chapter "${displayName}": ${singleError.message}`,
                );
              } else {
                processingStats.topicsSkipped++;
              }
            } else {
              processingStats.topicsCreated++;
            }
          }
        } else {
          processingStats.topicsCreated += batch.length;
        }

        const progressPercent =
          60 + Math.round((i / Math.max(topicsToCreate.length, 1)) * 40);
        setProgress(Math.min(progressPercent, 99));
      }

      setProgress(100);

      // ========================================
      // STEP 6: Invalidate caches and complete
      // ========================================
      invalidateSyllabusCache(queryClient);
      // Subject-side caches read by the rest of the syllabus tree.
      queryClient.invalidateQueries({ queryKey: ["class-group-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["class-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["subject-class-mappings"] });

      setStats(processingStats);
      setProcessingState("complete");

      if (processingStats.errors.length === 0) {
        toast.success(
          `Upload complete! Created ${processingStats.subjectsCreated} subjects, ${processingStats.topicsCreated} chapters.`,
        );
      } else {
        toast.warning(`Upload completed with ${processingStats.errors.length} errors`);
      }
    } catch (error) {
      console.error("Bulk upload error:", error);
      processingStats.errors.push(`Unexpected error: ${String(error)}`);
      setStats(processingStats);
      setProcessingState("complete");
      toast.error("Upload failed. Please try again.");
    }
  };

  const previewStats = useMemo(() => {
    if (parsedData.length === 0) return null;
    return {
      classes: new Set(parsedData.map((r) => r.class_name.toLowerCase().trim())).size,
      subjects: new Set(
        parsedData.map(
          (r) =>
            `${r.class_name.toLowerCase().trim()}-${r.subject_name.toLowerCase().trim()}`,
        ),
      ).size,
      topics: parsedData.length,
      uniqueTopics: new Set(
        parsedData.map(
          (r) =>
            `${r.class_name.toLowerCase().trim()}-${r.subject_name.toLowerCase().trim()}-${r.topic_name.toLowerCase().trim()}`,
        ),
      ).size,
    };
  }, [parsedData]);

  // Tiny per-grade preview to show the user what codes will look like.
  // Suppress when the CSV uses pre-school classes only — the algorithm still
  // works (Nursery → 001) but the demo string would confuse more than help.
  const codePreview = useMemo(() => {
    if (!previewStats || parsedData.length === 0) return null;
    const sample = parsedData.find((r) => /\d+/.test(r.class_name));
    if (!sample) return null;
    const gradeMatch = sample.class_name.match(/\d+/);
    if (!gradeMatch) return null;
    const gradeNumber = parseInt(gradeMatch[0], 10);
    return generateSubjectCode({
      name: sample.subject_name,
      gradeNumber,
      gradeName: sample.class_name,
      existingCodes: [],
    });
  }, [parsedData, previewStats]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Bulk Upload Subjects & Chapters
          </DialogTitle>
          <DialogDescription>
            Upload a CSV or Excel file to add subjects and chapters to your school's
            syllabus. Subjects are scoped to the <strong>class</strong> (e.g. "Class 11
            Commerce") and shared across all of its sections.
          </DialogDescription>
        </DialogHeader>

        <div>
          {step === "upload" && (
            <div className="space-y-6 py-4">
              {/* Template Download */}
              <div className="rounded-lg border bg-muted/50 p-4">
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4" />
                  CSV Template
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Download the template to see the required format. Use the class
                  names exactly as they appear in <strong>School → Classes</strong>.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadTemplate}
                  className="border-blue-200 text-blue-700 hover:bg-blue-50"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Template
                </Button>
              </div>

              {/* Drop zone + click-to-upload (single area, two affordances) */}
              <div
                onDragOver={handleDragOver}
                onDragEnter={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                  "rounded-lg border border-dashed p-8 text-center transition-colors",
                  isDragging
                    ? "border-brand-primary bg-brand-primary/5"
                    : "border-border bg-transparent",
                )}
              >
                <Upload
                  className={cn(
                    "mx-auto h-10 w-10 mb-4 transition-colors",
                    isDragging ? "text-brand-primary" : "text-muted-foreground",
                  )}
                />
                <h4 className="font-medium mb-2">
                  {isDragging ? "Drop your file here" : "Drag a file here, or click to upload"}
                </h4>
                <p className="text-sm text-muted-foreground mb-4">
                  Required columns: <code className="font-mono">class_name</code>,{" "}
                  <code className="font-mono">subject_name</code>,{" "}
                  <code className="font-mono">topic_name</code>
                  <br />
                  Optional: <code className="font-mono">subject_category</code> (core,
                  elective, language, vocational)
                  <br />
                  <span className="text-xs text-primary">
                    Supports: CSV, Excel (.xlsx, .xls). Legacy templates using{" "}
                    <code className="font-mono">grade_name</code> still work.
                  </span>
                </p>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() =>
                    document.getElementById("bulk-upload-file-input")?.click()
                  }
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Choose File
                </Button>
                <Input
                  id="bulk-upload-file-input"
                  type="file"
                  accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm,.xlsb,.xltx,.xltm"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                {droppedFileName && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Last picked: <span className="font-mono">{droppedFileName}</span>
                  </p>
                )}
              </div>

              {/* Instructions */}
              <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-sm">
                  <strong className="text-amber-800 dark:text-amber-200">Heads up:</strong>{" "}
                  Each class gets its own copy of subjects. "Mathematics" in{" "}
                  <em>Class 12 Commerce</em> is separate from "Mathematics" in{" "}
                  <em>Class 11 Commerce</em>. Subject codes are generated automatically
                  (e.g. <code className="font-mono">ENG3</code>,{" "}
                  <code className="font-mono">MAT11</code>,{" "}
                  <code className="font-mono">EVS{formatGradeForCode(-3, "Nursery")}</code>{" "}
                  for Nursery).
                </AlertDescription>
              </Alert>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-4 py-4">
              {processingState === "processing" && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Processing upload...</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                  <p className="text-xs text-muted-foreground">{progress}% complete</p>
                </div>
              )}

              {processingState === "complete" && stats && (
                <Alert variant={stats.errors.length > 0 ? "destructive" : "default"}>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>
                    <div className="space-y-1">
                      <p>
                        <strong>Created:</strong> {stats.subjectsCreated} subjects,{" "}
                        {stats.topicsCreated} chapters
                      </p>
                      <p>
                        <strong>Skipped:</strong> {stats.subjectsSkipped} subjects,{" "}
                        {stats.topicsSkipped} chapters (already exist)
                      </p>
                      {stats.topicsCascadeSkipped > 0 && (
                        <p>
                          <strong>Chapters skipped due to subject errors:</strong>{" "}
                          {stats.topicsCascadeSkipped}
                        </p>
                      )}
                      {stats.errors.length > 0 && (
                        <div className="mt-2">
                          <strong>Errors ({stats.errors.length}):</strong>
                          <ul className="list-disc list-inside text-xs mt-1">
                            {stats.errors.slice(0, 8).map((err, i) => (
                              <li key={i}>{err}</li>
                            ))}
                            {stats.errors.length > 8 && (
                              <li>...and {stats.errors.length - 8} more</li>
                            )}
                          </ul>
                        </div>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {validationErrors.length > 0 && processingState === "idle" && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>{validationErrors.length} validation warnings:</strong>
                    <ul className="list-disc list-inside text-xs mt-1">
                      {validationErrors.slice(0, 5).map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                      {validationErrors.length > 5 && (
                        <li>...and {validationErrors.length - 5} more</li>
                      )}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {previewStats && processingState === "idle" && (
                <>
                  <div className="grid grid-cols-4 gap-3">
                    <div className="rounded-lg border p-3 text-center">
                      <p className="text-2xl font-bold">{previewStats.classes}</p>
                      <p className="text-xs text-muted-foreground">Classes</p>
                    </div>
                    <div className="rounded-lg border p-3 text-center">
                      <p className="text-2xl font-bold">{previewStats.subjects}</p>
                      <p className="text-xs text-muted-foreground">Class-Subjects</p>
                    </div>
                    <div className="rounded-lg border p-3 text-center">
                      <p className="text-2xl font-bold">{previewStats.uniqueTopics}</p>
                      <p className="text-xs text-muted-foreground">Unique Chapters</p>
                    </div>
                    <div className="rounded-lg border p-3 text-center">
                      <p className="text-2xl font-bold">{previewStats.topics}</p>
                      <p className="text-xs text-muted-foreground">Total Rows</p>
                    </div>
                  </div>
                  {codePreview && (
                    <p className="text-xs text-muted-foreground text-center">
                      Example auto-generated subject code:{" "}
                      <span className="font-mono text-foreground">{codePreview}</span>
                    </p>
                  )}
                </>
              )}

              {processingState === "idle" && parsedData.length > 0 && (
                <div className="rounded-lg border overflow-hidden">
                  <div className="bg-muted px-4 py-2">
                    <h4 className="text-sm font-medium">Preview (first 10 rows)</h4>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-4 py-2">Class</th>
                          <th className="text-left px-4 py-2">Subject</th>
                          <th className="text-left px-4 py-2">Category</th>
                          <th className="text-left px-4 py-2">Chapter</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedData.slice(0, 10).map((row, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-4 py-2">{row.class_name}</td>
                            <td className="px-4 py-2">{row.subject_name}</td>
                            <td className="px-4 py-2 text-muted-foreground">
                              {row.subject_category || "core"}
                            </td>
                            <td className="px-4 py-2">{row.topic_name}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          {step === "preview" && processingState === "idle" && (
            <Button variant="outline" onClick={() => setStep("upload")}>
              Back
            </Button>
          )}
          {step === "preview" && processingState === "complete" && (
            <Button onClick={handleClose}>Close</Button>
          )}
          {step === "preview" && processingState === "idle" && parsedData.length > 0 && (
            <Button
              onClick={processUpload}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <Upload className="mr-2 h-4 w-4" />
              Upload {parsedData.length} Rows
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
