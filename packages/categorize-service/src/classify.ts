import type {
  CategorySuggestion,
  ClassifyRequest,
  ClassifyResponseData,
  ClassifyTransaction,
} from './contract';
import {
  BATCH_TIMEOUT_MS,
  MIN_CALL_TIME_MS,
  REQUEST_DEADLINE_MS,
  SINGLE_TIMEOUT_MS,
} from './limits';
import { buildBatchPrompt, buildSinglePrompt } from './prompt';
import { ProviderError } from './providers/provider';
import type { Provider } from './providers/provider';
import { parseBatchResponse, parseSingleResponse } from './validate';

type Deadline = { remaining(): number };

function createDeadline(now: () => number): Deadline {
  const end = now() + REQUEST_DEADLINE_MS;
  return { remaining: () => end - now() };
}

async function complete(
  provider: Provider,
  prompt: string,
  timeoutMs: number,
  deadline: Deadline,
) {
  const budget = Math.min(timeoutMs, deadline.remaining());
  if (budget < MIN_CALL_TIME_MS) {
    throw new ProviderError('timeout', 'request deadline reached');
  }
  return provider.complete(prompt, budget);
}

async function classifySingle(
  provider: Provider,
  transaction: ClassifyTransaction,
  request: ClassifyRequest,
  deadline: Deadline,
) {
  const prompt = buildSinglePrompt(
    transaction,
    request.categories,
    request.currencySymbol,
  );
  // Retry once when the reply isn't usable JSON.
  for (let attempt = 0; attempt < 2; attempt++) {
    const suggestions = parseSingleResponse(
      await complete(provider, prompt, SINGLE_TIMEOUT_MS, deadline),
      request.categories,
    );
    if (suggestions) {
      return suggestions;
    }
  }
  return null;
}

/**
 * Classifies one chunk of transactions. A chunk of one uses the single
 * prompt; larger chunks use the batch prompt, and any ids the batch reply
 * misses are retried one at a time. Throws a ProviderError when the provider
 * can't run at all, or when nothing could be classified.
 */
export async function classify(
  provider: Provider,
  request: ClassifyRequest,
  now: () => number = Date.now,
): Promise<ClassifyResponseData> {
  const deadline = createDeadline(now);
  const results = new Map<string, CategorySuggestion[]>();
  const errors: ProviderError[] = [];

  function recordError(err: unknown) {
    if (!(err instanceof ProviderError) || err.reason === 'unavailable') {
      throw err;
    }
    errors.push(err);
  }

  if (request.transactions.length > 1) {
    try {
      const parsed = parseBatchResponse(
        await complete(
          provider,
          buildBatchPrompt(
            request.transactions,
            request.categories,
            request.currencySymbol,
          ),
          BATCH_TIMEOUT_MS,
          deadline,
        ),
        request.transactions.map(t => t.id),
        request.categories,
      );
      for (const [id, suggestions] of parsed) {
        results.set(id, suggestions);
      }
    } catch (err) {
      recordError(err);
    }
  }

  for (const transaction of request.transactions) {
    if (results.has(transaction.id)) {
      continue;
    }
    try {
      const suggestions = await classifySingle(
        provider,
        transaction,
        request,
        deadline,
      );
      if (suggestions) {
        results.set(transaction.id, suggestions);
      }
    } catch (err) {
      recordError(err);
    }
  }

  const lastError = errors.at(-1);
  if (results.size === 0 && lastError) {
    throw lastError;
  }

  return {
    results: Object.fromEntries(results),
    failed: request.transactions.map(t => t.id).filter(id => !results.has(id)),
    model: provider.model,
  };
}
