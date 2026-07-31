-- V3: opt-in web-push reminders. Apply with:
--   wrangler d1 execute personal-assistant-db --remote --file db/migrations/003-reminders.sql
-- Also folded into db/schema.sql for fresh installs.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  occurrence_date TEXT NOT NULL,  -- YYYY-MM-DD, the occurrence this reminder fires for
  fire_at TEXT NOT NULL,          -- naive local ISO datetime (America/Toronto) to send the push
  sent INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, occurrence_date)
);

CREATE INDEX IF NOT EXISTS idx_reminders_fire_at ON reminders(fire_at);
