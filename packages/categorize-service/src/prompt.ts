import type { ClassifyCategory, ClassifyTransaction } from './contract';
import { UNCATEGORIZED_LABEL } from './limits';

// Amounts arrive as Actual's signed integer cents.
export function formatAmount(amount: number, currencySymbol = '$') {
  const value = amount / 100;
  const sign = value < 0 ? '-' : '';
  return `${sign}${currencySymbol}${Math.abs(value).toFixed(2)}`;
}

function sanitize(text: string) {
  // Keep each transaction on one line and stop descriptions from closing
  // the quotes around them.
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/'/g, "'")
    .trim();
}

function categoryList(categories: ClassifyCategory[]) {
  return [...categories.map(c => c.name), UNCATEGORIZED_LABEL]
    .map(name => `- ${name}`)
    .join('\n');
}

const ITEM_SHAPE = `{
  "category": string,
  "confidence_percentage": integer (0-100),
  "rationale": string
}`;

export function buildSinglePrompt(
  transaction: ClassifyTransaction,
  categories: ClassifyCategory[],
  currencySymbol?: string,
) {
  return `Classify the following transaction: '${sanitize(transaction.description)}' for ${formatAmount(transaction.amount, currencySymbol)}.

Allowed categories:
${categoryList(categories)}

Evaluate every allowed category. Return ONLY a valid JSON array sorted by confidence descending where each item matches:
${ITEM_SHAPE}

The sum of all confidence_percentage values across the array must equal exactly 100.
Do not wrap in markdown backticks or output conversational prose. Output pure JSON only.`;
}

export function buildBatchPrompt(
  transactions: ClassifyTransaction[],
  categories: ClassifyCategory[],
  currencySymbol?: string,
) {
  const lines = transactions
    .map(
      (t, idx) =>
        `${idx + 1}. ${t.id} | ${sanitize(t.description)} | ${formatAmount(t.amount, currencySymbol)}`,
    )
    .join('\n');

  return `Classify each of the following transactions. Each line is "number. id | description | amount".

${lines}

Allowed categories:
${categoryList(categories)}

For every transaction, evaluate every allowed category. Return ONLY a valid JSON object whose keys are the transaction ids above and whose values are JSON arrays sorted by confidence descending where each item matches:
${ITEM_SHAPE}

For each transaction, the sum of all confidence_percentage values in its array must equal exactly 100.
Do not wrap in markdown backticks or output conversational prose. Output pure JSON only.`;
}
