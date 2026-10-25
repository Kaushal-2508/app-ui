import { Label } from "@/components/ui/label";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import type { SearchableSelectOption } from "@/components/ui/searchable-select";
import { MAX_TASK_SUPERVISORS } from "@/hooks/useTasks";

interface SupervisorsFieldProps {
  /** Ticked supervisor ids, in the order they were ticked. */
  values: string[];
  onChange: (values: string[]) => void;
  /** Everyone eligible to supervise (assignees and self already excluded). */
  options: SearchableSelectOption[];
  loading?: boolean;
  disabled?: boolean;
}

/** Names in the trigger, so who is tagged is visible without opening anything. */
function summarise(count: number, selected: SearchableSelectOption[]) {
  const names = selected.map((option) => option.label);
  if (names.length !== count) {
    return count === 1 ? "1 supervisor selected" : `${count} supervisors selected`;
  }
  if (count === 1) return names[0];
  if (count === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} and ${count - 1} more`;
}

/**
 * Supervisor picker, the same control as Assign To so the two read the same
 * way. Supervisors have no per-person overrides, so this is the plain
 * version: tick, untick, review the selection at the top of the list.
 */
export function SupervisorsField({
  values,
  onChange,
  options,
  loading = false,
  disabled = false,
}: SupervisorsFieldProps) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>Tag Supervisors (Optional)</Label>
        {values.length > 1 && (
          <span className="text-xs text-ink-400">{values.length} supervisors</span>
        )}
      </div>

      <SearchableMultiSelect
        values={values}
        onValuesChange={onChange}
        options={options}
        placeholder={loading ? "Loading..." : "Select supervisors"}
        searchPlaceholder="Search by name..."
        emptyText="No supervisors available"
        disabled={disabled || loading}
        summary={summarise}
        maxSelected={MAX_TASK_SUPERVISORS}
        maxReachedText={`You can tag at most ${MAX_TASK_SUPERVISORS} supervisors.`}
        selectedHeading="Selected"
        othersHeading="Others"
      />

      <p className="text-xs text-muted-foreground">
        {values.length > 1
          ? "Supervisors can observe progress and add comments. They cannot approve."
          : "Supervisor can observe task progress and add comments"}
      </p>
    </div>
  );
}
