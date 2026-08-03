-- 005: all-day events
--   wrangler d1 execute personal-assistant-db --remote --file db/migrations/005-all-day-events.sql
--
-- Until now there was no all-day concept. CalDAV all-day events and the
-- academic term markers were stored as 00:00:00 -> 23:59:59 timed events, so
-- week and day view drew them as 24-hour-tall blocks that covered every real
-- event in the column. Family Vacation (Aug 3-16) alone blanked two weeks.

ALTER TABLE events ADD COLUMN all_day INTEGER DEFAULT 0;

-- Backfill: anything that starts at midnight and ends at 23:59:59, or at
-- midnight on a later day, was an all-day event wearing a timed costume.
UPDATE events
   SET all_day = 1
 WHERE start LIKE '%T00:00:00'
   AND (
        "end" LIKE '%T23:59:59'
     OR ("end" LIKE '%T00:00:00' AND substr("end", 1, 10) > substr(start, 1, 10))
   );
