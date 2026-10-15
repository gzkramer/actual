import type { CategorySuggestion } from './types';

/**
 * The category to apply automatically, or null when the top suggestion is
 * below the threshold or is "Uncategorized".
 */
export function pickConfidentCategory(
  suggestions: CategorySuggestion[],
  threshold: number,
) {
  const top = suggestions[0];
  if (top && top.categoryId != null && top.confidence >= threshold) {
    return top.categoryId;
  }
  return null;
}
