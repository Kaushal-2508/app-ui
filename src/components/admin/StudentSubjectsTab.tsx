import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Lock, Layers, Loader2 } from "lucide-react";
import { useStudentSubjectAssignment } from "@/hooks/useStudentOptionalSubjects";
import {
  useStudentOptionalGroupAssignment,
  useSaveStudentOptionalGroupChoices,
} from "@/hooks/useOptionalGroups";

interface StudentSubjectsTabProps {
  studentId: string;
  institutionId: string | null;
}

const NONE = "none";

/**
 * "Subjects" tab inside ViewUserSheet (students only). Shows compulsory
 * subjects as locked context and one dropdown per Optional Group (pick
 * at most one subject per group, saved in a single transaction). Core
 * subjects are not editable by anyone. Optional Groups are the ONLY
 * enrollment workflow: an optional subject that isn't in any group has
 * no per-student UI (add it to a group from Syllabus → Add New →
 * Optional Groups) — the old per-subject toggle list was removed
 * 2026-07-29 on user request. The per-choice main/optional pill was
 * removed 2026-07-30: every chosen optional counts as a MAIN subject
 * (the DB column is pinned to 'main', migration 20260730120000).
 */
// institutionId stays in the props contract (ViewUserSheet passes it) but is
// no longer read — enrollment writes all go through the group-choices RPC.
export function StudentSubjectsTab({ studentId }: StudentSubjectsTabProps) {
  const { data, isLoading } = useStudentSubjectAssignment(studentId);
  const { data: groupData, isLoading: groupsLoading } = useStudentOptionalGroupAssignment(studentId);
  const saveChoices = useSaveStudentOptionalGroupChoices();

  const groups = useMemo(() => groupData?.groups ?? [], [groupData]);

  // Draft choice per group (group_id -> subject_id | null). Reset from
  // the server whenever the assignment refetches (e.g. after Save).
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  useEffect(() => {
    setDraft(Object.fromEntries(groups.map((g) => [g.group_id, g.chosen_subject_id])));
  }, [groups]);

  if (isLoading || groupsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const compulsory = data?.compulsory ?? [];
  const canManage = (data?.can_manage ?? false) || (groupData?.can_manage ?? false);

  const dirty = groups.some((g) => (draft[g.group_id] ?? null) !== g.chosen_subject_id);

  const handleSave = () => {
    saveChoices.mutate({
      studentId,
      choices: groups.map((g) => ({
        group_id: g.group_id,
        subject_id: draft[g.group_id] ?? null,
      })),
    });
  };

  return (
    <div className="space-y-4">
      {/* Compulsory — locked context */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            Compulsory subjects
          </CardTitle>
        </CardHeader>
        <CardContent>
          {compulsory.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {compulsory.map((s) => (
                <Badge key={s.subject_id} variant="secondary" className="text-xs">
                  {s.name}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No compulsory subjects mapped to this student's class.</p>
          )}
        </CardContent>
      </Card>

      {/* Optional groups — one choice per group */}
      {groups.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              Optional choices
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {groups.map((g) => {
              const chosen = draft[g.group_id] ?? null;
              return (
                <div key={g.group_id} className="space-y-1.5">
                  <label className="text-sm font-medium">{g.name}</label>
                  <Select
                    value={chosen ?? NONE}
                    onValueChange={(v) =>
                      setDraft((d) => ({ ...d, [g.group_id]: v === NONE ? null : v }))
                    }
                    disabled={!canManage || saveChoices.isPending}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None selected</SelectItem>
                      {g.subjects.map((s) => (
                        <SelectItem key={s.subject_id} value={s.subject_id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}

            {canManage && (
              <div className="flex justify-end pt-1">
                <Button size="sm" onClick={handleSave} disabled={!dirty || saveChoices.isPending}>
                  {saveChoices.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  Save choices
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {groups.length === 0 && (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground">
              No optionals set up for this student's class yet. Create them
              from Syllabus → Add New → Optional Groups.
            </p>
          </CardContent>
        </Card>
      )}

      {groups.length > 0 && !canManage && (
        <p className="text-xs text-muted-foreground">
          You don't have permission to change this student's subjects.
        </p>
      )}
    </div>
  );
}
