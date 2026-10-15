import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handlers as app } from './app-smart-categorize';

const { passThrough, settings, secrets } = vi.hoisted(() => ({
  passThrough: (_req: unknown, _res: unknown, next: () => void) => next(),
  settings: {} as Record<string, unknown>,
  secrets: {} as Record<string, string | null>,
}));

vi.mock('./load-config', () => ({
  config: { get: (key: string) => settings[key] },
}));

vi.mock('./services/secrets-service', () => ({
  SecretName: { smart_categorize_claudeToken: 'smart_categorize_claudeToken' },
  secretsService: { get: (name: string) => secrets[name] ?? null },
}));

vi.mock('./util/middlewares', () => ({
  requestLoggerMiddleware: passThrough,
  validateSessionMiddleware: passThrough,
}));

vi.mock('express-rate-limit', () => ({
  default: vi.fn(() => passThrough),
}));

type Received = {
  method?: string;
  url?: string;
  headers: object;
  body: string;
};

let server: Server;
let received: Received[];
let reply: (res: ServerResponse) => void;

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  return new Promise<Server>(resolve => {
    const s = createServer(handler);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

beforeEach(async () => {
  received = [];
  reply = res => sendJson(res, 200, { status: 'ok', data: { results: {} } });
  server = await listen((req, res) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      received.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      });
      reply(res);
    });
  });
  const { port } = server.address() as AddressInfo;
  settings['smartCategorize.serviceUrl'] = `http://127.0.0.1:${port}`;
  secrets.smart_categorize_claudeToken = 'claude-token';
  settings['smartCategorize.timeoutMs'] = 2000;
});

afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
});

const body = {
  transactions: [{ id: 't1', description: 'Kroger', amount: -1000 }],
  categories: [{ id: 'c1', name: 'Groceries' }],
};

describe('app-smart-categorize', () => {
  it('reports configured when the URL and Claude token are set', async () => {
    const res = await request(app).post('/status');

    expect(res.body).toEqual({ status: 'ok', data: { configured: true } });
  });

  it('reports not configured without a Claude token', async () => {
    secrets.smart_categorize_claudeToken = null;

    const res = await request(app).post('/status');

    expect(res.body).toEqual({ status: 'ok', data: { configured: false } });
  });

  it('reports not configured without a service URL', async () => {
    settings['smartCategorize.serviceUrl'] = '';

    const res = await request(app).post('/status');

    expect(res.body).toEqual({ status: 'ok', data: { configured: false } });
  });

  it('refuses to classify before setup', async () => {
    secrets.smart_categorize_claudeToken = null;

    const res = await request(app).post('/classify').send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ status: 'error', reason: 'not-configured' });
    expect(received).toHaveLength(0);
  });

  it('forwards the body with the Claude token and returns the reply', async () => {
    const res = await request(app)
      .post('/classify')
      .set('X-ACTUAL-TOKEN', 'user-session')
      .set('Cookie', 'session=abc')
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', data: { results: {} } });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ method: 'POST', url: '/v1/classify' });
    expect(JSON.parse(received[0].body)).toEqual(body);
    expect(received[0].headers).toMatchObject({
      'x-claude-token': 'claude-token',
    });
    expect(received[0].headers).not.toHaveProperty('authorization');
    expect(received[0].headers).not.toHaveProperty('x-actual-token');
    expect(received[0].headers).not.toHaveProperty('cookie');
  });

  it('passes service errors through with their status', async () => {
    reply = res => sendJson(res, 504, { status: 'error', reason: 'timeout' });

    const res = await request(app).post('/classify').send(body);

    expect(res.status).toBe(504);
    expect(res.body).toEqual({ status: 'error', reason: 'timeout' });
  });

  it('hides an unauthorized service reply from the client', async () => {
    reply = res =>
      sendJson(res, 401, { status: 'error', reason: 'unauthorized' });

    const res = await request(app).post('/classify').send(body);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: 'error',
      reason: 'service-unavailable',
    });
  });

  it('reports an unreachable service', async () => {
    settings['smartCategorize.serviceUrl'] = 'http://127.0.0.1:1';

    const res = await request(app).post('/classify').send(body);

    expect(res.status).toBe(503);
    expect(res.body.reason).toBe('service-unavailable');
  });

  it('times out a slow service', async () => {
    settings['smartCategorize.timeoutMs'] = 50;
    reply = res => {
      setTimeout(() => sendJson(res, 200, { status: 'ok', data: {} }), 500);
    };

    const res = await request(app).post('/classify').send(body);

    expect(res.status).toBe(504);
    expect(res.body.reason).toBe('timeout');
  });

  it('forwards /info', async () => {
    reply = res => sendJson(res, 200, { status: 'ok', data: { ready: true } });

    const res = await request(app).get('/info');

    expect(res.body).toEqual({ status: 'ok', data: { ready: true } });
    expect(received[0]).toMatchObject({ method: 'GET', url: '/v1/info' });
  });
});
