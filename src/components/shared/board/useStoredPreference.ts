import { useCallback, useState } from "react";

/**
 * Read a string preference from localStorage, falling back when the key is
 * missing, unreadable (private mode, blocked storage) or holds a value that is
 * no longer in the allowed set.
 */
export function readStoredPreference<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  } catch {
    // Storage unavailable: the fallback is the answer.
  }
  return fallback;
}

export function writeStoredPreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Best effort only. A preference that does not persist is not an error.
  }
}

/**
 * `useState` backed by localStorage for a small enumerated preference (view
 * mode, sort order). Reads once on mount; every set writes through.
 */
export function useStoredPreference<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => readStoredPreference(key, allowed, fallback));

  const set = useCallback(
    (next: T) => {
      setValue(next);
      writeStoredPreference(key, next);
    },
    [key],
  );

  return [value, set];
}
