import { describe, expect, it } from 'vitest';

import { parseBatchResponse, parseSingleResponse } from './validate';

const categories = [
  { id: 'groceries', name: 'Groceries' },
  { id: 'dining', name: 'Dining Out' },
];

describe('parseSingleResponse', () => {
  it('parses a valid array and maps names to ids', () => {
    const result = parseSingleResponse(
      JSON.stringify([
        { category: 'Groceries', confidence_percentage: 80, rationale: 'a' },
        { category: 'Dining Out', confidence_percentage: 15, rationale: 'b' },
        { category: 'Uncategorized', confidence_percentage: 5, rationale: 'c' },
      ]),
      categories,
    );

    expect(result).toEqual([
      {
        category: 'Groceries',
        categoryId: 'groceries',
        confidence: 80,
        rationale: 'a',
      },
      {
        category: 'Dining Out',
        categoryId: 'dining',
        confidence: 15,
        rationale: 'b',
      },
      {
        category: 'Uncategorized',
        categoryId: null,
        confidence: 5,
        rationale: 'c',
      },
    ]);
  });

  it('strips markdown fences and matches names case-insensitively', () => {
    const result = parseSingleResponse(
      '```json\n[{"category":"groceries","confidence_percentage":100,"rationale":""}]\n```',
      categories,
    );
    expect(result?.[0]).toMatchObject({
      categoryId: 'groceries',
      confidence: 100,
    });
  });

  it('drops unknown categories and renormalizes to 100', () => {
    const result = parseSingleResponse(
      JSON.stringify([
        { category: 'Groceries', confidence_percentage: 30, rationale: '' },
        { category: 'Rent', confidence_percentage: 50, rationale: '' },
        { category: 'Dining Out', confidence_percentage: 30, rationale: '' },
      ]),
      categories,
    );
    expect(result?.map(s => s.confidence)).toEqual([50, 50]);
  });

  it('sorts by confidence and clamps values', () => {
    const result = parseSingleResponse(
      JSON.stringify([
        { category: 'Dining Out', confidence_percentage: -10, rationale: '' },
        { category: 'Groceries', confidence_percentage: 150, rationale: '' },
      ]),
      categories,
    );
    expect(result?.map(s => [s.categoryId, s.confidence])).toEqual([
      ['groceries', 100],
      ['dining', 0],
    ]);
  });

  it('returns null for garbage', () => {
    expect(parseSingleResponse('Sure! Here you go', categories)).toBeNull();
    expect(parseSingleResponse('{"a":1}', categories)).toBeNull();
    expect(parseSingleResponse('[]', categories)).toBeNull();
  });
});

describe('parseBatchResponse', () => {
  it('keeps only valid entries for the requested ids', () => {
    const result = parseBatchResponse(
      JSON.stringify({
        t1: [
          { category: 'Groceries', confidence_percentage: 100, rationale: '' },
        ],
        t2: 'not an array',
        other: [
          { category: 'Groceries', confidence_percentage: 100, rationale: '' },
        ],
      }),
      ['t1', 't2', 't3'],
      categories,
    );
    expect([...result.keys()]).toEqual(['t1']);
  });

  it('returns an empty map for invalid JSON', () => {
    expect(parseBatchResponse('nope', ['t1'], categories).size).toBe(0);
  });
});
