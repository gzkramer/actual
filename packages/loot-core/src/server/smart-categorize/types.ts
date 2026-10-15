export type AllowedCategory = {
  id: string;
  name: string;
};

// The next three types mirror the categorize service's contract
// (packages/categorize-service/src/contract.ts). They're copied rather than
// imported because this package is published and the service isn't; the
// service's typecheck fails if the two drift apart.
export type CategorySuggestion = {
  category: string;
  // null for the "Uncategorized" sentinel
  categoryId: string | null;
  confidence: number;
  rationale: string;
};

export type ClassifyRequest = {
  transactions: ClassifiableTransaction[];
  categories: AllowedCategory[];
  currencySymbol?: string;
};

export type ClassifyResponseData = {
  results: Record<string, CategorySuggestion[]>;
  failed: string[];
  model: string;
};

export type ClassifiableTransaction = {
  id: string;
  description: string;
  amount: number;
};

export type SmartCategorizeResult = {
  categorized: number;
  needsReview: number;
  failed: number;
  error?: string;
};
