import * as connection from '#platform/server/connection';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { PostError } from '#server/errors';
import { post } from '#server/post';
import { setServer } from '#server/server-config';

import { app } from './app';
import { DEFAULT_CATEGORY_NAMES, DEFAULT_GROUP_NAME } from './defaults';

vi.mock('#server/post', () => ({ post: vi.fn() }));
vi.mock('#platform/server/connection', () => ({ send: vi.fn() }));
const storage = vi.hoisted(() => ({ userToken: 'token' as string | null }));

vi.mock('#platform/server/asyncStorage', () => ({
  getItem: vi.fn(async (key: string) =>
    key === 'user-token' ? storage.userToken : null,
  ),
}));

const handlers = app.handlers;

async function enableFlag() {
  await db.update('preferences', {
    id: 'flags.smartCategorization',
    value: 'true',
  });
}

async function insertTransaction(id: string, amount: number) {
  return await db.insertTransaction({
    id,
    account: 'account-1',
    date: '2024-01-01',
    amount,
    imported_payee: `Payee ${id}`,
  });
}

async function getCategoryId(id: string) {
  const row = await db.first<{ category: string | null }>(
    'SELECT category FROM transactions WHERE id = ?',
    [id],
  );
  return row?.category ?? null;
}

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  vi.mocked(post).mockReset();
  vi.mocked(connection.send).mockReset();
  storage.userToken = 'token';
});

describe('smart-categorize/status', () => {
  beforeEach(() => {
    setServer('http://localhost:5006');
  });

  it('reports what the sync server says', async () => {
    vi.mocked(post).mockResolvedValueOnce({ configured: true });

    expect(await handlers['smart-categorize/status']()).toEqual({
      configured: true,
    });
    expect(vi.mocked(post).mock.calls[0][0]).toBe(
      'http://localhost:5006/smart-categorize/status',
    );
  });

  it('reads a failed check as not configured', async () => {
    vi.mocked(post).mockRejectedValueOnce(new PostError('network-failure'));

    expect(await handlers['smart-categorize/status']()).toEqual({
      configured: false,
    });
  });

  it('is not configured when not logged in', async () => {
    storage.userToken = null;

    expect(await handlers['smart-categorize/status']()).toEqual({
      configured: false,
    });
    expect(post).not.toHaveBeenCalled();
  });
});

describe('smart-categorize/seed-defaults', () => {
  it('creates the Smart Categories group once', async () => {
    await handlers['smart-categorize/seed-defaults']();
    await handlers['smart-categorize/seed-defaults']();

    const groups = await db.all<{ id: string; name: string }>(
      'SELECT id, name FROM category_groups WHERE tombstone = 0 AND name = ?',
      [DEFAULT_GROUP_NAME],
    );
    expect(groups).toHaveLength(1);

    const names = (
      await db.all<{ name: string }>(
        'SELECT name FROM categories WHERE tombstone = 0 AND cat_group = ?',
        [groups[0].id],
      )
    ).map(c => c.name);
    expect(names.sort()).toEqual([...DEFAULT_CATEGORY_NAMES].sort());
  });

  it('skips names that already exist', async () => {
    const groupId = await db.insertCategoryGroup({ name: 'Food' });
    await db.insertCategory({ name: 'groceries', cat_group: groupId });

    await handlers['smart-categorize/seed-defaults']();

    const groceries = await db.all<{ id: string }>(
      "SELECT id FROM categories WHERE tombstone = 0 AND LOWER(name) = 'groceries'",
    );
    expect(groceries).toHaveLength(1);
  });

  it('does not reseed after the categories are deleted', async () => {
    await handlers['smart-categorize/seed-defaults']();
    db.runQuery('UPDATE categories SET tombstone = 1');
    await handlers['smart-categorize/seed-defaults']();

    const remaining = await db.all(
      'SELECT id FROM categories WHERE tombstone = 0',
    );
    expect(remaining).toHaveLength(0);
  });
});

