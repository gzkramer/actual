import { vi } from 'vitest';

import type { Provider } from './providers/provider';

export const categories = [
  { id: 'groceries', name: 'Groceries' },
  { id: 'dining', name: 'Dining Out' },
];

export function ranked(top: string, confidence = 100) {
  const rest = categories.find(c => c.name !== top);
  return confidence === 100 || !rest
    ? [{ category: top, confidence_percentage: 100, rationale: 'r' }]
    : [
        { category: top, confidence_percentage: confidence, rationale: 'r' },
        {
          category: rest.name,
          confidence_percentage: 100 - confidence,
          rationale: 'r',
        },
      ];
}

export function fakeProvider(
  complete: Provider['complete'] = vi.fn(),
): Provider & { complete: ReturnType<typeof vi.fn> } {
  return {
    name: 'fake',
    model: 'fake-model',
    complete: vi.fn(complete),
    isReady: vi.fn(async () => true),
  };
}
