import { useMemo, useState } from "react";
import { ChevronDown, Loader2, Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MobileTabs } from "@/components/shared/nav";
import { cn, formatClassName } from "@/lib/utils";
import { sortClassRows } from "@/lib/classSort";
import type { PTMScopeType } from "@/lib/ptm";
import type { PTMManageableScope } from "@/hooks/ptm";

export interface ScopeValue {
  scopeType: PTMScopeType;
  wingId: string | null;
  classIds: string[];
}

interface Props {
  scope: PTMManageableScope | undefined;
  isLoading: boolean;
  isError: boolean;
  value: ScopeValue;
  onChange: (next: ScopeValue) => void;
}

/**
 * Who the PTM is for, limited to what the current hat may target (the
 * server's ptm_manageable_scope). An admin sees school, wing and classes; a
 * coordinator their wings and the classes in them; a teacher the classes
 * they teach. The RPC re-checks every id on save.
 */
export function ScopePicker({ scope, isLoading, isError, value, onChange }: Props) {
  const [classesOpen, setClassesOpen] = useState(false);
  const [search, setSearch] = useState("");

  const options = useMemo(() => {
    const list: { value: PTMScopeType; label: string }[] = [];
    if (scope?.can_school) list.push({ value: "school", label: "Whole school" });
    if ((scope?.wings.length ?? 0) > 0) list.push({ value: "wing", label: "A wing" });
    if ((scope?.classes.length ?? 0) > 0) list.push({ value: "class", label: "Classes" });
    return list;
  }, [scope]);

  const sortedClasses = useMemo(
    () => sortClassRows(scope?.classes ?? [], (c) => c.name, (c) => c.section),
    [scope],
  );
  const visibleClasses = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedClasses;
    return sortedClasses.filter((c) => formatClassName(c.name, c.section).toLowerCase().includes(q));
  }, [sortedClasses, search]);
  const selectedClasses = sortedClasses.filter((c) => value.classIds.includes(c.id));

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Checking which classes you can schedule for
      </p>
    );
  }
  if (isError) {
    return (
      <p className="text-sm text-rose-600 dark:text-rose-400">
        Couldn't load your classes. Close this and try again.
      </p>
    );
  }
  if (options.length === 0) {
    return (
      <p className="text-sm text-ink-600">
        No class is assigned to you yet, so there is nothing to schedule a PTM for. Ask your
        coordinator or school admin to schedule it.
      </p>
    );
  }

  const toggleClass = (id: string) => {
    onChange({
      ...value,
      classIds: value.classIds.includes(id)
        ? value.classIds.filter((c) => c !== id)
        : [...value.classIds, id],
    });
  };

  return (
    <div className="space-y-3">
      <MobileTabs
        value={value.scopeType}
        onValueChange={(next) =>
          onChange({ scopeType: next as PTMScopeType, wingId: null, classIds: [] })
        }
        options={options}
        variant="segmented"
        density="compact"
      />

      {value.scopeType === "school" && (
        <p className="text-xs text-ink-500">Every class and every teacher in the school is invited.</p>
      )}

      {value.scopeType === "wing" && (
        <div className="space-y-2">
          <Label htmlFor="ptm-wing">Wing</Label>
          <Select
            value={value.wingId ?? ""}
            onValueChange={(wingId) => onChange({ ...value, wingId })}
          >
            <SelectTrigger id="ptm-wing">
              <SelectValue placeholder="Choose a wing" />
            </SelectTrigger>
            <SelectContent>
              {(scope?.wings ?? []).map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                  <span className="text-ink-500">
                    {" "}
                    · {w.class_ids.length === 1 ? "1 class" : `${w.class_ids.length} classes`}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-ink-500">
            The wing's classes are copied onto the PTM now. A class added to the wing later is not
            included.
          </p>
        </div>
      )}

      {value.scopeType === "class" && (
        <div className="space-y-2">
          {/* A Collapsible, not a Popover: it renders inline, so the sheet's own
              scroll body scrolls it, and it starts collapsed so a 30-class school
              does not bury Date and Time under a wall of checkboxes. */}
          <Collapsible open={classesOpen} onOpenChange={setClassesOpen}>
            <div className="overflow-hidden rounded-md border border-surface-stroke">
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-between gap-2 whitespace-normal rounded-none px-3 py-2 text-left text-sm font-normal hover:bg-muted/50"
                >
                  <span className="truncate font-medium text-ink-900">
                    {value.classIds.length === 0
                      ? "Choose classes"
                      : `${value.classIds.length} ${value.classIds.length === 1 ? "class" : "classes"} selected`}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-ink-500">
                    {classesOpen ? "Done" : "Change"}
                    <ChevronDown
                      className={cn("h-4 w-4 transition-transform", classesOpen && "rotate-180")}
                      aria-hidden="true"
                    />
                  </span>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t border-surface-stroke">
                  {sortedClasses.length > 8 && (
                    <div className="relative border-b border-surface-stroke p-2">
                      <Search
                        className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
                        aria-hidden="true"
                      />
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Find a class"
                        aria-label="Find a class"
                        className="h-9 pl-9"
                      />
                    </div>
                  )}
                  {visibleClasses.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-ink-500">No class matches.</p>
                  ) : (
                    <div className="grid max-h-64 grid-cols-1 gap-0.5 overflow-y-auto p-1 sm:grid-cols-2">
                      {visibleClasses.map((c) => (
                        <label
                          key={c.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50"
                        >
                          <Checkbox
                            checked={value.classIds.includes(c.id)}
                            onCheckedChange={() => toggleClass(c.id)}
                          />
                          <span className="truncate">{formatClassName(c.name, c.section)}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
          {selectedClasses.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedClasses.map((c) => (
                <Badge key={c.id} variant="secondary" className="gap-1 pr-1">
                  {formatClassName(c.name, c.section)}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${formatClassName(c.name, c.section)}`}
                    onClick={() => toggleClass(c.id)}
                    className="h-5 w-5 rounded-full p-0.5 hover:bg-transparent hover:text-destructive [&_svg]:size-3"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </Button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
