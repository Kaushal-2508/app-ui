import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchExamEligibleStudentIds } from "@/lib/examEligibility";
import { toast } from "sonner";
import { formatClassName } from "@/lib/utils";
import { sortStudentRoster } from "@/lib/studentIdentity";

export type ScanStep = "context" | "capture" | "match" | "processing";

export interface CapturedSheet {
  id: string;
  file: File;
  previewUrl: string;
  studentId?: string;
  studentName?: string;
  rollNumber?: string;
  matchMethod?: "manual" | "roll_number" | "auto_detect";
}

export interface StudentWithRoll {
  id: string;
  fullName: string;
  email: string;
  rollNumber: string | null;
  admissionNumber: string | null;
  hasAttempt: boolean;
}

export function useOfflineScan() {
  const [step, setStep] = useState<ScanStep>("context");
  const [examId, setExamId] = useState<string | null>(null);
  const [classId, setClassId] = useState<string | null>(null);
  const [sheets, setSheets] = useState<CapturedSheet[]>([]);

  const reset = useCallback(() => {
    setStep("context");
    setExamId(null);
    setClassId(null);
    // Revoke object URLs to prevent memory leaks
    sheets.forEach((sheet) => URL.revokeObjectURL(sheet.previewUrl));
    setSheets([]);
  }, [sheets]);

  const addSheet = useCallback((file: File) => {
    const sheet: CapturedSheet = {
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    };
    setSheets((prev) => [...prev, sheet]);
    return sheet;
  }, []);

  const addSheets = useCallback((files: File[]) => {
    const newSheets: CapturedSheet[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setSheets((prev) => [...prev, ...newSheets]);
    return newSheets;
  }, []);

  const removeSheet = useCallback((sheetId: string) => {
    setSheets((prev) => {
      const sheet = prev.find((s) => s.id === sheetId);
      if (sheet) {
        URL.revokeObjectURL(sheet.previewUrl);
      }
      return prev.filter((s) => s.id !== sheetId);
    });
  }, []);

  const updateSheetMatch = useCallback(
    (
      sheetId: string,
      match: {
        studentId: string;
        studentName: string;
        rollNumber?: string;
        matchMethod: "manual" | "roll_number" | "auto_detect";
      }
    ) => {
      setSheets((prev) =>
        prev.map((s) =>
          s.id === sheetId
            ? {
                ...s,
                studentId: match.studentId,
                studentName: match.studentName,
                rollNumber: match.rollNumber,
                matchMethod: match.matchMethod,
              }
            : s
        )
      );
    },
    []
  );

  const clearSheetMatch = useCallback((sheetId: string) => {
    setSheets((prev) =>
      prev.map((s) =>
        s.id === sheetId
          ? { ...s, studentId: undefined, studentName: undefined, rollNumber: undefined, matchMethod: undefined }
          : s
      )
    );
  }, []);

  const matchedCount = sheets.filter((s) => s.studentId).length;
  const allMatched = sheets.length > 0 && matchedCount === sheets.length;

  return {
    step,
    setStep,
    examId,
    setExamId,
    classId,
    setClassId,
    sheets,
    setSheets,
    addSheet,
    addSheets,
    removeSheet,
    updateSheetMatch,
    clearSheetMatch,
    matchedCount,
    allMatched,
    reset,
  };
}

/**
 * Fetch offline exams for a teacher/institution
 */
export function useOfflineExams() {
  return useQuery({
    queryKey: ["offline-exams"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exams")
        .select(
          `
          id,
          title,
          scheduled_date,
          status,
          exam_mode,
          exam_classes!exam_classes_exam_id_fkey (
            class_id,
            classes!exam_classes_class_id_fkey (id, name, section)
          )
        `
        )
        .eq("exam_mode", "offline")
        .in("status", ["published", "completed"])
        .order("scheduled_date", { ascending: false });

      if (error) throw error;
      return data || [];
    },
  });
}

/**
 * Fetch students with roll numbers for a class
 */
export function useStudentsWithRoll(classId: string | null, examId: string | null) {
  return useQuery({
    queryKey: ["students-with-roll", classId, examId],
    queryFn: async (): Promise<StudentWithRoll[]> => {
      if (!classId) return [];

      const { data: assignments, error } = await supabase
        .from("class_assignments")
        .select(
          `
          user_id,
          profiles!class_assignments_user_id_fkey (id, full_name, email, roll_number, admission_number)
        `
        )
        .eq("class_id", classId)
        .eq("role", "student");

      if (error) throw error;

      // Optional-subject eligibility. This list is the sheet-to-student picker
      // (and feeds "Match by roll order", which auto-assigns positionally), so
      // an unfiltered roster let a French answer sheet be bound to a pupil who
      // does not take French. Worse, the attempt INSERT that follows is
      // rejected by trg_enforce_exam_subject_enrollment with 42501, aborting
      // the submit loop with earlier sheets already committed.
      let eligibleIds: Set<string> | null = null;
      if (examId) {
        eligibleIds = await fetchExamEligibleStudentIds(examId);
      }

      // Get existing attempts
      let existingAttempts: string[] = [];
      if (examId) {
        const { data: attempts } = await supabase
          .from("student_exam_attempts")
          .select("student_id")
          .eq("exam_id", examId)
          .eq("class_id", classId);
        existingAttempts = attempts?.map((a) => a.student_id) || [];
      }

      const mapped = (assignments || [])
        .filter((a) => a.profiles)
        // Ineligible pupils are not offerable match targets at all.
        .filter((a) => !eligibleIds || eligibleIds.has(a.user_id as string))
        .map((a) => {
          const profile = a.profiles as {
            id: string;
            full_name: string;
            email: string;
            roll_number: string | null;
            admission_number: string | null;
          };
          return {
            id: profile.id,
            fullName: profile.full_name,
            email: profile.email,
            rollNumber: profile.roll_number,
            admissionNumber: profile.admission_number,
            hasAttempt: existingAttempts.includes(profile.id),
          };
        });

      // Single class, so one block: roll order only when every student here is
      // numbered, alphabetical (ERP order) otherwise.
      return sortStudentRoster(mapped, {
        getRoll: (s) => s.rollNumber,
        getName: (s) => s.fullName,
      });
    },
    enabled: !!classId,
  });
}

/**
 * Submit sheets for OCR processing
 */
export function useSubmitSheetsForProcessing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sheets,
      examId,
      classId,
    }: {
      sheets: CapturedSheet[];
      examId: string;
      classId: string;
    }) => {
      const results = [];

      for (const sheet of sheets) {
        if (!sheet.studentId) continue;

        // 1. Check/create attempt
        const { data: existingAttempt } = await supabase
          .from("student_exam_attempts")
          .select("id")
          .eq("exam_id", examId)
          .eq("student_id", sheet.studentId)
          .maybeSingle();

        let attemptId = existingAttempt?.id;

        if (!attemptId) {
          const { data: newAttempt, error: attemptError } = await supabase
            .from("student_exam_attempts")
            .insert({
              exam_id: examId,
              student_id: sheet.studentId,
              class_id: classId,
              is_submitted: true,
              submitted_at: new Date().toISOString(),
              is_offline: true,
              evaluation_status: "pending",
            })
            .select("id")
            .single();

          if (attemptError) throw attemptError;
          attemptId = newAttempt.id;
        }

        // 2. Upload file to storage
        const fileName = `${examId}/${classId}/${sheet.studentId}/${Date.now()}_${sheet.file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("answer-sheets")
          .upload(fileName, sheet.file);

        if (uploadError) {
          console.error("Upload error:", uploadError);
          throw new Error(`Failed to upload answer sheet "${sheet.file.name}": ${uploadError.message}`);
        }

        const { data: urlData } = supabase.storage.from("answer-sheets").getPublicUrl(fileName);

        // 3. Create OCR upload record
        const { data: ocrUpload, error: ocrError } = await supabase
          .from("ocr_uploads")
          .insert({
            exam_id: examId,
            class_id: classId,
            student_id: sheet.studentId,
            attempt_id: attemptId,
            file_name: sheet.file.name,
            file_url: urlData.publicUrl,
            file_size_bytes: sheet.file.size,
            status: "pending",
            roll_number: sheet.rollNumber || null,
            match_method: sheet.matchMethod || "manual",
            uploaded_by: (await supabase.auth.getUser()).data.user?.id || "",
          })
          .select("id")
          .single();

        if (ocrError) throw ocrError;

        results.push({
          sheetId: sheet.id,
          studentId: sheet.studentId,
          attemptId,
          uploadId: ocrUpload.id,
        });

        // Trigger OCR processing in background (non-blocking)
        supabase.functions
          .invoke("process-ocr-upload", {
            body: { uploadId: ocrUpload.id },
          })
          .then((response) => {
            if (response.error) {
              console.error("OCR processing error for upload", ocrUpload.id, response.error);
            } else {
              console.log("OCR processing triggered for upload", ocrUpload.id);
            }
          })
          .catch((err) => {
            console.error("Failed to invoke OCR processing:", err);
          });
      }

      return results;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["offline-evaluations"] });
      queryClient.invalidateQueries({ queryKey: ["processing-jobs"] });
      toast.success(`${data.length} sheets submitted for processing`);
    },
    onError: (error) => {
      toast.error("Failed to submit sheets: " + (error as Error).message);
    },
  });
}

/**
 * Fetch processing jobs (pending OCR uploads)
 */
export function useProcessingJobs() {
  return useQuery({
    queryKey: ["processing-jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocr_uploads")
        .select(
          `
          id,
          exam_id,
          class_id,
          file_name,
          status,
          created_at,
          exams!ocr_uploads_exam_id_fkey (title),
          classes!ocr_uploads_class_id_fkey (name, section)
          `
        )
        .in("status", ["pending", "processing", "completed", "failed"])
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      // Group by exam + class
      const grouped = (data || []).reduce(
        (acc, upload) => {
          const key = `${upload.exam_id}-${upload.class_id}`;
          if (!acc[key]) {
            const exam = upload.exams as { title: string } | null;
            const cls = upload.classes as { name: string; section: string | null } | null;
            acc[key] = {
              examId: upload.exam_id,
              classId: upload.class_id,
              examTitle: exam?.title || "Unknown Exam",
              className: cls ? formatClassName(cls.name, cls.section) : "Unknown Class",
              total: 0,
              pending: 0,
              processing: 0,
              completed: 0,
              failed: 0,
              uploads: [],
            };
          }
          acc[key].total++;
          if (upload.status === "pending") acc[key].pending++;
          if (upload.status === "processing") acc[key].processing++;
          if (upload.status === "completed") acc[key].completed++;
          if (upload.status === "failed") acc[key].failed++;
          acc[key].uploads.push({
            id: upload.id,
            fileName: upload.file_name,
            status: upload.status,
          });
          return acc;
        },
        {} as Record<
          string,
          {
            examId: string;
            classId: string;
            examTitle: string;
            className: string;
            total: number;
            pending: number;
            processing: number;
            completed: number;
            failed: number;
            uploads: Array<{ id: string; fileName: string; status: string }>;
          }
        >
      );

      return Object.values(grouped);
    },
    refetchInterval: 5000, // Poll every 5 seconds
  });
}
