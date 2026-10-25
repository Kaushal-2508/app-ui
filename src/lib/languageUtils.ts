/**
 * Language detection utilities for Hindi (Devanagari) script
 * Automatically detects if text is written in Hindi based on character analysis
 */

// Devanagari Unicode range: U+0900 to U+097F
const DEVANAGARI_PATTERN = /[\u0900-\u097F]/;

/**
 * Checks if the given text contains Hindi (Devanagari) characters
 * @param text - The text to check
 * @returns true if the text contains Devanagari characters
 */
export function isHindiText(text: string | null | undefined): boolean {
  if (!text) return false;
  return DEVANAGARI_PATTERN.test(text);
}

/**
 * Checks if the text is predominantly Hindi (more than 50% Devanagari characters)
 * @param text - The text to check
 * @returns true if the text is predominantly Hindi
 */
export function isPredominantlyHindi(text: string | null | undefined): boolean {
  if (!text) return false;
  
  const chars = text.replace(/\s/g, '').split('');
  if (chars.length === 0) return false;
  
  const hindiChars = chars.filter(char => DEVANAGARI_PATTERN.test(char));
  return hindiChars.length > chars.length / 2;
}

/**
 * Extracts English and Hindi parts from text
 * Supports separators: | / - or automatic detection
 * @param text - The text to parse
 * @returns Object with english and hindi properties (null if not found)
 */
export function extractLanguages(text: string | null | undefined): {
  english: string | null;
  hindi: string | null;
} {
  if (!text || !text.trim()) {
    return { english: null, hindi: null };
  }

  const trimmed = text.trim();

  // Check for common separators (| / -)
  const separatorMatch = trimmed.match(/^(.+?)\s*[|\/\-]\s*(.+)$/);
  
  if (separatorMatch) {
    const [, part1, part2] = separatorMatch;
    const isFirstHindi = isHindiText(part1);
    const isSecondHindi = isHindiText(part2);
    
    // If both parts have distinct languages
    if (isFirstHindi !== isSecondHindi) {
      return {
        english: isFirstHindi ? part2.trim() : part1.trim(),
        hindi: isFirstHindi ? part1.trim() : part2.trim(),
      };
    }
  }

  // No separator or same language in both parts - use auto-detection
  if (isHindiText(trimmed)) {
    return { english: null, hindi: trimmed };
  }
  
  return { english: trimmed, hindi: null };
}

/**
 * Gets the display name, preferring English but falling back to Hindi
 * @param english - The English name
 * @param hindi - The Hindi name
 * @param fallback - Fallback if both are null
 * @returns The best display name
 */
export function getDisplayName(
  english: string | null | undefined,
  hindi: string | null | undefined,
  fallback: string = 'Unnamed'
): string {
  return english || hindi || fallback;
}

/**
 * Gets both names for display, formatted as "English (Hindi)" or just one if other is missing
 * @param english - The English name
 * @param hindi - The Hindi name
 * @returns Formatted display string
 */
export function getFullDisplayName(
  english: string | null | undefined,
  hindi: string | null | undefined
): string {
  if (english && hindi) {
    return `${english} (${hindi})`;
  }
  return english || hindi || 'Unnamed';
}

/**
 * Determines which database fields to populate based on auto-detected language
 * @param name - The input name to analyze
 * @returns Object with name and name_hindi fields for database
 */
export function getNameFieldsForDb(name: string): {
  name: string | null;
  name_hindi: string | null;
} {
  const { english, hindi } = extractLanguages(name);
  return {
    name: english,
    name_hindi: hindi,
  };
}

/**
 * Determines which database fields to populate for topics
 * @param topicName - The input topic name
 * @returns Object with topic_name and topic_name_hindi fields
 */
export function getTopicFieldsForDb(topicName: string): {
  topic_name: string | null;
  topic_name_hindi: string | null;
} {
  const { english, hindi } = extractLanguages(topicName);
  return {
    topic_name: english,
    topic_name_hindi: hindi,
  };
}
