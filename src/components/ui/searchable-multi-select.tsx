import * as React from "react";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { SearchableSelectOption } from "@/components/ui/searchable-select";

export interface SearchableMultiSelectSelectAll {
  label: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
}

interface SearchableMultiSelectProps {
  /** Ticked option values, in the order they were ticked. */
  values: string[];
  onValuesChange: (values: string[]) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  /**
   * Trigger text once something is ticked, given the count and the ticked
   * options in tick order. Defaults to "N selected".
   */
  summary?: (count: number, selected: SearchableSelectOption[]) => string;
  /** Upper bound on ticks. Unticked rows disable once it is reached. */
  maxSelected?: number;
  /** Replaces the footer count while `maxSelected` is reached. */
  maxReachedText?: string;
  /**
   * A row pinned above the options that ticks every option at once, or clears
   * them all when everything is already ticked. Hidden while a search is
   * typed, because "all" would then be ambiguous.
   */
  selectAll?: SearchableMultiSelectSelectAll;
  /**
   * A row pinned above everything that stands for the group as one value
   * (the whole class, as opposed to each of its students). Ticking it leaves
   * only its value ticked; ticking any other row clears it. Unlike
   * `selectAll` it is a value of its own, not a shortcut that ticks the rest.
   * Hidden while a search is typed, like `selectAll`. Not part of `options`.
   */
  exclusiveOption?: SearchableSelectOption;
  /**
   * Heading of the group that lists the already-ticked rows first when the
   * list opens, so the whole selection is visible in one place.
   */
  selectedHeading?: string;
  /** Heading of the remaining rows while a selected group is showing. */
  othersHeading?: string;
}

const SELECT_ALL_VALUE = "__select_all__";

/**
 * Room below the trigger, in CSS px, at which the list still opens downward:
 * the search box, the footer and roughly three rows. With less than this it
 * opens on whichever side has more room.
 */
const MIN_ROOM_BELOW = 260;

function defaultSummary(count: number) {
  return `${count} selected`;
}

/** The round tick on the left of every row. Purely visual: the row itself takes the click. */
function RoundTick({ checked }: { checked: boolean }) {
  return (
    <Checkbox
      checked={checked}
      tabIndex={-1}
      aria-hidden
      className="pointer-events-none mr-2 h-5 w-5 rounded-full [&_svg]:h-3.5 [&_svg]:w-3.5"
    />
  );
}

/**
 * Multi-pick sibling of SearchableSelect: same trigger, search box and option
 * shape, but every row carries a round tick and the list stays open while
 * people tick as many as they want. Each time it opens, the rows already
 * ticked are listed first under `selectedHeading`; that order is frozen for
 * the rest of that open, so rows never move under the pointer as ticks change.
 * Selection state is fully controlled.
 */
