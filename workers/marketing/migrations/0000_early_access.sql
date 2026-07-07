-- Early-access signups captured from the marketing site's email-capture forms.
-- Pre-launch list: dedupe on email, remember where the signup came from.
CREATE TABLE IF NOT EXISTS early_access (
  email      TEXT PRIMARY KEY,
  source     TEXT,
  created_at INTEGER NOT NULL
);
