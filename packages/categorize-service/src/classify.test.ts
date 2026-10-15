import { describe, expect, it } from 'vitest';

import { classify } from './classify';
import { REQUEST_DEADLINE_MS } from './limits';
import { ProviderError } from './providers/provider';
import { categories, fakeProvider, ranked } from './testing';

const transactions = [
  { id: 't1', description: 'Kroger', amount: -1000 },
  { id: 't2', description: 'Chipotle', amount: -1250 },
];

describe('classify', () => {
  it('uses the single prompt for one transaction', async () => {
    const provider = fakeProvider(async () =>
      JSON.stringify(ranked('Groceries')),
    );

    const data = await classify(provider, {
      transactions: [transactions[0]],
      categories,
    });

    expect(data).toEqual({
      results: {
        t1: [
          {
            category: 'Groceries',
            categoryId: 'groceries',
            confidence: 100,
            rationale: 'r',
          },
        ],
      },
      failed: [],
      model: 'fake-model',
    });
    expect(provider.complete.mock.calls[0][0]).toContain(
      "Classify the following transaction: 'Kroger' for -$10.00.",
    );
  });

  it('uses the batch prompt and keeps every id it answers', async () => {
    const provider = fakeProvider(async () =>
      JSON.stringify({ t1: ranked('Groceries'), t2: ranked('Dining Out', 60) }),
    );

    const data = await classify(provider, { transactions, categories });

    expect(provider.complete).toHaveBeenCalledTimes(1);
    expect(data.results.t2[0]).toMatchObject({
      categoryId: 'dining',
      confidence: 60,
    });
    expect(data.failed).toEqual([]);
  });

  it('retries ids missing from the batch one at a time', async () => {
    const provider = fakeProvider(async prompt =>
      prompt.includes('Each line is')
        ? JSON.stringify({ t1: ranked('Groceries') })
        : JSON.stringify(ranked('Dining Out')),
    );

    const data = await classify(provider, { transactions, categories });

    expect(provider.complete).toHaveBeenCalledTimes(2);
    expect(provider.complete.mock.calls[1][0]).toContain("'Chipotle'");
    expect(Object.keys(data.results).sort()).toEqual(['t1', 't2']);
  });

  it('retries a single reply that will not parse, then gives up', async () => {
    const provider = fakeProvider(async () => 'not json');

    const data = await classify(provider, {
      transactions: [transactions[0]],
      categories,
    });

    expect(provider.complete).toHaveBeenCalledTimes(2);
    expect(data).toMatchObject({ results: {}, failed: ['t1'] });
  });

  it('falls back to single calls when the batch call fails', async () => {
    const provider = fakeProvider(async prompt => {
      if (prompt.includes('Each line is')) {
        throw new ProviderError('timeout', 'slow');
      }
      return JSON.stringify(ranked('Groceries'));
    });

    const data = await classify(provider, { transactions, categories });

    expect(data.failed).toEqual([]);
    expect(provider.complete).toHaveBeenCalledTimes(3);
  });

  it('reports partial failures in `failed`', async () => {
    const provider = fakeProvider(async prompt => {
      if (prompt.includes("'Chipotle'")) {
        throw new ProviderError('error', 'boom');
      }
      if (prompt.includes('Each line is')) {
        return '{}';
      }
      return JSON.stringify(ranked('Groceries'));
    });

    const data = await classify(provider, { transactions, categories });

    expect(Object.keys(data.results)).toEqual(['t1']);
    expect(data.failed).toEqual(['t2']);
  });

  it('throws the last error when nothing could be classified', async () => {
    const provider = fakeProvider(async () => {
      throw new ProviderError('timeout', 'slow');
    });

    await expect(
      classify(provider, { transactions, categories }),
    ).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('stops at once when the provider is unavailable', async () => {
    const provider = fakeProvider(async () => {
      throw new ProviderError('unavailable', 'missing');
    });

    await expect(
      classify(provider, { transactions, categories }),
    ).rejects.toMatchObject({ reason: 'unavailable' });
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('skips calls once the request deadline has passed', async () => {
    let time = 0;
    const provider = fakeProvider(async () => {
      time += REQUEST_DEADLINE_MS;
      return '{}';
    });

    await expect(
      classify(provider, { transactions, categories }, () => time),
    ).rejects.toMatchObject({ reason: 'timeout' });
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('formats amounts with the given currency symbol', async () => {
    const provider = fakeProvider(async () =>
      JSON.stringify(ranked('Groceries')),
    );

    await classify(provider, {
      transactions: [transactions[0]],
      categories,
      currencySymbol: '€',
    });

    expect(provider.complete.mock.calls[0][0]).toContain('for -€10.00.');
  });
});