export function SearchableMultiSelect({
  values,
  onValuesChange,
  options,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  disabled = false,
  className,
  triggerClassName,
  summary = defaultSummary,
  maxSelected,
  maxReachedText,
  selectAll,
  exclusiveOption,
  selectedHeading = "Selected",
  othersHeading = "Others",
}: SearchableMultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [side, setSide] = React.useState<"top" | "bottom">("bottom");
  // The ticked values at the moment the list opened, in tick order.
  const [pinned, setPinned] = React.useState<string[]>([]);

  const selected = React.useMemo(() => new Set(values), [values]);
  const optionByValue = React.useMemo(
    () =>
      new Map(
        (exclusiveOption ? [exclusiveOption, ...options] : options).map((opt) => [
          opt.value,
          opt,
        ]),
      ),
    [options, exclusiveOption],
  );
  const exclusiveValue = exclusiveOption?.value;
  const exclusiveTicked = exclusiveValue !== undefined && values.includes(exclusiveValue);
  const selectedOptions = React.useMemo(
    () =>
      values.flatMap((value) => {
        const opt = optionByValue.get(value);
        return opt ? [opt] : [];
      }),
    [optionByValue, values],
  );
  const capReached = maxSelected !== undefined && values.length >= maxSelected;
  const searching = search.trim() !== "";

  // Group options if any have a group property, exactly as SearchableSelect does.
  const hasGroups = options.some((opt) => opt.group);
  const groupedOptions = React.useMemo(() => {
    if (!hasGroups) return { "": options };

    return options.reduce(
      (acc, opt) => {
        const group = opt.group || "";
        if (!acc[group]) acc[group] = [];
        acc[group].push(opt);
        return acc;
      },
      {} as Record<string, SearchableSelectOption[]>,
    );
  }, [options, hasGroups]);

  // Rows listed first: what was ticked when the list opened. Searching drops
  // the split and shows one flat, filtered list instead. The exclusive row
  // has its own place at the very top, so it never joins this group.
  const pinnedOptions = React.useMemo(() => {
    if (searching) return [];
    return pinned.flatMap((value) => {
      if (value === exclusiveValue) return [];
      const opt = optionByValue.get(value);
      return opt ? [opt] : [];
    });
  }, [pinned, optionByValue, searching, exclusiveValue]);

  const visibleGroups = React.useMemo(() => {
    const searchLower = search.trim().toLowerCase();
    const pinnedSet = new Set(searching ? [] : pinned);
    const result: Record<string, SearchableSelectOption[]> = {};

    for (const [group, opts] of Object.entries(groupedOptions)) {
      const kept = opts.filter((opt) => {
        if (pinnedSet.has(opt.value)) return false;
        if (!searchLower) return true;
        return (
          opt.label.toLowerCase().includes(searchLower) ||
          opt.description?.toLowerCase().includes(searchLower)
        );
      });
      if (kept.length > 0) {
        result[group] = kept;
      }
    }

    return result;
  }, [groupedOptions, search, searching, pinned]);

  const hasResults =
    pinnedOptions.length > 0 || Object.keys(visibleGroups).length > 0;

  const selectable = React.useMemo(
    () => options.filter((opt) => !opt.disabled).map((opt) => opt.value),
    [options],
  );
  const allSelected =
    selectable.length > 0 && selectable.every((value) => selected.has(value));
  const showSelectAll = Boolean(selectAll) && !searching && selectable.length > 1;

  const toggle = (value: string) => {
    if (value === exclusiveValue) {
      onValuesChange(exclusiveTicked ? [] : [value]);
      return;
    }
    if (selected.has(value)) {
      onValuesChange(values.filter((v) => v !== value));
      return;
    }
    if (capReached) return;
    onValuesChange([...values.filter((v) => v !== exclusiveValue), value]);
  };

  const toggleAll = () => {
    if (allSelected) {
      onValuesChange([]);
      return;
    }
    onValuesChange(
      maxSelected !== undefined ? selectable.slice(0, maxSelected) : selectable,
    );
  };

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setPinned(values);
      // Choose the side once per open and hold it. Radix's own collision
      // flip re-runs on every layout change, and anything that grows the
      // form beneath re-centres the dialog, shifts this trigger a few pixels,
      // and flipped the list from above to below mid-pick. It opens downward
      // like any dropdown whenever a few rows fit there; whichever side is
      // chosen, the content is capped at the room actually available, so it
      // scrolls instead of running off the screen.
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        const below = window.innerHeight - rect.bottom;
        const above = rect.top;
        setSide(below >= MIN_ROOM_BELOW || below >= above ? "bottom" : "top");
      }
    }
    setOpen(next);
    if (!next) setSearch("");
  };

  const renderOption = (option: SearchableSelectOption) => {
    const checked = selected.has(option.value);
    return (
      <CommandItem
        key={option.value}
        value={option.value}
        disabled={option.disabled || (!checked && capReached)}
        onSelect={() => toggle(option.value)}
        className={cn(
          "cursor-pointer items-start whitespace-normal",
          option.className,
        )}
      >
        <RoundTick checked={checked} />
        {option.icon && (
          <option.icon className="mr-2 mt-0.5 h-4 w-4 shrink-0" />
        )}
        <div className="flex min-w-0 flex-1 flex-col break-words">
          <span>{option.label}</span>
          {option.description && (
            <span className="text-xs text-muted-foreground">
              {option.description}
            </span>
          )}
        </div>
      </CommandItem>
    );
  };

  const count = values.length;
  const footerText =
    capReached && maxReachedText
      ? maxReachedText
      : exclusiveTicked && exclusiveOption
        ? exclusiveOption.label
        : count === 0
          ? "Nothing selected yet"
          : `${count} selected`;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            count === 0 && "text-muted-foreground",
            triggerClassName,
          )}
        >
          <span className="min-w-0 flex-1 truncate text-left">
            {count === 0 ? placeholder : summary(count, selectedOptions)}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn(
          "flex max-h-[var(--radix-popover-content-available-height)] w-[var(--radix-popover-trigger-width)] min-w-[200px] flex-col overflow-hidden p-0",
          className,
        )}
        side={side}
        align="start"
        sideOffset={4}
        avoidCollisions={false}
        collisionPadding={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* cmdk's root takes focus (tabIndex -1) when a row is clicked, and
            because this list stays open the browser's focus outline would
            show around it. */}
        <Command shouldFilter={false} className="min-h-0 outline-none">
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          {/* cmdk paints its active row with the accent token, the brand
              orange here. Fine for a list that closes on click, loud on one
              that stays open, so the active row gets a quiet muted hover. */}
          <div
            role="listbox"
            aria-multiselectable="true"
            className="min-h-0 max-h-[240px] overflow-y-auto overflow-x-hidden overscroll-contain [&_[cmdk-item][data-selected=true]]:bg-muted [&_[cmdk-item][data-selected=true]]:text-foreground"
            style={{ touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            {exclusiveOption && !searching && (
              <CommandGroup>{renderOption(exclusiveOption)}</CommandGroup>
            )}
            {showSelectAll && selectAll && (
              <CommandGroup>
                <CommandItem
                  value={SELECT_ALL_VALUE}
                  onSelect={toggleAll}
                  className="cursor-pointer items-start whitespace-normal"
                >
                  <RoundTick checked={allSelected} />
                  {selectAll.icon && (
                    <selectAll.icon className="mr-2 mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col break-words">
                    <span>{selectAll.label}</span>
                    {selectAll.description && (
                      <span className="text-xs text-muted-foreground">
                        {selectAll.description}
                      </span>
                    )}
                  </div>
                </CommandItem>
              </CommandGroup>
            )}
            {!hasResults && (
              <div className="py-6 text-center text-sm">{emptyText}</div>
            )}
            {pinnedOptions.length > 0 && (
              <CommandGroup heading={selectedHeading}>
                {pinnedOptions.map(renderOption)}
              </CommandGroup>
            )}
            {Object.entries(visibleGroups).map(([group, opts]) => (
              <CommandGroup
                key={group || "__others__"}
                heading={
                  group || (pinnedOptions.length > 0 ? othersHeading : undefined)
                }
              >
                {opts.map(renderOption)}
              </CommandGroup>
            ))}
          </div>
        </Command>
        {/* Outside <Command> on purpose: cmdk swallows Enter for the active
            row, which would stop a keyboard user pressing this button. */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2">
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {footerText}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => handleOpenChange(false)}
          >
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
