export type HomeworkStatus = "draft" | "published" | "checked";

/** Local form state for the create/edit flow. Dates are JS Date in the form,
 * serialized to ISO on save. */
export interface HomeworkFormData {
  /** Present once saved (draft upsert + edit). */
  homeworkId?: string;
  institutionId: string | null;
  title: string;
  description: string;
  subjectIds: string[];            // universal_subjects.id — one or more; [0] is the primary
  classIds: string[];              // classes.id (sections)
  carriesMarks: boolean;
  maxMarks: number | null;
  /** Marked assignment whose marks the teacher enters directly (students submitted offline). */
  offlineMarks: boolean;
  visibleFrom: Date;
  dueAt: Date;
  attachmentPath: string | null;
  attachmentName: string | null;
  attachmentMime: string | null;
}

export interface SaveHomeworkResult {
  homeworkId: string;
  status: HomeworkStatus;
}

/** One row in the 3-tab list (assignment fields + joined names + counts). */
export interface HomeworkListRow {
  id: string;
  title: string;
  status: HomeworkStatus;
  carries_marks: boolean;
  offline_marks: boolean;
  max_marks: number | null;
  visible_from: string;
  due_at: string;
  checked_at: string | null;
  subjects: { id: string; name: string }[];
  classes: { id: string; name: string; section: string | null }[];
  counts?: { submitted: number; graded: number; total: number };
}

export const emptyHomeworkForm = (institutionId: string | null): HomeworkFormData => ({
  institutionId,
  title: "",
  description: "",
  subjectIds: [],
  classIds: [],
  carriesMarks: true,
  maxMarks: null,
  offlineMarks: false,
  // default visible now, due in 3 days (caller may override)
  visibleFrom: new Date(),
  dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
  attachmentPath: null,
  attachmentName: null,
  attachmentMime: null,
});
