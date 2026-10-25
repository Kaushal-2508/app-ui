import { TableHead } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortDirection } from "@/hooks/useTableSort";

interface SortableTableHeaderProps {
  label: string;
  sortKey: string;
  currentSortKey: string;
  currentDirection: SortDirection;
  onSort: (key: string) => void;
  className?: string;
}

export function SortableTableHeader({
  label,
  sortKey,
  currentSortKey,
  currentDirection,
  onSort,
  className,
}: SortableTableHeaderProps) {
  const isActive = currentSortKey === sortKey;

  return (
    <TableHead className={cn("cursor-pointer select-none", className)}>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 -ml-3 font-medium hover:bg-transparent"
        onClick={() => onSort(sortKey)}
      >
        {label}
        {isActive && currentDirection === "asc" ? (
          <ArrowUp className="ml-2 h-4 w-4" />
        ) : isActive && currentDirection === "desc" ? (
          <ArrowDown className="ml-2 h-4 w-4" />
        ) : (
          <ArrowUpDown className="ml-2 h-4 w-4 opacity-50" />
        )}
      </Button>
    </TableHead>
  );
}
