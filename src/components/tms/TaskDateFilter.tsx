import * as React from "react";
import { Calendar as CalendarIcon } from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { FilterChip } from "@/components/shared/nav/FilterRow";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";

import {
  DEFAULT_FILTER,
  formatChipLabel,
  isFilterActive,
  type DateFilterPreset,
  type DateFilterState,
} from "@/lib/taskDateFilter";

interface TaskDateFilterProps {
  value: DateFilterState;
  onChange: (next: DateFilterState) => void;
}

const PRESET_ROWS: ReadonlyArray<{ value: DateFilterPreset; label: string }> = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
];

export function TaskDateFilter({ value, onChange }: TaskDateFilterProps) {
  const [open, setOpen] = React.useState(false);

  // Draft state lives only while the sheet is open. Custom modes commit on
  // Apply; presets commit + close immediately on tap.
  const [draft, setDraft] = React.useState<DateFilterState>(value);
  const [customMode, setCustomMode] = React.useState<"single" | "range">(
    value.preset === "custom_range" ? "range" : "single",
  );

  // Reset draft to the committed value every time the sheet opens.
  React.useEffect(() => {
    if (open) {
      setDraft(value);
      setCustomMode(value.preset === "custom_range" ? "range" : "single");
    }
  }, [open, value]);

  const applyPreset = (preset: DateFilterPreset) => {
    if (preset === "custom_date" || preset === "custom_range") {
      setDraft((d) => ({ ...d, preset }));
      return;
    }
    onChange({ preset });
    setOpen(false);
  };

  const isCustomDateValid = draft.preset === "custom_date" && Boolean(draft.customDate);

  const customRangeFrom = draft.customRange?.from ?? null;
  const customRangeTo = draft.customRange?.to ?? null;
  const isCustomRangeValid =
    draft.preset === "custom_range" &&
    customRangeFrom !== null &&
    customRangeTo !== null &&
    customRangeFrom <= customRangeTo;

  const isDraftCustomMode =
    draft.preset === "custom_date" || draft.preset === "custom_range";
  const canApply = isCustomDateValid || isCustomRangeValid;

  const handleApply = () => {
    if (isCustomDateValid) {
      onChange({ preset: "custom_date", customDate: draft.customDate });
      setOpen(false);
    } else if (isCustomRangeValid) {
      onChange({ preset: "custom_range", customRange: draft.customRange });
      setOpen(false);
    }
  };

  const handleReset = () => {
    onChange({ ...DEFAULT_FILTER });
    setOpen(false);
  };

  const today = new Date();

  return (
    <>
      <FilterChip
        label={formatChipLabel(value)}
        active={isFilterActive(value)}
        onClick={() => setOpen(true)}
        trailing={<CalendarIcon className="h-4 w-4 shrink-0 text-ink-500" />}
      />

      <MobileSheet
        open={open}
        onOpenChange={setOpen}
        title="Filter by date"
        icon={<CalendarIcon className="h-4 w-4" />}
        primaryAction={
          isDraftCustomMode
            ? {
                label: "Apply",
                onClick: handleApply,
                disabled: !canApply,
              }
            : undefined
        }
        secondaryAction={
          isFilterActive(value)
            ? { label: "Reset", onClick: handleReset }
            : undefined
        }
      >
        <div className="space-y-5">
          {/* Preset rows */}
          <div
            role="group"
            aria-label="Date preset"
            className="flex flex-col gap-1"
          >
            {PRESET_ROWS.map((p) => {
              const isSelected = draft.preset === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => applyPreset(p.value)}
                  className={cn(
                    "flex items-center justify-between rounded-xl px-3 py-3 text-left text-sm transition-colors",
                    isSelected
                      ? "bg-brand-primary/10 text-brand-primary font-medium"
                      : "text-ink-700 hover:bg-ink-400/5",
                  )}
                >
                  <span>{p.label}</span>
                  {isSelected && (
                    <span className="text-xs font-semibold uppercase tracking-wide text-brand-primary">
                      Selected
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Custom section */}
          <div className="border-t border-surface-stroke pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-3">
              Custom
            </h3>

            <Tabs
              value={customMode}
              onValueChange={(v) => {
                const mode = v === "range" ? "range" : "single";
                setCustomMode(mode);
                setDraft((d) => ({
                  ...d,
                  preset: mode === "range" ? "custom_range" : "custom_date",
                }));
              }}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="single">Single date</TabsTrigger>
                <TabsTrigger value="range">Date range</TabsTrigger>
              </TabsList>

              <TabsContent value="single" className="mt-3">
                <div className="flex justify-center">
                  <Calendar
                    mode="single"
                    selected={draft.customDate ?? undefined}
                    onSelect={(d) =>
                      setDraft((prev) => ({
                        ...prev,
                        preset: "custom_date",
                        customDate: d ?? null,
                      }))
                    }
                    disabled={{ after: today }}
                    initialFocus
                  />
                </div>
              </TabsContent>

              <TabsContent value="range" className="mt-3">
                <div className="flex justify-center">
                  <Calendar
                    mode="range"
                    selected={
                      draft.customRange?.from || draft.customRange?.to
                        ? {
                            from: draft.customRange?.from ?? undefined,
                            to: draft.customRange?.to ?? undefined,
                          }
                        : undefined
                    }
                    onSelect={(r) =>
                      setDraft((prev) => ({
                        ...prev,
                        preset: "custom_range",
                        customRange: {
                          from: r?.from ?? null,
                          to: r?.to ?? null,
                        },
                      }))
                    }
                    disabled={{ after: today }}
                    numberOfMonths={1}
                    initialFocus
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </MobileSheet>
    </>
  );
}
