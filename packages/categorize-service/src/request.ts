import type {
  ClassifyCategory,
  ClassifyRequest,
  ClassifyTransaction,
} from './contract';
import {
  MAX_BATCH_SIZE,
  MAX_CATEGORIES,
  MAX_CATEGORY_NAME_LENGTH,
  MAX_CURRENCY_SYMBOL_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_ID_LENGTH,
} from './limits';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH
  );
}

function parseTransaction(value: unknown): ClassifyTransaction | null {
  if (
    !isRecord(value) ||
    !isId(value.id) ||
    typeof value.description !== 'string' ||
    typeof value.amount !== 'number' ||
    !Number.isSafeInteger(value.amount)
  ) {
    return null;
  }
  return {
    id: value.id,
    // Long descriptions are truncated rather than rejected.
    description: value.description.slice(0, MAX_DESCRIPTION_LENGTH),
    amount: value.amount,
  };
}

function parseCategory(value: unknown): ClassifyCategory | null {
  if (
    !isRecord(value) ||
    !isId(value.id) ||
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    value.name.length > MAX_CATEGORY_NAME_LENGTH
  ) {
    return null;
  }
  return { id: value.id, name: value.name };
}

function hasUniqueIds(items: Array<{ id: string }>) {
  return new Set(items.map(item => item.id)).size === items.length;
}

/**
 * Validates a POST /v1/classify body. Returns null when anything is out of
 * shape or over a limit.
 */
export function parseClassifyRequest(body: unknown): ClassifyRequest | null {
  if (
    !isRecord(body) ||
    !Array.isArray(body.transactions) ||
    !Array.isArray(body.categories)
  ) {
    return null;
  }
  if (
    body.transactions.length < 1 ||
    body.transactions.length > MAX_BATCH_SIZE ||
    body.categories.length < 1 ||
    body.categories.length > MAX_CATEGORIES
  ) {
    return null;
  }

  const transactions: ClassifyTransaction[] = [];
  for (const item of body.transactions) {
    const transaction = parseTransaction(item);
    if (!transaction) {
      return null;
    }
    transactions.push(transaction);
  }

  const categories: ClassifyCategory[] = [];
  for (const item of body.categories) {
    const category = parseCategory(item);
    if (!category) {
      return null;
    }
    categories.push(category);
  }

  if (!hasUniqueIds(transactions) || !hasUniqueIds(categories)) {
    return null;
  }

  const { currencySymbol } = body;
  if (currencySymbol !== undefined) {
    if (
      typeof currencySymbol !== 'string' ||
      currencySymbol.length > MAX_CURRENCY_SYMBOL_LENGTH
    ) {
      return null;
    }
    return { transactions, categories, currencySymbol };
  }
  return { transactions, categories };
}
