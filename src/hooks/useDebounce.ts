import { useState, useEffect } from "react";

/**
 * Debounces a value by the specified delay.
 * Useful for search inputs to reduce API calls.
 * 
 * @param value - The value to debounce
 * @param delay - Delay in milliseconds (default: 300ms)
 * @returns The debounced value
 * 
 * @example
 * const [search, setSearch] = useState("");
 * const debouncedSearch = useDebounce(search, 300);
 * 
 * // Use debouncedSearch in your query
 * useQuery({
 *   queryKey: ["users", debouncedSearch],
 *   queryFn: () => fetchUsers(debouncedSearch),
 * });
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}
