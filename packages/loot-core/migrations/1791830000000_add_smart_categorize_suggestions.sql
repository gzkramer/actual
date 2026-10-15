BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS smart_categorize_suggestions
  (transaction_id TEXT PRIMARY KEY,
   suggestions TEXT,
   created_at INTEGER);

COMMIT;
