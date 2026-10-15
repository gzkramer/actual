import * as asyncStorage from '#platform/server/asyncStorage';
import * as connection from '#platform/server/connection';
import { logger } from '#platform/server/log';
import { createApp } from '#server/app';
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { PostError } from '#server/errors';
import { runMutator } from '#server/mutators';
import { post } from '#server/post';
import { getServer } from '#server/server-config';
import { batchMessages } from '#server/sync';
import { batchUpdateTransactions } from '#server/transactions';
import { withUndo } from '#server/undo';
import { q } from '#shared/query';
import type { AccountEntity } from '#types/models';

import {
  BATCH_SIZE,
  CONFIDENCE_THRESHOLD,
  DEFAULT_CATEGORY_NAMES,
  DEFAULT_GROUP_NAME,
  DEFAULTS_SEEDED_PREF,
  MAX_CONCURRENT_BATCHES,
} from './defaults';
import { pickConfidentCategory } from './threshold';
import type {
  AllowedCategory,
  CategorySuggestion,
  ClassifiableTransaction,
  ClassifyRequest,
  ClassifyResponseData,
  SmartCategorizeResult,
} from './types';

export type SmartCategorizeHandlers = {
  'smart-categorize/status': typeof getStatus;
  'smart-categorize/suggest-one': typeof suggestOne;
  'smart-categorize/suggest-batch': typeof suggestBatch;
  'smart-categorize/uncategorized-ids': typeof getUncategorizedIds;
  'smart-categorize/get-suggestions': typeof getSuggestions;
  'smart-categorize/clear': typeof clearSuggestion;
  'smart-categorize/seed-defaults': typeof seedDefaults;
};

export const app = createApp<SmartCategorizeHandlers>();

app.method('smart-categorize/status', getStatus);
app.method('smart-categorize/suggest-one', suggestOne);
app.method('smart-categorize/suggest-batch', suggestBatch);
app.method('smart-categorize/uncategorized-ids', getUncategorizedIds);
app.method('smart-categorize/get-suggestions', getSuggestions);
app.method('smart-categorize/clear', clearSuggestion);
app.method('smart-categorize/seed-defaults', seedDefaults);

app.events.on('load-budget', () => {
  void seedDefaultsIfNeeded();
});

// Slightly above the sync server's own wait for the categorize service, so
// its timeout error arrives before ours.
const CLASSIFY_TIMEOUT_MS = 300 * 1000;
const BUSY_RETRIES = 2;
const BUSY_RETRY_DELAY_MS = 5 * 1000;

class SmartCategorizeError extends Error {}

// Errors that only affect the chunk that hit them. Anything else (no server,
// service down, not logged in) will fail the same way for every chunk, so
// the run stops.
function isChunkError(err: unknown) {
  return (
    err instanceof SmartCategorizeError &&
    (err.message === 'timeout' || err.message === 'provider-error')
  );
}

async function isEnabled() {
  const row = await db.first<Pick<db.DbPreference, 'value'>>(
    'SELECT value FROM preferences WHERE id = ?',
    ['flags.smartCategorization'],
  );
  return row?.value === 'true';
}

async function getAllowedCategories(includeIncome: boolean) {
  const rows = await db.all<{ id: string; name: string; is_income: 1 | 0 }>(
    `SELECT c.id, c.name, c.is_income FROM categories c
     JOIN category_groups g ON g.id = c.cat_group
     WHERE c.tombstone = 0 AND g.tombstone = 0
       AND COALESCE(c.hidden, 0) = 0 AND COALESCE(g.hidden, 0) = 0
     ORDER BY g.sort_order, c.sort_order`,
  );
  return rows
    .filter(row => includeIncome || row.is_income === 0)
    .map(({ id, name }) => ({ id, name }) satisfies AllowedCategory);
}

async function getTransactions(ids: string[]) {
  if (ids.length === 0) {
    return [];
  }
  const { data } = await aqlQuery(
    q('transactions')
      .filter({ id: { $oneof: ids }, is_parent: false })
      .select([
        'id',
        'amount',
        'imported_payee',
        'notes',
        { payee_name: 'payee.name' },
      ])
      .options({ splits: 'all' }),
  );
  return (
    data as Array<{
      id: string;
      amount: number;
      imported_payee: string | null;
      notes: string | null;
      payee_name: string | null;
    }>
  ).map(
    row =>
      ({
        id: row.id,
        description:
          row.payee_name || row.imported_payee || row.notes || '(no payee)',
        amount: row.amount,
      }) satisfies ClassifiableTransaction,
  );
}

const KNOWN_ERRORS = [
  'not-configured',
  'busy',
  'timeout',
  'provider-error',
  'provider-unavailable',
  'service-unavailable',
  'network-failure',
  'token-expired',
  'unauthorized',
];

/**
 * Whether the sync server has a Claude token saved and knows where the
 * categorize service is. Any failure reads as not configured.
 */
