import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";
import type { HomeworkListRow, HomeworkFormData, HomeworkStatus } from "@/types/homework";

export type HomeworkTab = "scheduled" | "submitted" | "checked";

const SELECT = `
  id, title, status, carries_marks, offline_marks, max_marks, visible_from, due_at, checked_at,
  subject:subject_id ( id, name ),
  homework_assignment_subjects ( universal_subjects ( id, name ) ),
  homework_assignment_classes ( class_id, classes ( id, name, section ) )
` as const;

type ScopeClass = { id: string; name: string; section: string | null };

interface RawRow {
  id: string;
  title: string;
  status: HomeworkStatus;
  carries_marks: boolean;
  offline_marks: boolean;
  max_marks: number | null;
  visible_from: string;
  due_at: string;
  checked_at: string | null;
  subject: { id: string; name: string } | { id: string; name: string }[] | null;
  homework_assignment_subjects: {
    universal_subjects: { id: string; name: string } | { id: string; name: string }[] | null;
  }[];
  homework_assignment_classes: {
    class_id: string;
    classes: ScopeClass | ScopeClass[] | null;
  }[];
}

function pickOne<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function mapRow(r: RawRow): HomeworkListRow {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    carries_marks: r.carries_marks,
    offline_marks: r.offline_marks,
    max_marks: r.max_marks,
    visible_from: r.visible_from,
    due_at: r.due_at,
    checked_at: r.checked_at,
    subjects: (() => {
      const fromJoin = (r.homework_assignment_subjects ?? [])
        .map((j) => pickOne(j.universal_subjects))
        .filter((s): s is { id: string; name: string } => !!s);
      if (fromJoin.length > 0) return fromJoin;
      const primary = pickOne(r.subject);
      return primary ? [primary] : [];
    })(),
    classes: (r.homework_assignment_classes ?? [])
      .map((j) => pickOne(j.classes))
      .filter((c): c is ScopeClass => !!c),
  };
}

/** Tab list. RLS scopes rows to manageable ones; we filter by status/due_at. */
export function useHomeworkList(tab: HomeworkTab, opts?: { page?: number; pageSize?: number }) {
  const page = opts?.page ?? 0;
  const size = opts?.pageSize ?? 50;
  return useQuery({
    queryKey: ["homework", "list", tab, page, size],
    staleTime: 60_000,
    queryFn: async (): Promise<HomeworkListRow[]> => {
      const nowIso = new Date().toISOString();
      let q = supabase
        .from("homework_assignments")
        .select(SELECT)
        .range(page * size, page * size + size - 1);
      if (tab === "checked") {
        q = q.eq("status", "checked").order("checked_at", { ascending: false });
      } else {
        q = q.eq("status", "published");
        q =
          tab === "scheduled"
            ? q.gt("due_at", nowIso).order("due_at", { ascending: true })
            : q.lte("due_at", nowIso).order("due_at", { ascending: false });
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as RawRow[]).map(mapRow);
    },
  });
}

export function useHomeworkCounts(ids: string[]) {
  return useQuery({
    queryKey: ["homework", "counts", [...ids].sort()],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("homework_list_counts", { _homework_ids: ids });
      if (error) throw error;
      const m = new Map<string, { submitted: number; graded: number; total: number }>();
      (data ?? []).forEach((r) =>
        m.set(r.homework_assignment_id, {
          submitted: r.submitted_count,
          graded: r.graded_count,
          total: r.total_students,
        })
      );
      return m;
    },
  });
}

export function useHomeworkDrafts() {
  return useQuery({
    queryKey: ["homework-drafts"],
    staleTime: 60_000,
    queryFn: async (): Promise<HomeworkListRow[]> => {
      const { data, error } = await supabase
        .from("homework_assignments")
        .select(SELECT)
        .eq("status", "draft")
        .order("updated_at", { ascending: false })
        .range(0, 49);
      if (error) throw error;
      return (data as unknown as RawRow[]).map(mapRow);
    },
  });
}

