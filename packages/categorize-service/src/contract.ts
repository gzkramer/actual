// The categorize service's HTTP contract. Types only, so clients can use
// `import type` without pulling in any service code.

export type ClassifyTransaction = {
  id: string;
  description: string;
  // Signed integer cents, as stored by Actual.
  amount: number;
};

export type ClassifyCategory = {
  id: string;
  name: string;
};

export type ClassifyRequest = {
  transactions: ClassifyTransaction[];
  categories: ClassifyCategory[];
  currencySymbol?: string;
};

export type CategorySuggestion = {
  category: string;
  // null for the "Uncategorized" sentinel
  categoryId: string | null;
  confidence: number;
  rationale: string;
};

export type ClassifyResponseData = {
  // Ranked suggestions per transaction id, each summing to 100.
  results: Record<string, CategorySuggestion[]>;
  // Ids that still had no usable answer after the service's retries.
  failed: string[];
  model: string;
};

export type ServiceInfo = {
  provider: string;
  model: string;
  maxBatchSize: number;
  ready: boolean;
};

export type ClassifyErrorReason =
  | 'invalid-request'
  | 'unauthorized'
  | 'busy'
  | 'provider-unavailable'
  | 'timeout'
  | 'provider-error';

export type ServiceResponse<T> =
  | { status: 'ok'; data: T }
  | { status: 'error'; reason: ClassifyErrorReason; details?: string };
