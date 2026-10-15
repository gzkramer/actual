export const UNCATEGORIZED_LABEL = 'Uncategorized';

// Request limits for POST /v1/classify. The batch size matches loot-core's
// chunk size.
export const MAX_BATCH_SIZE = 5;
export const MAX_CATEGORIES = 500;
export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_ID_LENGTH = 100;
export const MAX_CATEGORY_NAME_LENGTH = 200;
export const MAX_CURRENCY_SYMBOL_LENGTH = 5;
export const BODY_LIMIT = '256kb';

// Model calls. A batch call, then single-transaction retries, all have to fit
// inside the request deadline so callers can rely on a bounded response time.
export const SINGLE_TIMEOUT_MS = 60 * 1000;
export const BATCH_TIMEOUT_MS = 180 * 1000;
export const REQUEST_DEADLINE_MS = 240 * 1000;
export const MIN_CALL_TIME_MS = 5 * 1000;

export const MAX_CONCURRENT_RUNS = 3;
// Requests beyond this are turned away with `busy` instead of queueing.
export const MAX_IN_FLIGHT_REQUESTS = 12;
