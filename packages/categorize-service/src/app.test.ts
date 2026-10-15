import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app';
import { MAX_BATCH_SIZE } from './limits';
import { ProviderError } from './providers/provider';
import type { Provider } from './providers/provider';
import { categories, fakeProvider, ranked } from './testing';

const TOKEN = 'claude-token';

function setup(complete?: Provider['complete']) {
  const provider = fakeProvider(complete);
  const log = vi.fn();
  const app = createApp({ provider, log });
  return { app, provider, log };
}

function classifyRequest(app: ReturnType<typeof createApp>, body: unknown) {
  return request(app)
    .post('/v1/classify')
    .set('X-Claude-Token', TOKEN)
    .send(body as object);
}

const body = {
  transactions: [{ id: 't1', description: 'Kroger', amount: -1000 }],
  categories,
};

describe('categorize-service app', () => {
  it('starts without any credentials', () => {
    expect(() => createApp({ provider: fakeProvider() })).not.toThrow();
  });

  it('serves /health without auth', async () => {
    const { app } = setup();

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'UP' });
  });

  it('rejects a request without a Claude token', async () => {
    const { app, provider } = setup();

    const missing = await request(app).post('/v1/classify').send(body);
    const blank = await request(app)
      .post('/v1/classify')
      .set('X-Claude-Token', ' ')
      .send(body);

    expect(missing.status).toBe(401);
    expect(blank.status).toBe(401);
    expect(missing.body).toEqual({ status: 'error', reason: 'unauthorized' });
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('passes the Claude token to the provider and never logs it', async () => {
    const { app, provider, log } = setup(async () =>
      JSON.stringify(ranked('Groceries')),
    );

    const res = await classifyRequest(app, body);

    expect(res.status).toBe(200);
    expect(provider.complete).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Number),
      TOKEN,
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  });

  it('returns validated results', async () => {
    const { app } = setup(async () => JSON.stringify(ranked('Groceries')));

    const res = await classifyRequest(app, body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      data: {
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
      },
    });
  });

  it.each([
    ['no transactions', { ...body, transactions: [] }],
    [
      'too many transactions',
      {
        ...body,
        transactions: Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => ({
          id: `t${i}`,
          description: 'x',
          amount: -1,
        })),
      },
    ],
    ['no categories', { ...body, categories: [] }],
    [
      'duplicate ids',
      { ...body, transactions: [body.transactions[0], body.transactions[0]] },
    ],
    [
      'a fractional amount',
      {
        ...body,
        transactions: [{ id: 't1', description: 'x', amount: 1.5 }],
      },
    ],
    ['a raw prompt', { prompt: 'say anything' }],
  ])('rejects %s', async (_name, invalid) => {
    const { app, provider } = setup();

    const res = await classifyRequest(app, invalid);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ status: 'error', reason: 'invalid-request' });
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    const { app } = setup();

    const res = await request(app)
      .post('/v1/classify')
      .set('X-Claude-Token', TOKEN)
      .set('Content-Type', 'application/json')
      .send('{nope');

    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('invalid-request');
  });

  it('truncates long descriptions', async () => {
    const { app, provider } = setup(async () =>
      JSON.stringify(ranked('Groceries')),
    );

    await classifyRequest(app, {
      ...body,
      transactions: [{ id: 't1', description: 'x'.repeat(1000), amount: -1 }],
    });

    expect(provider.complete.mock.calls[0][0]).not.toContain('x'.repeat(201));
  });

  it.each([
    ['unavailable', 503, 'provider-unavailable'],
    ['timeout', 504, 'timeout'],
    ['error', 502, 'provider-error'],
  ] as const)(
    'maps a provider %s to %d %s',
    async (providerReason, status, reason) => {
      const { app } = setup(async () => {
        throw new ProviderError(providerReason, 'x');
      });

      const res = await classifyRequest(app, body);

      expect(res.status).toBe(status);
      expect(res.body).toEqual({ status: 'error', reason });
    },
  );

  it('turns requests away when too many are in flight', async () => {
    const resolvers: Array<(reply: string) => void> = [];
    const blocked = new Promise<string>(resolve => resolvers.push(resolve));
    const release = () => resolvers[0](JSON.stringify(ranked('Groceries')));
    const { app } = setup(() => blocked);

    const pending = Array.from({ length: 12 }, () =>
      classifyRequest(app, body).then(res => res.status),
    );
    // Give the pending requests time to reach the handler.
    await new Promise(resolve => setTimeout(resolve, 50));
    const res = await classifyRequest(app, body);
    release();

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ status: 'error', reason: 'busy' });
    expect(await Promise.all(pending)).toEqual(Array(12).fill(200));
  });

  it('logs outcomes without transaction data', async () => {
    const { app, log } = setup(async () => JSON.stringify(ranked('Groceries')));

    await classifyRequest(app, body);

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'classify', size: 1, outcome: 'ok' }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('Kroger');
  });

  it('reports provider readiness on /v1/info', async () => {
    const { app } = setup();

    const res = await request(app).get('/v1/info');

    expect(res.body).toEqual({
      status: 'ok',
      data: {
        provider: 'fake',
        model: 'fake-model',
        maxBatchSize: MAX_BATCH_SIZE,
        ready: true,
      },
    });
  });
});
