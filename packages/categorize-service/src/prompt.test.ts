import { describe, expect, it } from 'vitest';

import { buildBatchPrompt, buildSinglePrompt, formatAmount } from './prompt';

const categories = [
  { id: 'groceries', name: 'Groceries' },
  { id: 'dining', name: 'Dining Out' },
];

describe('formatAmount', () => {
  it('formats integer amounts with a sign', () => {
    expect(formatAmount(-4820)).toBe('-$48.20');
    expect(formatAmount(1500)).toBe('$15.00');
  });

  it('uses the given currency symbol', () => {
    expect(formatAmount(-4820, '€')).toBe('-€48.20');
  });
});

describe('buildSinglePrompt', () => {
  it('lists the app categories plus Uncategorized', () => {
    const prompt = buildSinglePrompt(
      { id: 't1', description: 'WHOLEFDS BOS #10243', amount: -4820 },
      categories,
    );
    expect(prompt).toContain(
      "Classify the following transaction: 'WHOLEFDS BOS #10243' for -$48.20.",
    );
    expect(prompt).toContain('- Groceries\n- Dining Out\n- Uncategorized');
    expect(prompt).toContain('must equal exactly 100');
  });

  it('keeps descriptions on one line', () => {
    const prompt = buildSinglePrompt(
      { id: 't1', description: "Joe's\nDiner", amount: -100 },
      categories,
    );
    expect(prompt).toContain("'Joe's Diner'");
  });
});

describe('buildBatchPrompt', () => {
  it('lists every transaction with its id', () => {
    const prompt = buildBatchPrompt(
      [
        { id: 't1', description: 'Kroger', amount: -1000 },
        { id: 't2', description: 'Chipotle', amount: -1250 },
      ],
      categories,
    );
    expect(prompt).toContain('1. t1 | Kroger | -$10.00');
    expect(prompt).toContain('2. t2 | Chipotle | -$12.50');
    expect(prompt).toContain('keys are the transaction ids');
  });
});
