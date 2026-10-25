import { useEffect, useState } from "react";

/**
 * Multilingual greetings cycled in dashboard h1s. Sequence chosen for visual
 * variety across scripts (Latin, Devanagari, CJK, Cyrillic, Gurmukhi, Arabic).
 */
export const GREETINGS = [
  "Hello",
  "नमस्ते",
  "Hola",
  "Hallo",
  "Bonjour",
  "こんにちは",
  "ਸਤ ਸ੍ਰੀ ਅਕਾਲ",
  "नमस्कार",
  "Ciao",
  "Olá",
  "안녕하세요",
  "Merhaba",
  "Привет",
  "你好",
  "Sawadee",
] as const;

/**
 * Returns a greeting string that rotates through GREETINGS every
 * `intervalMs` (default 5s). Used by every role's dashboard h1 so the
 * portal feels welcoming and multilingual without being noisy.
 */
export function useRotatingGreeting(intervalMs = 5_000): string {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((prev) => (prev + 1) % GREETINGS.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return GREETINGS[index];
}
