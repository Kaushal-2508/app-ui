import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Filter, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type FilterType = "text" | "select" | "date" | "number";

export interface FilterOption {
  value: string;
  label: string;
}

interface TableColumnFilterProps {
  type: FilterType;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  options?: FilterOption[];
  className?: string;
}

export function TableColumnFilter({
  type,
  value,
  onChange,
  placeholder = "Filter...",
  options = [],
  className,
}: TableColumnFilterProps) {
  const [open, setOpen] = useState(false);
  const [tempValue, setTempValue] = useState(value);

  const hasActiveFilter = !!value;

  const handleApply = () => {
    onChange(tempValue);
    setOpen(false);
  };

  const handleClear = () => {
    setTempValue("");
    onChange("");
    setOpen(false);
  };

  const renderFilterInput = () => {
    switch (type) {
      case "select":
        return (
          <Select value={tempValue} onValueChange={setTempValue}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case "date":
        return (
          <Input
            type="date"
            value={tempValue}
            onChange={(e) => setTempValue(e.target.value)}
            className="w-full"
          />
        );
      case "number":
        return (
          <Input
            type="number"
            value={tempValue}
            onChange={(e) => setTempValue(e.target.value)}
            placeholder={placeholder}
            className="w-full"
          />
        );
      default:
        return (
          <Input
            type="text"
            value={tempValue}
            onChange={(e) => setTempValue(e.target.value)}
            placeholder={placeholder}
            className="w-full"
          />
        );
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-6 w-6 p-0 ml-1",
            hasActiveFilter && "text-primary",
            className
          )}
        >
          <Filter className={cn("h-3 w-3", hasActiveFilter && "fill-primary/20")} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="start">
        <div className="space-y-3">
          <div className="text-sm font-medium">Filter</div>
          {renderFilterInput()}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={handleClear}
              disabled={!tempValue}
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={handleApply}
            >
              <Check className="h-3 w-3 mr-1" />
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}