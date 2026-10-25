import { saveBlob } from "@/lib/native";
import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Search,
  Download,
  MoreHorizontal,
  Filter,
  LayoutGrid,
  LayoutList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileDataCard, MobileDataList } from "./MobileDataCard";

export interface ColumnDef<T> {
  id: string;
  header: string;
  accessorKey?: keyof T | string;
  accessorFn?: (row: T) => any;
  cell?: (row: T) => React.ReactNode;
  sortable?: boolean;
  filterable?: boolean;
  className?: string;
  headerClassName?: string;
  /** Show this column in mobile card view */
  mobileVisible?: boolean;
  /** Use as main title in mobile card */
  mobileTitle?: boolean;
  /** Use as subtitle in mobile card */
  mobileSubtitle?: boolean;
  /** Use as badge in mobile card */
  mobileBadge?: boolean;
}

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  searchable?: boolean;
  searchPlaceholder?: string;
  searchKeys?: string[];
  exportable?: boolean;
  onExport?: () => void;
  exportFilename?: string;
  pageSize?: number;
  showPagination?: boolean;
  rowActions?: (row: T) => React.ReactNode;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  className?: string;
  stickyHeader?: boolean;
  compact?: boolean;
  highlightOnHover?: boolean;
  getRowClassName?: (row: T) => string;
  /** Custom mobile card renderer */
  mobileCardRenderer?: (row: T, actions?: React.ReactNode) => React.ReactNode;
  /** Get avatar text for mobile cards */
  getAvatarText?: (row: T) => string;
}

type SortDirection = "asc" | "desc" | null;

function getNestedValue(obj: any, path: string): any {
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}

