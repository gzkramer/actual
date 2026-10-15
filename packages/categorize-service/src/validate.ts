import type { CategorySuggestion, ClassifyCategory } from './contract';
import { UNCATEGORIZED_LABEL } from './limits';

function stripFences(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(stripFences(text));
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates one ranked array from Claude. Unknown categories are dropped,
 * confidences are clamped and renormalized to sum to 100. Returns null when
 * nothing usable is left.
 */
export function validateSuggestions(
  value: unknown,
  categories: ClassifyCategory[],
): CategorySuggestion[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const byName = new Map<string, ClassifyCategory | null>();
  for (const category of categories) {
    const key = category.name.trim().toLowerCase();
    if (!byName.has(key)) {
      byName.set(key, category);
    }
  }
  byName.set(UNCATEGORIZED_LABEL.toLowerCase(), null);

  const seen = new Set<string>();
  const suggestions: CategorySuggestion[] = [];

  for (const item of value) {
    if (!isRecord(item) || typeof item.category !== 'string') {
      continue;
    }
    const key = item.category.trim().toLowerCase();
    if (!byName.has(key) || seen.has(key)) {
      continue;
    }
    const raw = Number(item.confidence_percentage);
    if (!Number.isFinite(raw)) {
      continue;
    }
    seen.add(key);

    const match = byName.get(key) ?? null;
    suggestions.push({
      category: match ? match.name : UNCATEGORIZED_LABEL,
      categoryId: match ? match.id : null,
      confidence: Math.min(100, Math.max(0, Math.round(raw))),
      rationale: typeof item.rationale === 'string' ? item.rationale : '',
    });
  }

  if (suggestions.length === 0) {
    return null;
  }

  const total = suggestions.reduce((sum, s) => sum + s.confidence, 0);
  if (total === 0) {
    return null;
  }
  if (total !== 100) {
    for (const suggestion of suggestions) {
      suggestion.confidence = Math.round((suggestion.confidence / total) * 100);
    }
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence);
}

export function parseSingleResponse(
  text: string,
  categories: ClassifyCategory[],
) {
  return validateSuggestions(parseJson(text), categories);
}

/**
 * Parses a batch response keyed by transaction id. Ids that are missing or
 * invalid are left out of the result so the caller can retry them.
 */
export function parseBatchResponse(
  text: string,
  ids: string[],
  categories: ClassifyCategory[],
) {
  const results = new Map<string, CategorySuggestion[]>();
  const parsed = parseJson(text);
  if (!isRecord(parsed)) {
    return results;
  }

  for (const id of ids) {
    const suggestions = validateSuggestions(parsed[id], categories);
    if (suggestions) {
      results.set(id, suggestions);
    }
  }
  return results;
}