async function getStatus(): Promise<{ configured: boolean }> {
  const server = getServer();
  const userToken = await asyncStorage.getItem('user-token');
  if (!server || !userToken) {
    return { configured: false };
  }

  try {
    const data = (await post(
      server.SMART_CATEGORIZE_SERVER + '/status',
      {},
      { 'X-ACTUAL-TOKEN': userToken },
    )) as { configured?: boolean };
    return { configured: data?.configured === true };
  } catch (err) {
    logger.warn('Smart categorize status check failed', err);
    return { configured: false };
  }
}

async function requestClassification(
  chunk: ClassifiableTransaction[],
  categories: AllowedCategory[],
) {
  const server = getServer();
  if (!server) {
    throw new SmartCategorizeError('no-server');
  }
  const userToken = await asyncStorage.getItem('user-token');
  if (!userToken) {
    throw new SmartCategorizeError('not-logged-in');
  }

  try {
    return (await post(
      server.SMART_CATEGORIZE_SERVER + '/classify',
      { transactions: chunk, categories } satisfies ClassifyRequest,
      { 'X-ACTUAL-TOKEN': userToken },
      CLASSIFY_TIMEOUT_MS,
    )) as ClassifyResponseData;
  } catch (err) {
    if (err instanceof PostError) {
      throw new SmartCategorizeError(
        KNOWN_ERRORS.includes(err.reason) ? err.reason : 'not-enabled',
      );
    }
    throw err;
  }
}

/**
 * Classifies one chunk through the categorize service, which handles the
 * prompt, the model call, validation and per-transaction retries. A chunk
 * that times out or fails at the model comes back empty so the run can go on.
 */
async function classifyChunk(
  chunk: ClassifiableTransaction[],
  categories: AllowedCategory[],
) {
  for (let attempt = 0; ; attempt++) {
    try {
      const data = await requestClassification(chunk, categories);
      return new Map(Object.entries(data.results));
    } catch (err) {
      if (
        err instanceof SmartCategorizeError &&
        err.message === 'busy' &&
        attempt < BUSY_RETRIES
      ) {
        await new Promise(resolve => setTimeout(resolve, BUSY_RETRY_DELAY_MS));
        continue;
      }
      if (!isChunkError(err)) {
        throw err;
      }
      logger.warn('Smart categorize chunk failed', err);
      return new Map<string, CategorySuggestion[]>();
    }
  }
}

type ChunkHandler = (
  chunk: ClassifiableTransaction[],
  results: Map<string, CategorySuggestion[]>,
) => Promise<void>;

async function classifyMany(
  transactions: ClassifiableTransaction[],
  onChunk: ChunkHandler,
) {
  // Income categories are only offered for money coming in, so inflows and
  // outflows are batched separately.
  const groups = [
    { items: transactions.filter(t => t.amount > 0), includeIncome: true },
    { items: transactions.filter(t => t.amount <= 0), includeIncome: false },
  ];

  const tasks: Array<() => Promise<void>> = [];
  for (const { items, includeIncome } of groups) {
    if (items.length === 0) {
      continue;
    }
    const categories = await getAllowedCategories(includeIncome);
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const chunk = items.slice(i, i + BATCH_SIZE);
      tasks.push(async () => {
        await onChunk(chunk, await classifyChunk(chunk, categories));
      });
    }
  }

  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const task = tasks[next++];
      await task();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_BATCHES, tasks.length) }, () =>
      worker(),
    ),
  );
}

async function applyResults(
  transactions: ClassifiableTransaction[],
  results: Map<string, CategorySuggestion[]>,
): Promise<SmartCategorizeResult> {
  const updated: Array<{ id: string; category: string }> = [];
  const lowConfidence: Array<[string, CategorySuggestion[]]> = [];

  for (const transaction of transactions) {
    const suggestions = results.get(transaction.id);
    if (!suggestions) {
      continue;
    }
    const categoryId = pickConfidentCategory(suggestions, CONFIDENCE_THRESHOLD);
    if (categoryId) {
      updated.push({ id: transaction.id, category: categoryId });
    } else {
      lowConfidence.push([transaction.id, suggestions]);
    }
  }

  const now = Date.now();
  db.transaction(() => {
    for (const { id } of updated) {
      db.runQuery(
        'DELETE FROM smart_categorize_suggestions WHERE transaction_id = ?',
        [id],
      );
    }
    for (const [id, suggestions] of lowConfidence) {
      db.runQuery(
        `INSERT OR REPLACE INTO smart_categorize_suggestions
           (transaction_id, suggestions, created_at) VALUES (?, ?, ?)`,
        [id, JSON.stringify(suggestions), now],
      );
    }
  });

  if (updated.length > 0) {
    await runMutator(() =>
      withUndo(() => batchUpdateTransactions({ updated })),
    );
  }

  return {
    categorized: updated.length,
    needsReview: lowConfidence.length,
    failed: transactions.length - updated.length - lowConfidence.length,
  };
}

