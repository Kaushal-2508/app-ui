import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { FIELD_FILL } from "@/lib/fieldStyles";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface SearchableSelectOption {
  value: string;
  label: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  group?: string;
  /** Extra classes on this one row, for an option that is an action rather than a value. */
  className?: string;
}

interface SearchableSelectProps {
  value?: string;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
}

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  disabled = false,
  className,
  triggerClassName,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const selectedOption = options.find((opt) => opt.value === value);

  // Group options if any have a group property
  const hasGroups = options.some((opt) => opt.group);
  const groupedOptions = React.useMemo(() => {
    if (!hasGroups) return { "": options };
    
    return options.reduce((acc, opt) => {
      const group = opt.group || "";
      if (!acc[group]) acc[group] = [];
      acc[group].push(opt);
      return acc;
    }, {} as Record<string, SearchableSelectOption[]>);
  }, [options, hasGroups]);

  const filteredGroupedOptions = React.useMemo(() => {
    const searchLower = search.toLowerCase();
    const result: Record<string, SearchableSelectOption[]> = {};
    
    for (const [group, opts] of Object.entries(groupedOptions)) {
      const filtered = opts.filter(
        (opt) =>
          opt.label.toLowerCase().includes(searchLower) ||
          opt.description?.toLowerCase().includes(searchLower)
      );
      if (filtered.length > 0) {
        result[group] = filtered;
      }
    }
    
    return result;
  }, [groupedOptions, search]);

  const hasResults = Object.values(filteredGroupedOptions).some(
    (opts) => opts.length > 0
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          title={selectedOption?.label || undefined}
          className={cn(
            "w-full max-w-full justify-between font-normal overflow-hidden min-h-10 items-start py-2",
            FIELD_FILL,
            !value && "text-muted-foreground",
            triggerClassName
          )}
          // Inline styles win over the Button base's `h-10` and
          // `whitespace-nowrap` reliably — relying on Tailwind class
          // ordering through PopoverTrigger asChild merging proved
          // flaky. `height:auto` lets the button grow when the label
          // wraps; `whiteSpace:normal` enables wrapping on space.
          style={{ height: "auto", whiteSpace: "normal" }}
        >
          {selectedOption?.icon && (
            <selectedOption.icon className="h-4 w-4 shrink-0 mt-0.5" />
          )}
          <span
            className="min-w-0 flex-1 text-left leading-snug break-words"
            // line-clamp-2 via inline styles: 2-line max with ellipsis,
            // wraps at word breaks, and falls back to character break
            // for unbreakably-long tokens like "sdfsdfsdf...".
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
          >
            {selectedOption?.label || placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 mt-0.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-full min-w-[200px] p-0", className)}
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <div
            role="listbox"
            className="max-h-[240px] overflow-y-auto overflow-x-hidden overscroll-contain"
            style={{ touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            {!hasResults && (
              <div className="py-6 text-center text-sm">{emptyText}</div>
            )}
            {Object.entries(filteredGroupedOptions).map(([group, opts]) => (
              <CommandGroup key={group} heading={group || undefined}>
                {opts.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    onSelect={() => {
                      onValueChange(option.value);
                      setOpen(false);
                      setSearch("");
                    }}
                    className={cn(
                      "cursor-pointer items-start whitespace-normal",
                      option.className,
                    )}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0 mt-0.5",
                        value === option.value ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {option.icon && (
                      <option.icon className="mr-2 h-4 w-4 shrink-0 mt-0.5" />
                    )}
                    <div className="flex flex-col min-w-0 flex-1 break-words">
                      <span>{option.label}</span>
                      {option.description && (
                        <span className="text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
