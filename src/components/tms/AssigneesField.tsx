import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import type { SearchableSelectOption } from "@/components/ui/searchable-select";
import { Users } from "lucide-react";
import { MAX_GROUP_ASSIGNEES } from "@/hooks/useTasks";

interface AssigneesFieldProps {
  /** Ticked assignee ids, in the order they were ticked. */
  values: string[];
  onChange: (values: string[]) => void;
  /** Every assignable member. */
  options: SearchableSelectOption[];
  /**
   * Shows the pinned "Assign to everyone" row. Only passed for school admins,
   * so the option simply does not exist for anyone else.
   */
  canAssignEveryone?: boolean;
  loading?: boolean;
}

/** Names in the trigger, so who is picked is visible without opening anything. */
function summarise(count: number, selected: SearchableSelectOption[]) {
  const names = selected.map((option) => option.label);
  if (names.length !== count) {
    return count === 1 ? "1 person selected" : `${count} people selected`;
  }
  if (count === 1) return names[0];
  if (count === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} and ${count - 1} more`;
}

/**
 * The Assign To field: one picker that holds the whole selection. Opening it
 * lists everyone already ticked first, so the selection is reviewed and
 * changed in the same place it was made. Everyone ticked gets the same title
 * and description: the per-person override editor from the 2026-08-06 design
 * was removed on 2026-09-28 (product call), although `create_task_group`
 * still accepts overrides should it ever come back.
 */
export function AssigneesField({
  values,
  onChange,
  options,
  canAssignEveryone = false,
  loading = false,
}: AssigneesFieldProps) {
  const isMulti = values.length > 1;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>Assign To *</Label>
        {isMulti && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-400">{values.length} people</span>
            {/* Escape hatch after an accidental "assign to everyone". */}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs text-ink-400 hover:text-destructive"
              onClick={() => onChange([])}
            >
              Clear all
            </Button>
          </div>
        )}
      </div>

      <SearchableMultiSelect
        values={values}
        onValuesChange={onChange}
        options={options}
        placeholder={loading ? "Loading..." : "Select people"}
        searchPlaceholder="Search by name..."
        emptyText="No members found"
        disabled={loading}
        summary={summarise}
        maxSelected={MAX_GROUP_ASSIGNEES}
        maxReachedText={`You can assign a task to at most ${MAX_GROUP_ASSIGNEES} people at once.`}
        selectedHeading="Selected"
        othersHeading="Everyone else"
        selectAll={
          canAssignEveryone
            ? {
                label: `Assign to everyone (${options.length} people)`,
                description:
                  "Every teacher, coordinator and principal in your institution",
                icon: Users,
              }
            : undefined
        }
      />

      <p className="text-xs text-muted-foreground">
        {isMulti
          ? "Each person gets their own copy of this task and completes it independently."
          : "Assign to any teacher, coordinator, or principal in your institution"}
      </p>
    </div>
  );
}