async function run(
  ids: string[],
  classify: (
    transactions: ClassifiableTransaction[],
    onChunk: ChunkHandler,
  ) => Promise<void>,
): Promise<SmartCategorizeResult> {
  if (!(await isEnabled())) {
    return { categorized: 0, needsReview: 0, failed: 0, error: 'disabled' };
  }

  const transactions = await getTransactions(ids);
  const totals = { categorized: 0, needsReview: 0 };
  let processed = 0;

  // Each chunk is applied as soon as the service answers, and the client is told
  // so it can refresh without waiting for the whole run.
  async function onChunk(
    chunk: ClassifiableTransaction[],
    results: Map<string, CategorySuggestion[]>,
  ) {
    const result = await applyResults(chunk, results);
    totals.categorized += result.categorized;
    totals.needsReview += result.needsReview;
    processed += chunk.length;
    connection.send('smart-categorize-progress', {
      processed,
      total: transactions.length,
      categorized: totals.categorized,
      needsReview: totals.needsReview,
    });
  }

  let error: string | undefined;
  try {
    await classify(transactions, onChunk);
  } catch (err) {
    if (!(err instanceof SmartCategorizeError)) {
      throw err;
    }
    error = err.message;
  }

  return {
    ...totals,
    failed: transactions.length - totals.categorized - totals.needsReview,
    ...(error ? { error } : {}),
  };
}

async function suggestOne({
  id,
}: {
  id: string;
}): Promise<SmartCategorizeResult> {
  return run([id], async (transactions, onChunk) => {
    const transaction = transactions[0];
    if (transaction) {
      const categories = await getAllowedCategories(transaction.amount > 0);
      await onChunk(
        transactions,
        await classifyChunk(transactions, categories),
      );
    }
  });
}

async function suggestBatch({
  ids,
}: {
  ids: string[];
}): Promise<SmartCategorizeResult> {
  return run(ids, classifyMany);
}

async function getUncategorizedIds({
  accountId,
}: {
  accountId?: AccountEntity['id'];
}): Promise<string[]> {
  let query = q('transactions')
    .filter({
      'account.offbudget': false,
      category: null,
      is_parent: false,
      $or: [
        {
          'payee.transfer_acct.offbudget': true,
          'payee.transfer_acct': null,
        },
      ],
    })
    .options({ splits: 'inline' });
  if (accountId) {
    query = query.filter({ account: accountId });
  }
  const { data } = await aqlQuery(query.select('id'));
  return (data as Array<{ id: string }>).map(row => row.id);
}

async function getSuggestions({
  ids,
}: {
  ids: string[];
}): Promise<Record<string, CategorySuggestion[]>> {
  if (ids.length === 0 || !(await isEnabled())) {
    return {};
  }
  // Only uncategorized transactions keep showing their suggestions.
  const rows = await db.all<{ transaction_id: string; suggestions: string }>(
    `SELECT s.transaction_id, s.suggestions
     FROM smart_categorize_suggestions s
     JOIN transactions t ON t.id = s.transaction_id
     WHERE t.tombstone = 0 AND t.category IS NULL
       AND s.transaction_id IN (${ids.map(() => '?').join(', ')})`,
    ids,
  );

  const result: Record<string, CategorySuggestion[]> = {};
  for (const row of rows) {
    try {
      result[row.transaction_id] = JSON.parse(row.suggestions);
    } catch {
      // Ignore rows that can't be parsed; a re-run overwrites them.
    }
  }
  return result;
}

async function clearSuggestion({ id }: { id: string }) {
  db.runQuery(
    'DELETE FROM smart_categorize_suggestions WHERE transaction_id = ?',
    [id],
  );
}

async function seedDefaults() {
  const seeded = await db.first<Pick<db.DbPreference, 'value'>>(
    'SELECT value FROM preferences WHERE id = ?',
    [DEFAULTS_SEEDED_PREF],
  );
  if (seeded?.value === 'true') {
    return;
  }

  const existing = await db.all<{ name: string }>(
    'SELECT name FROM categories WHERE tombstone = 0',
  );
  const existingNames = new Set(existing.map(c => c.name.toLowerCase()));
  const missing = DEFAULT_CATEGORY_NAMES.filter(
    name => !existingNames.has(name.toLowerCase()),
  );

  await runMutator(() =>
    batchMessages(async () => {
      if (missing.length > 0) {
        const group = await db.first<{ id: string }>(
          'SELECT id FROM category_groups WHERE UPPER(name) = ? AND tombstone = 0',
          [DEFAULT_GROUP_NAME.toUpperCase()],
        );
        const groupId =
          group?.id ??
          (await db.insertCategoryGroup({
            name: DEFAULT_GROUP_NAME,
            is_income: 0,
          }));
        for (const name of missing) {
          await db.insertCategory(
            { name, cat_group: groupId, is_income: 0 },
            { atEnd: true },
          );
        }
      }
      await db.update('preferences', {
        id: DEFAULTS_SEEDED_PREF,
        value: 'true',
      });
    }),
  );
}

async function seedDefaultsIfNeeded() {
  try {
    if (await isEnabled()) {
      await seedDefaults();
    }
  } catch (err) {
    logger.warn('Failed to seed Smart Categories', err);
  }
}
