import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { X, CalendarIcon, Filter, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { FIELD_FILL } from "@/lib/fieldStyles";
import { DateRange } from "react-day-picker";

export interface FilterOption {
  value: string;
  label: string;
}

/** One filter's value: a select's choice, a multiselect's choices, a toggle. */
export type FilterValue = string | string[] | boolean;

export interface FilterConfig {
  id: string;
  label: string;
  type: "select" | "multiselect" | "daterange" | "toggle";
  options?: FilterOption[];
  defaultValue?: FilterValue;
  placeholder?: string;
}

interface FilterBarProps {
  filters: FilterConfig[];
  onFilterChange: (filterId: string, value: string | string[] | boolean | DateRange | undefined) => void;
  onClearAll?: () => void;
  persistToUrl?: boolean;
  className?: string;
  showFilterCount?: boolean;
}

export function FilterBar({
  filters,
  onFilterChange,
  onClearAll,
  persistToUrl = true,
  className,
  showFilterCount = true,
}: FilterBarProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filterValues, setFilterValues] = useState<Record<string, FilterValue | undefined>>({});
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  // Initialize from URL params
  useEffect(() => {
    if (persistToUrl) {
      const initialValues: Record<string, FilterValue> = {};
      filters.forEach((filter) => {
        const urlValue = searchParams.get(filter.id);
        if (urlValue) {
          if (filter.type === "toggle") {
            initialValues[filter.id] = urlValue === "true";
          } else if (filter.type === "multiselect") {
            initialValues[filter.id] = urlValue.split(",");
          } else {
            initialValues[filter.id] = urlValue;
          }
        } else if (filter.defaultValue !== undefined) {
          initialValues[filter.id] = filter.defaultValue;
        }
      });
      
      // Handle date range
      const startDate = searchParams.get("startDate");
      const endDate = searchParams.get("endDate");
      if (startDate && endDate) {
        setDateRange({
          from: new Date(startDate),
          to: new Date(endDate),
        });
      }
      
      setFilterValues(initialValues);
    }
  }, []);

  const handleFilterChange = (filterId: string, value: FilterValue | undefined) => {
    const newValues = { ...filterValues, [filterId]: value };
    setFilterValues(newValues);

    if (persistToUrl) {
      const newParams = new URLSearchParams(searchParams);
      if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
        newParams.delete(filterId);
      } else if (Array.isArray(value)) {
        newParams.set(filterId, value.join(","));
      } else {
        newParams.set(filterId, String(value));
      }
      setSearchParams(newParams);
    }

    onFilterChange(filterId, value);
  };

  const handleDateRangeChange = (range: DateRange | undefined) => {
    setDateRange(range);
    
    if (persistToUrl) {
      const newParams = new URLSearchParams(searchParams);
      if (range?.from) {
        newParams.set("startDate", format(range.from, "yyyy-MM-dd"));
      } else {
        newParams.delete("startDate");
      }
      if (range?.to) {
        newParams.set("endDate", format(range.to, "yyyy-MM-dd"));
      } else {
        newParams.delete("endDate");
      }
      setSearchParams(newParams);
    }

    onFilterChange("dateRange", range);
  };

  const handleClearAll = () => {
    setFilterValues({});
    setDateRange(undefined);
    
    if (persistToUrl) {
      setSearchParams(new URLSearchParams());
    }
    
    onClearAll?.();
  };

  const activeFilterCount = Object.entries(filterValues).filter(
    ([, value]) => value !== undefined && value !== "" && value !== false && 
    (!Array.isArray(value) || value.length > 0)
  ).length + (dateRange ? 1 : 0);

  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Filter className="h-4 w-4" />
        <span className="text-sm font-medium">Filters</span>
        {showFilterCount && activeFilterCount > 0 && (
          <Badge variant="secondary" className="rounded-full px-2 py-0 text-xs">
            {activeFilterCount}
          </Badge>
        )}
      </div>

      {filters.map((filter) => (
        <div key={filter.id}>
          {filter.type === "select" && (
            <Select
              value={typeof filterValues[filter.id] === "string" ? (filterValues[filter.id] as string) : ""}
              onValueChange={(value) => handleFilterChange(filter.id, value)}
            >
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue placeholder={filter.placeholder || filter.label} />
              </SelectTrigger>
              <SelectContent>
                {filter.options?.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {filter.type === "toggle" && (
            <div className="flex items-center space-x-2">
              <Switch
                id={filter.id}
                checked={filterValues[filter.id] === true}
                onCheckedChange={(checked) => handleFilterChange(filter.id, checked)}
              />
              <Label htmlFor={filter.id} className="text-sm">
                {filter.label}
              </Label>
            </div>
          )}

          {filter.type === "daterange" && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "justify-start text-left font-normal",
                    FIELD_FILL,
                    !dateRange && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, "LLL dd")} -{" "}
                        {format(dateRange.to, "LLL dd")}
                      </>
                    ) : (
                      format(dateRange.from, "LLL dd, y")
                    )
                  ) : (
                    <span>{filter.placeholder || "Pick dates"}</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={dateRange?.from}
                  selected={dateRange}
                  onSelect={handleDateRangeChange}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
          )}
        </div>
      ))}

      {activeFilterCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClearAll}
          className="text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          Clear all
        </Button>
      )}
    </div>
  );
}

// Active filter tags component
export function ActiveFilterTags({
  filters,
  values,
  onRemove,
}: {
  filters: FilterConfig[];
  values: Record<string, FilterValue | undefined>;
  onRemove: (filterId: string) => void;
}) {
  const activeFilters = filters.filter(
    (f) => values[f.id] !== undefined && values[f.id] !== "" && values[f.id] !== false
  );

  if (activeFilters.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {activeFilters.map((filter) => {
        const value = values[filter.id];
        const displayValue =
          filter.type === "select"
            ? filter.options?.find((o) => o.value === value)?.label
            : filter.type === "toggle"
            ? filter.label
            : String(value);

        return (
          <Badge
            key={filter.id}
            variant="secondary"
            className="pl-2 pr-1 py-1 gap-1"
          >
            <span className="text-muted-foreground text-xs">{filter.label}:</span>
            <span className="text-xs font-medium">{displayValue}</span>
            <button
              onClick={() => onRemove(filter.id)}
              className="ml-1 hover:bg-muted rounded p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        );
      })}
    </div>
  );
}
