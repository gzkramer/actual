import { randomUUID } from 'node:crypto';

import express from 'express';
import type { NextFunction, Request, Response } from 'express';

import { classify } from './classify';
import type {
  ClassifyErrorReason,
  ClassifyResponseData,
  ServiceInfo,
  ServiceResponse,
} from './contract';
import { BODY_LIMIT, MAX_BATCH_SIZE, MAX_IN_FLIGHT_REQUESTS } from './limits';
import { ProviderError } from './providers/provider';
import type { Provider } from './providers/provider';
import { parseClassifyRequest } from './request';

type CreateAppOptions = {
  provider: Provider;
  log?: (entry: Record<string, unknown>) => void;
};

const STATUS_BY_REASON: Record<ClassifyErrorReason, number> = {
  'invalid-request': 400,
  unauthorized: 401,
  busy: 429,
  'provider-unavailable': 503,
  timeout: 504,
  'provider-error': 502,
};

function sendError(res: Response, reason: ClassifyErrorReason) {
  res.status(STATUS_BY_REASON[reason]).send({
    status: 'error',
    reason,
  } satisfies ServiceResponse<never>);
}

function reasonForProviderError(err: ProviderError): ClassifyErrorReason {
  switch (err.reason) {
    case 'unavailable':
      return 'provider-unavailable';
    case 'timeout':
      return 'timeout';
    default:
      return 'provider-error';
  }
}

// The caller's Claude token. The service holds no credentials of its own,
// so each request is billed to the token it carries.
const CLAUDE_TOKEN_HEADER = 'x-claude-token';

function getClaudeToken(req: Request) {
  const value = req.headers[CLAUDE_TOKEN_HEADER];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function defaultLog(entry: Record<string, unknown>) {
  console.info(JSON.stringify(entry));
}

export function createApp({ provider, log = defaultLog }: CreateAppOptions) {
  const app = express();
  app.disable('x-powered-by');
  let inFlight = 0;

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'UP' });
  });

  const v1 = express.Router();

  v1.use(express.json({ limit: BODY_LIMIT }));

  v1.get('/info', async (_req, res) => {
    res.send({
      status: 'ok',
      data: {
        provider: provider.name,
        model: provider.model,
        maxBatchSize: MAX_BATCH_SIZE,
        ready: await provider.isReady(),
      },
    } satisfies ServiceResponse<ServiceInfo>);
  });

  v1.post('/classify', async (req, res) => {
    const claudeToken = getClaudeToken(req);
    if (!claudeToken) {
      sendError(res, 'unauthorized');
      return;
    }

    const request = parseClassifyRequest(req.body);
    if (!request) {
      sendError(res, 'invalid-request');
      return;
    }
    if (inFlight >= MAX_IN_FLIGHT_REQUESTS) {
      sendError(res, 'busy');
      return;
    }

    inFlight++;
    const requestId = randomUUID();
    const started = Date.now();
    let outcome: string = 'ok';
    let failed = 0;
    try {
      const data = await classify(
        {
          ...provider,
          complete: (prompt, timeoutMs) =>
            provider.complete(prompt, timeoutMs, claudeToken),
        },
        request,
      );
      failed = data.failed.length;
      res.send({
        status: 'ok',
        data,
      } satisfies ServiceResponse<ClassifyResponseData>);
    } catch (err) {
      if (!(err instanceof ProviderError)) {
        throw err;
      }
      const reason = reasonForProviderError(err);
      outcome = reason;
      sendError(res, reason);
    } finally {
      inFlight--;
      // Never log descriptions, categories or tokens.
      log({
        event: 'classify',
        requestId,
        size: request.transactions.length,
        failed,
        outcome,
        ms: Date.now() - started,
      });
    }
  });

  app.use('/v1', v1);

  app.use((_req, res) => {
    res.status(404).send({ status: 'error', reason: 'not-found' });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Malformed or oversized JSON bodies.
    if (
      typeof err === 'object' &&
      err !== null &&
      'type' in err &&
      (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')
    ) {
      sendError(res, 'invalid-request');
      return;
    }
    log({
      event: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).send({ status: 'error', reason: 'internal' });
  });

  return app;
}
