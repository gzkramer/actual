import { describe, expect, it } from 'vitest';

import { pickConfidentCategory } from './threshold';

describe('pickConfidentCategory', () => {
  const suggestion = (categoryId: string | null, confidence: number) => ({
    category: categoryId ?? 'Uncategorized',
    categoryId,
    confidence,
    rationale: '',
  });

  it('applies the top category at or above the threshold', () => {
    expect(pickConfidentCategory([suggestion('groceries', 70)], 70)).toBe(
      'groceries',
    );
  });

  it('skips results below the threshold', () => {
    expect(pickConfidentCategory([suggestion('groceries', 69)], 70)).toBeNull();
  });

  it('never applies Uncategorized', () => {
    expect(pickConfidentCategory([suggestion(null, 95)], 70)).toBeNull();
  });
});