/** Edit-mode loader: returns a fully-shaped HomeworkFormData. */
export function useHomeworkForEdit(homeworkId: string | undefined) {
  return useQuery({
    queryKey: ["homework", homeworkId, "edit"],
    enabled: !!homeworkId,
    staleTime: 30_000,
    queryFn: async (): Promise<HomeworkFormData> => {
      const { data, error } = await supabase
        .from("homework_assignments")
        .select(
          `id, institution_id, title, description, subject_id, carries_marks, offline_marks, max_marks,
           visible_from, due_at, attachment_path, attachment_name, attachment_mime,
           homework_assignment_classes ( class_id ),
           homework_assignment_subjects ( subject_id )`
        )
        .eq("id", homeworkId!)
        .single();
      if (error) throw error;
      const loadedSubjectIds = (data.homework_assignment_subjects ?? []).map((s) => s.subject_id);
      return {
        homeworkId: data.id,
        institutionId: data.institution_id,
        title: data.title,
        description: data.description ?? "",
        subjectIds:
          loadedSubjectIds.length > 0
            ? loadedSubjectIds
            : data.subject_id
              ? [data.subject_id]
              : [],
        classIds: (data.homework_assignment_classes ?? []).map((c) => c.class_id),
        carriesMarks: data.carries_marks,
        offlineMarks: data.offline_marks ?? false,
        maxMarks: data.max_marks,
        visibleFrom: new Date(data.visible_from),
        dueAt: new Date(data.due_at),
        attachmentPath: data.attachment_path,
        attachmentName: data.attachment_name,
        attachmentMime: data.attachment_mime,
      };
    },
  });
}

export function useDuplicateHomework() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (sourceId: string): Promise<string> => {
      if (!user?.id) throw new Error("Not authenticated");
      // Load source, create a new DRAFT copy + class links. Returns new id.
      const src = await supabase
        .from("homework_assignments")
        .select(
          `institution_id, subject_id, title, description, carries_marks, offline_marks, max_marks,
           visible_from, due_at, academic_year, homework_assignment_classes ( class_id ),
           homework_assignment_subjects ( subject_id )`
        )
        .eq("id", sourceId)
        .single();
      if (src.error) throw src.error;
      const s = src.data;
      const { data: created, error } = await supabase
        .from("homework_assignments")
        .insert({
          institution_id: s.institution_id,
          subject_id: s.subject_id,
          title: `${s.title} (copy)`,
          description: s.description,
          carries_marks: s.carries_marks,
          offline_marks: s.offline_marks,
          max_marks: s.max_marks,
          visible_from: s.visible_from,
          due_at: s.due_at,
          academic_year: s.academic_year,
          status: "draft",
          created_by: user.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      const links = (s.homework_assignment_classes ?? []).map((c) => ({
        homework_assignment_id: created.id,
        class_id: c.class_id,
      }));
      if (links.length) {
        const { error: lErr } = await supabase
          .from("homework_assignment_classes")
          .insert(links);
        if (lErr) throw lErr;
      }
      const subjLinks = (s.homework_assignment_subjects ?? []).map((x) => ({
        homework_assignment_id: created.id,
        subject_id: x.subject_id,
      }));
      const subjectLinks = subjLinks.length
        ? subjLinks
        : s.subject_id
          ? [{ homework_assignment_id: created.id, subject_id: s.subject_id }]
          : [];
      if (subjectLinks.length) {
        const { error: sErr } = await supabase
          .from("homework_assignment_subjects")
          .insert(subjectLinks);
        if (sErr) throw sErr;
      }
      return created.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["homework"] });
      qc.invalidateQueries({ queryKey: ["homework-drafts"] });
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't duplicate the homework.", context: "duplicateHomework" }),
  });
}

export function useDeleteHomeworkDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("homework_assignments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["homework-drafts"] });
      toast.success("Draft deleted");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't delete the draft.", context: "deleteHomeworkDraft" }),
  });
}

/** Delete a homework assignment of ANY status (draft/published/checked).
 *  Routes through the homework_delete SECURITY DEFINER RPC, which gates on
 *  can_manage_homework and cascade-removes classes, subjects, submissions,
 *  files, results, marks, and audit rows. The direct-delete RLS policy only
 *  covers drafts, so published/checked rows MUST go through this. */
export function useDeleteHomework() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<string | null> => {
      const { data, error } = await supabase.rpc("homework_delete", { _homework_id: id });
      if (error) throw error;
      return (data as string | null) ?? null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["homework"] });
      qc.invalidateQueries({ queryKey: ["homework-drafts"] });
      toast.success("Homework deleted");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't delete the homework.", context: "deleteHomework" }),
  });
}