export function DataTable<T extends Record<string, any>>({
  data,
  columns,
  searchable = true,
  searchPlaceholder = "Search...",
  searchKeys,
  exportable = false,
  onExport,
  exportFilename = "export",
  pageSize = 10,
  showPagination = true,
  rowActions,
  onRowClick,
  emptyMessage = "No data available",
  className,
  stickyHeader = false,
  compact = false,
  highlightOnHover = true,
  getRowClassName,
  mobileCardRenderer,
  getAvatarText,
}: DataTableProps<T>) {
  const isMobile = useIsMobile();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [forceCardView, setForceCardView] = useState(false);

  const showCardView = isMobile || forceCardView;

  // Filter data by search query
  const searchedData = useMemo(() => {
    if (!searchQuery) return data;

    const keys = searchKeys || columns.filter((c) => c.filterable !== false).map((c) => c.accessorKey as string).filter(Boolean);

    return data.filter((row) =>
      keys.some((key) => {
        const value = getNestedValue(row, key);
        return String(value).toLowerCase().includes(searchQuery.toLowerCase());
      })
    );
  }, [data, searchQuery, searchKeys, columns]);

  // Apply column filters
  const filteredData = useMemo(() => {
    let result = searchedData;

    Object.entries(columnFilters).forEach(([columnId, filterValue]) => {
      if (filterValue) {
        const column = columns.find((c) => c.id === columnId);
        if (column) {
          result = result.filter((row) => {
            const value = column.accessorFn
              ? column.accessorFn(row)
              : column.accessorKey
              ? getNestedValue(row, column.accessorKey as string)
              : "";
            return String(value).toLowerCase().includes(filterValue.toLowerCase());
          });
        }
      }
    });

    return result;
  }, [searchedData, columnFilters, columns]);

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortColumn || !sortDirection) return filteredData;

    const column = columns.find((c) => c.id === sortColumn);
    if (!column) return filteredData;

    return [...filteredData].sort((a, b) => {
      const aValue = column.accessorFn
        ? column.accessorFn(a)
        : column.accessorKey
        ? getNestedValue(a, column.accessorKey as string)
        : "";
      const bValue = column.accessorFn
        ? column.accessorFn(b)
        : column.accessorKey
        ? getNestedValue(b, column.accessorKey as string)
        : "";

      if (aValue == null) return 1;
      if (bValue == null) return -1;

      if (typeof aValue === "number" && typeof bValue === "number") {
        return sortDirection === "asc" ? aValue - bValue : bValue - aValue;
      }

      const comparison = String(aValue).localeCompare(String(bValue));
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [filteredData, sortColumn, sortDirection, columns]);

  // Paginate data
  const paginatedData = useMemo(() => {
    if (!showPagination) return sortedData;
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, currentPage, pageSize, showPagination]);

  const totalPages = Math.ceil(sortedData.length / pageSize);

  const handleSort = (columnId: string) => {
    if (sortColumn === columnId) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else if (sortDirection === "desc") {
        setSortColumn(null);
        setSortDirection(null);
      }
    } else {
      setSortColumn(columnId);
      setSortDirection("asc");
    }
  };

  const handleExport = () => {
    if (onExport) {
      onExport();
      return;
    }

    // Default CSV export
    const headers = columns.map((c) => c.header).join(",");
    const rows = sortedData.map((row) =>
      columns
        .map((col) => {
          const value = col.accessorFn
            ? col.accessorFn(row)
            : col.accessorKey
            ? getNestedValue(row, col.accessorKey as string)
            : "";
          return `"${String(value).replace(/"/g, '""')}"`;
        })
        .join(",")
    );

    const csv = [headers, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    saveBlob(blob, `${exportFilename}.csv`);
  };

  const SortIcon = ({ columnId }: { columnId: string }) => {
    if (sortColumn !== columnId) return <ChevronsUpDown className="h-3 w-3 ml-1" />;
    if (sortDirection === "asc") return <ChevronUp className="h-3 w-3 ml-1" />;
    return <ChevronDown className="h-3 w-3 ml-1" />;
  };

  // Helper to get mobile card data from columns
  const getMobileCardData = (row: T) => {
    const titleCol = columns.find(c => c.mobileTitle);
    const subtitleCol = columns.find(c => c.mobileSubtitle);
    const badgeCol = columns.find(c => c.mobileBadge);
    const visibleCols = columns.filter(c => c.mobileVisible);

    const getValue = (col: ColumnDef<T>) => {
      if (col.cell) return col.cell(row);
      if (col.accessorFn) return col.accessorFn(row);
      if (col.accessorKey) return getNestedValue(row, col.accessorKey as string);
      return null;
    };

    return {
      title: titleCol ? String(getValue(titleCol) || "") : "",
      subtitle: subtitleCol ? String(getValue(subtitleCol) || "") : undefined,
      badge: badgeCol ? { text: String(getValue(badgeCol) || "") } : undefined,
      fields: visibleCols.map(col => ({
        label: col.header,
        value: getValue(col),
      })),
    };
  };

  // Render mobile card view
  const renderCardView = () => (
    <MobileDataList>
      {paginatedData.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        paginatedData.map((row, index) => {
          if (mobileCardRenderer) {
            return (
              <div key={index}>
                {mobileCardRenderer(row, rowActions?.(row))}
              </div>
            );
          }

          const cardData = getMobileCardData(row);
          return (
            <MobileDataCard
              key={index}
              title={cardData.title}
              subtitle={cardData.subtitle}
              avatarText={getAvatarText?.(row)}
              badge={cardData.badge}
              fields={cardData.fields}
              actions={rowActions?.(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            />
          );
        })
      )}
    </MobileDataList>
  );

  // Render table view
  const renderTableView = () => (
    <div className="rounded-md border overflow-hidden">
      <div className={cn("overflow-auto", stickyHeader && "max-h-[600px]")}>
        <Table>
          <TableHeader className={stickyHeader ? "sticky top-0 bg-background z-10" : ""}>
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={column.id}
                  className={cn(
                    compact ? "py-2 px-3" : "py-3 px-4",
                    column.sortable !== false && "cursor-pointer select-none",
                    column.headerClassName
                  )}
                  onClick={() => column.sortable !== false && handleSort(column.id)}
                >
                  <div className="flex items-center">
                    {column.header}
                    {column.sortable !== false && <SortIcon columnId={column.id} />}
                  </div>
                </TableHead>
              ))}
              {rowActions && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + (rowActions ? 1 : 0)}
                  className="text-center py-8 text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((row, rowIndex) => (
                <TableRow
                  key={rowIndex}
                  className={cn(
                    highlightOnHover && "hover:bg-muted/50",
                    onRowClick && "cursor-pointer",
                    getRowClassName?.(row)
                  )}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((column) => (
                    <TableCell
                      key={column.id}
                      className={cn(compact ? "py-2 px-3" : "py-3 px-4", column.className)}
                    >
                      {column.cell
                        ? column.cell(row)
                        : column.accessorFn
                        ? column.accessorFn(row)
                        : column.accessorKey
                        ? getNestedValue(row, column.accessorKey as string)
                        : null}
                    </TableCell>
                  ))}
                  {rowActions && (
                    <TableCell className="py-2 px-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {rowActions(row)}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  return (
    <div className={cn("space-y-4", className)}>
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {searchable && (
          <div className="relative flex-1 max-w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-9"
            />
          </div>
        )}

        <div className="flex items-center gap-2 justify-end">
          {Object.keys(columnFilters).length > 0 && (
            <Badge variant="secondary" className="gap-1">
              <Filter className="h-3 w-3" />
              {Object.keys(columnFilters).length} filters
            </Badge>
          )}

          {/* View toggle - only show on non-mobile */}
          {!isMobile && (
            <div className="flex border rounded-md">
              <Button
                variant={forceCardView ? "ghost" : "secondary"}
                size="sm"
                className="rounded-r-none px-2"
                onClick={() => setForceCardView(false)}
              >
                <LayoutList className="h-4 w-4" />
              </Button>
              <Button
                variant={forceCardView ? "secondary" : "ghost"}
                size="sm"
                className="rounded-l-none px-2"
                onClick={() => setForceCardView(true)}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
            </div>
          )}

          {exportable && (
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          )}
        </div>
      </div>

      {/* Table or Card View */}
      {showCardView ? renderCardView() : renderTableView()}

      {/* Pagination */}
      {showPagination && totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground text-center sm:text-left">
            Showing {(currentPage - 1) * pageSize + 1} to{" "}
            {Math.min(currentPage * pageSize, sortedData.length)} of {sortedData.length}
          </p>
          <div className="flex items-center gap-1 sm:gap-2 flex-wrap justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="hidden sm:inline-flex"
            >
              First
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Prev
            </Button>
            <span className="text-sm px-2">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              className="hidden sm:inline-flex"
            >
              Last
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
