// src/components/olympiad/teacher/StudentRosterRow.tsx
import { useState } from "react";
import { KeyRound, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { OlympiadStudentCredentials } from "@/components/olympiad/teacher/OlympiadStudentCredentials";
import type { RosterStudent } from "@/hooks/olympiad/useOlympiadClassRoster";

type Props = {
  student: RosterStudent;
  subjectNameById: Record<string, string>;
  /** Optional — omit for a read-only list (e.g. the school-admin students view). */
  onEdit?: (s: RosterStudent) => void;
  onRemove?: (s: RosterStudent) => void;
  /** Onboarded (non-SALCI) schools: students sign in with roll number + DOB,
   *  so expose a "Sign-in details" action to retrieve/hand over credentials. */
  showSignInDetails?: boolean;
  /** Show the student's class as a badge — for merged lists without class group headers. */
  showClassBadge?: boolean;
  /** Makes the whole row clickable (e.g. to open a detail sheet). */
  onSelect?: (s: RosterStudent) => void;
};

export function StudentRosterRow({ student, subjectNameById, onEdit, onRemove, showSignInDetails, showClassBadge, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [credsOpen, setCredsOpen] = useState(false);
  const subjectsLabel = student.subject_ids.map((id) => subjectNameById[id] ?? "?").join(", ");
  const isCash = student.enrollment_channel === "teacher_cash";
  const isRemoved = student.status === "removed";
  const hasMenu = !!onEdit || !!onRemove || !!showSignInDetails;

  return (
    <>
      <div
        className={`flex items-center gap-3 px-3 py-3 surface-card frosted-shadow rounded-card ${isRemoved ? "opacity-60" : ""} ${onSelect ? "cursor-pointer transition-shadow hover:shadow-card-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40" : ""}`}
        role={onSelect ? "button" : undefined}
        tabIndex={onSelect ? 0 : undefined}
        onClick={onSelect ? () => onSelect(student) : undefined}
        onKeyDown={
          onSelect
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(student);
                }
              }
            : undefined
        }
      >
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-ink-900">{student.full_name}</p>
            {showClassBadge && (
              <Badge variant="outline" className="text-[10px]">
                {student.class_label}
              </Badge>
            )}
            {isCash && (
              <Badge variant="secondary" className="text-[10px]">
                Cash
              </Badge>
            )}
            {isRemoved && (
              <Badge
                variant="secondary"
                className="text-[10px] bg-rose-100 text-rose-900 dark:bg-rose-500/15 dark:text-rose-300"
              >
                Removed
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-ink-500">
            {student.roll_number} · DOB {student.date_of_birth}
            {student.section_label ? ` · Sec ${student.section_label}` : ""}
          </p>
          <p className="text-[11px] text-ink-600 truncate">{subjectsLabel}</p>
        </div>
        {hasMenu && (
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
              {/* stopPropagation so the kebab doesn't also trigger the row's onSelect */}
              <Button size="icon" variant="ghost" disabled={isRemoved} onClick={(e) => e.stopPropagation()}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {showSignInDetails && (
                <DropdownMenuItem
                  onClick={() => {
                    setOpen(false);
                    setCredsOpen(true);
                  }}
                >
                  <KeyRound className="h-4 w-4 mr-2" /> Sign-in details
                </DropdownMenuItem>
              )}
              {onEdit && (
                <DropdownMenuItem
                  onClick={() => {
                    setOpen(false);
                    onEdit(student);
                  }}
                >
                  <Pencil className="h-4 w-4 mr-2" /> Edit
                </DropdownMenuItem>
              )}
              {onRemove && (
                <DropdownMenuItem
                  onClick={() => {
                    setOpen(false);
                    onRemove(student);
                  }}
                  className="text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Remove
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {showSignInDetails && (
        <MobileSheet
          open={credsOpen}
          onOpenChange={setCredsOpen}
          title="Student sign-in details"
          subtitle={student.full_name}
          primaryAction={{ label: "Done", onClick: () => setCredsOpen(false) }}
        >
          <OlympiadStudentCredentials
            name={student.full_name}
            rollNumber={student.roll_number}
            dob={student.date_of_birth}
          />
        </MobileSheet>
      )}
    </>
  );
}
