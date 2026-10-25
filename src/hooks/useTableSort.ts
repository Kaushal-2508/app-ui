import { useState, useMemo } from "react";

export type SortDirection = "asc" | "desc" | null;

export interface SortConfig {
  key: string;
  direction: SortDirection;
}

export function useTableSort<T>(
  data: T[] | undefined,
  defaultSort?: SortConfig
) {
  const [sortConfig, setSortConfig] = useState<SortConfig>(
    defaultSort || { key: "", direction: null }
  );

  const handleSort = (key: string) => {
    setSortConfig((current) => {
      if (current.key !== key) {
        return { key, direction: "asc" };
      }
      if (current.direction === "asc") {
        return { key, direction: "desc" };
      }
      if (current.direction === "desc") {
        return { key: "", direction: null };
      }
      return { key, direction: "asc" };
    });
  };

  const sortedData = useMemo(() => {
    if (!data || !sortConfig.key || !sortConfig.direction) {
      return data || [];
    }

    return [...data].sort((a, b) => {
      const aValue = getNestedValue(a, sortConfig.key);
      const bValue = getNestedValue(b, sortConfig.key);

      // Handle null/undefined
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return sortConfig.direction === "asc" ? 1 : -1;
      if (bValue == null) return sortConfig.direction === "asc" ? -1 : 1;

      // Handle dates
      if (isDateString(aValue) && isDateString(bValue)) {
        const dateA = new Date(aValue).getTime();
        const dateB = new Date(bValue).getTime();
        return sortConfig.direction === "asc" ? dateA - dateB : dateB - dateA;
      }

      // Handle numbers
      if (typeof aValue === "number" && typeof bValue === "number") {
        return sortConfig.direction === "asc" ? aValue - bValue : bValue - aValue;
      }

      // Handle strings (A-Z) with natural-numeric collation so embedded
      // numbers compare numerically: "Class 2" < "Class 10" and
      // "Student 2" < "Student 10". Plain localeCompare gives lexical
      // order ("Class 10" < "Class 2"), which broke the seeded SDRL
      // student roster — see Class 1 B Student 9 → Class 10 A Student 1
      // mid-page jump on the All Students screen.
      const stringA = String(aValue);
      const stringB = String(bValue);
      const opts: Intl.CollatorOptions = { numeric: true, sensitivity: "base" };

      if (sortConfig.direction === "asc") {
        return stringA.localeCompare(stringB, undefined, opts);
      }
      return stringB.localeCompare(stringA, undefined, opts);
    });
  }, [data, sortConfig]);

  return {
    sortedData,
    sortConfig,
    handleSort,
    setSortConfig,
  };
}

function getNestedValue(obj: any, path: string): any {
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}

function isDateString(value: any): boolean {
  if (typeof value !== "string") return false;
  // Check for ISO date format or common date patterns
  const datePattern = /^\d{4}-\d{2}-\d{2}|^\d{4}-\d{2}-\d{2}T/;
  return datePattern.test(value);
}