describe('smart-categorize/suggest-batch', () => {
  let groceriesId: string;
  let diningId: string;

  function suggestion(categoryId: string, confidence: number) {
    return {
      category: categoryId === groceriesId ? 'Groceries' : 'Dining Out',
      categoryId,
      confidence,
      rationale: '',
    };
  }

  function reply(results: Record<string, unknown>, failed: string[] = []) {
    return { results, failed, model: 'test-model' };
  }

  beforeEach(async () => {
    await enableFlag();
    await db.insertAccount({ id: 'account-1', name: 'Checking' });
    const groupId = await db.insertCategoryGroup({ name: 'Expenses' });
    groceriesId = await db.insertCategory({
      name: 'Groceries',
      cat_group: groupId,
    });
    diningId = await db.insertCategory({
      name: 'Dining Out',
      cat_group: groupId,
    });

    setServer('http://localhost:5006');
  });

  it('applies confident results and stores the rest', async () => {
    await insertTransaction('t1', -1000);
    await insertTransaction('t2', -2000);

    vi.mocked(post).mockResolvedValueOnce(
      reply({
        t1: [suggestion(groceriesId, 90), suggestion(diningId, 10)],
        t2: [suggestion(diningId, 55), suggestion(groceriesId, 45)],
      }),
    );

    const result = await handlers['smart-categorize/suggest-batch']({
      ids: ['t1', 't2'],
    });

    expect(result).toEqual({ categorized: 1, needsReview: 1, failed: 0 });
    expect(await getCategoryId('t1')).toBe(groceriesId);
    expect(await getCategoryId('t2')).toBeNull();

    const suggestions = await handlers['smart-categorize/get-suggestions']({
      ids: ['t1', 't2'],
    });
    expect(Object.keys(suggestions)).toEqual(['t2']);
    expect(suggestions.t2[0]).toMatchObject({
      category: 'Dining Out',
      confidence: 55,
    });
  });

  it('sends each chunk with its allowed categories to the service', async () => {
    await insertTransaction('t1', -1000);

    vi.mocked(post).mockResolvedValueOnce(
      reply({ t1: [suggestion(groceriesId, 100)] }),
    );

    await handlers['smart-categorize/suggest-batch']({ ids: ['t1'] });

    const [url, data, headers] = vi.mocked(post).mock.calls[0];
    expect(url).toBe('http://localhost:5006/smart-categorize/classify');
    expect(data).toEqual({
      transactions: [{ id: 't1', description: 'Payee t1', amount: -1000 }],
      categories: expect.arrayContaining([
        { id: groceriesId, name: 'Groceries' },
        { id: diningId, name: 'Dining Out' },
      ]),
    });
    expect(headers).toEqual({ 'X-ACTUAL-TOKEN': 'token' });
  });

  it('counts ids the service could not classify as failed', async () => {
    await insertTransaction('t1', -1000);
    await insertTransaction('t2', -1000);

    vi.mocked(post).mockResolvedValueOnce(
      reply({ t1: [suggestion(groceriesId, 100)] }, ['t2']),
    );

    const result = await handlers['smart-categorize/suggest-batch']({
      ids: ['t1', 't2'],
    });

    expect(result).toEqual({ categorized: 1, needsReview: 0, failed: 1 });
  });

  it('applies results batch by batch and reports progress', async () => {
    const ids = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'];
    for (const id of ids) {
      await insertTransaction(id, -1000);
    }

    vi.mocked(post).mockImplementation(async (_url, data) => {
      const { transactions } = data as { transactions: Array<{ id: string }> };
      return reply(
        Object.fromEntries(
          transactions.map(t => [t.id, [suggestion(groceriesId, 100)]]),
        ),
      );
    });

    const result = await handlers['smart-categorize/suggest-batch']({ ids });

    expect(result).toEqual({ categorized: 7, needsReview: 0, failed: 0 });
    expect(post).toHaveBeenCalledTimes(2);
    const progress = vi
      .mocked(connection.send)
      .mock.calls.filter(([name]) => name === 'smart-categorize-progress')
      .map(([, event]) => event);
    expect(progress).toHaveLength(2);
    expect(progress.at(-1)).toEqual({
      processed: 7,
      total: 7,
      categorized: 7,
      needsReview: 0,
    });
  });

  it('keeps going when one chunk times out', async () => {
    const ids = ['t1', 't2', 't3', 't4', 't5', 't6'];
    for (const id of ids) {
      await insertTransaction(id, -1000);
    }

    vi.mocked(post).mockImplementation(async (_url, data) => {
      const { transactions } = data as { transactions: Array<{ id: string }> };
      if (transactions.some(t => t.id === 't1')) {
        throw new PostError('timeout');
      }
      return reply(
        Object.fromEntries(
          transactions.map(t => [t.id, [suggestion(groceriesId, 100)]]),
        ),
      );
    });

    const result = await handlers['smart-categorize/suggest-batch']({ ids });

    expect(result).toEqual({ categorized: 1, needsReview: 0, failed: 5 });
  });

  it('stops the run when the service is unavailable', async () => {
    await insertTransaction('t1', -1000);

    vi.mocked(post).mockRejectedValue(new PostError('service-unavailable'));

    const result = await handlers['smart-categorize/suggest-batch']({
      ids: ['t1'],
    });

    expect(result).toEqual({
      categorized: 0,
      needsReview: 0,
      failed: 1,
      error: 'service-unavailable',
    });
  });

  it('stops the run before setup is done', async () => {
    await insertTransaction('t1', -1000);

    vi.mocked(post).mockRejectedValue(new PostError('not-configured'));

    const result = await handlers['smart-categorize/suggest-batch']({
      ids: ['t1'],
    });

    expect(result.error).toBe('not-configured');
  });

  it('does nothing when the flag is off', async () => {
    await db.update('preferences', {
      id: 'flags.smartCategorization',
      value: 'false',
    });
    await insertTransaction('t1', -1000);

    const result = await handlers['smart-categorize/suggest-batch']({
      ids: ['t1'],
    });

    expect(result.error).toBe('disabled');
    expect(post).not.toHaveBeenCalled();
  });
});

describe('smart-categorize/uncategorized-ids', () => {
  it('returns uncategorized on-budget transactions for an account', async () => {
    await db.insertAccount({ id: 'account-1', name: 'Checking' });
    await db.insertAccount({ id: 'account-2', name: 'Savings' });
    const groupId = await db.insertCategoryGroup({ name: 'Expenses' });
    const categoryId = await db.insertCategory({
      name: 'Groceries',
      cat_group: groupId,
    });

    await insertTransaction('t1', -1000);
    await db.insertTransaction({
      id: 't2',
      account: 'account-1',
      date: '2024-01-01',
      amount: -500,
      category: categoryId,
    });
    await db.insertTransaction({
      id: 't3',
      account: 'account-2',
      date: '2024-01-01',
      amount: -500,
    });

    expect(
      await handlers['smart-categorize/uncategorized-ids']({
        accountId: 'account-1',
      }),
    ).toEqual(['t1']);
    expect(
      (await handlers['smart-categorize/uncategorized-ids']({})).sort(),
    ).toEqual(['t1', 't3']);
  });
});
