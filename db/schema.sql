-- Personal Life Assistant — D1 schema
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  is_slack INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  color_override TEXT,
  start TEXT NOT NULL,            -- ISO local datetime of first occurrence
  end TEXT NOT NULL,
  rrule TEXT,                     -- RFC5545 RRULE string, NULL = one-off
  exdates TEXT,                   -- JSON array of ISO dates to skip
  description TEXT,
  steps TEXT,                     -- JSON [{text,done}] sub-routine checklist
  location TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  notion_url TEXT,
  source TEXT DEFAULT 'app',      -- app | caldav | seed | replan
  caldav_uid TEXT,                -- iCloud event UID, used to upsert on read-only pull sync
  caldav_url TEXT,                -- iCloud calendar object URL (informational, pull-only)
  caldav_etag TEXT,               -- iCloud ETag (informational, pull-only)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS event_overrides (
  id INTEGER PRIMARY KEY,
  event_id INTEGER REFERENCES events(id),
  date TEXT NOT NULL,             -- YYYY-MM-DD being overridden
  new_start TEXT, new_end TEXT,   -- NULL start+end = cancelled that day
  new_title TEXT,
  steps_state TEXT,               -- JSON array of booleans, index-aligned with events.steps
  reason TEXT,                    -- e.g. 'replan 2026-09-15'
  UNIQUE(event_id, date)
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  detail TEXT,
  horizon TEXT DEFAULT 'year',    -- year | semester | month
  done INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notes_inbox (
  id INTEGER PRIMARY KEY,
  title TEXT, body TEXT,
  received_at TEXT DEFAULT (datetime('now')),
  processed INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY, value TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start);
CREATE INDEX IF NOT EXISTS idx_overrides_date ON event_overrides(date);

-- V3: opt-in web-push reminders (db/migrations/003-reminders.sql)
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
