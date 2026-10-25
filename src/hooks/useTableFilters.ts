import { useState, useMemo, useCallback } from "react";

export interface ColumnFilter {
  key: string;
  value: string;
}

export interface UseTableFiltersResult<T> {
  filters: ColumnFilter[];
  setFilter: (key: string, value: string) => void;
  clearFilter: (key: string) => void;
  clearAllFilters: () => void;
  getFilterValue: (key: string) => string;
  filteredData: T[];
  hasActiveFilters: boolean;
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : null;
  }, obj);
}

export function useTableFilters<T>(
  data: T[],
  customFilterFn?: (item: T, filters: ColumnFilter[]) => boolean
): UseTableFiltersResult<T> {
  const [filters, setFilters] = useState<ColumnFilter[]>([]);

  const setFilter = useCallback((key: string, value: string) => {
    setFilters((prev) => {
      const existing = prev.findIndex((f) => f.key === key);
      if (value === "") {
        // Remove filter if value is empty
        return existing >= 0 ? prev.filter((f) => f.key !== key) : prev;
      }
      if (existing >= 0) {
        // Update existing filter
        const newFilters = [...prev];
        newFilters[existing] = { key, value };
        return newFilters;
      }
      // Add new filter
      return [...prev, { key, value }];
    });
  }, []);

  const clearFilter = useCallback((key: string) => {
    setFilters((prev) => prev.filter((f) => f.key !== key));
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters([]);
  }, []);

  const getFilterValue = useCallback(
    (key: string) => {
      return filters.find((f) => f.key === key)?.value || "";
    },
    [filters]
  );

  const filteredData = useMemo(() => {
    if (filters.length === 0) return data;

    return data.filter((item) => {
      if (customFilterFn) {
        return customFilterFn(item, filters);
      }

      // Default filter behavior: check if all filters match
      return filters.every((filter) => {
        const value = getNestedValue(item, filter.key);
        if (value === null || value === undefined) return false;
        
        const stringValue = String(value).toLowerCase();
        const filterValue = filter.value.toLowerCase();
        
        // Check for exact match or partial match
        return stringValue.includes(filterValue) || stringValue === filterValue;
      });
    });
  }, [data, filters, customFilterFn]);

  const hasActiveFilters = filters.length > 0;

  return {
    filters,
    setFilter,
    clearFilter,
    clearAllFilters,
    getFilterValue,
    filteredData,
    hasActiveFilters,
  };
}