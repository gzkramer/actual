import createDebug from 'debug';
import express from 'express';
import rateLimit from 'express-rate-limit';

import { config } from './load-config';
import { SecretName, secretsService } from './services/secrets-service';
import {
  requestLoggerMiddleware,
  validateSessionMiddleware,
} from './util/middlewares';

const debug = createDebug('actual:smart-categorize');

const BODY_LIMIT = '256kb';

// Header the categorize service reads the Claude token from.
const CLAUDE_TOKEN_HEADER = 'X-Claude-Token';

function getClaudeToken(): string | null {
  const token = secretsService.get(SecretName.smart_categorize_claudeToken);
  return typeof token === 'string' && token !== '' ? token : null;
}

function isConfigured() {
  return (
    Boolean(config.get('smartCategorize.serviceUrl')) && !!getClaudeToken()
  );
}

function isServiceResponse(value: unknown): value is { status: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    typeof value.status === 'string'
  );
}

/**
 * Forwards a request to the categorize service with the admin-configured
 * Claude token. Only the parsed JSON body is sent on: the user's session
 * token and cookies never leave this server.
 */
async function forward(
  res: express.Response,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
) {
  const url = config.get('smartCategorize.serviceUrl');
  const timeoutMs = config.get('smartCategorize.timeoutMs');
  const claudeToken = getClaudeToken();
  if (!url || !claudeToken) {
    res.status(400).send({ status: 'error', reason: 'not-configured' });
    return;
  }

  let response: Response;
  let data: unknown;
  try {
    response = await fetch(new URL(path, url), {
      method,
      headers: {
        [CLAUDE_TOKEN_HEADER]: claudeToken,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    data = await response.json();
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    debug('categorize service request failed: %s', String(err));
    res.status(timedOut ? 504 : 503).send({
      status: 'error',
      reason: timedOut ? 'timeout' : 'service-unavailable',
    });
    return;
  }

  if (response.status === 401) {
    // The service saw no Claude token: a server problem, not the user's
    // session, so don't let the client treat it as a logout.
    debug('categorize service rejected the request as unauthorized');
    res.status(503).send({ status: 'error', reason: 'service-unavailable' });
    return;
  }

  if (!isServiceResponse(data)) {
    res.status(502).send({ status: 'error', reason: 'provider-error' });
    return;
  }

  res.status(response.status).send(data);
}

const app = express();
export { app as handlers };
app.use(express.json({ limit: BODY_LIMIT }));
app.use(requestLoggerMiddleware);
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    legacyHeaders: false,
    standardHeaders: true,
  }),
);
app.use(validateSessionMiddleware);

app.post('/status', (_req, res) => {
  res.send({ status: 'ok', data: { configured: isConfigured() } });
});

app.post('/classify', async (req, res) => {
  await forward(res, 'POST', '/v1/classify', req.body ?? {});
});

app.get('/info', async (_req, res) => {
  await forward(res, 'GET', '/v1/info');
});
