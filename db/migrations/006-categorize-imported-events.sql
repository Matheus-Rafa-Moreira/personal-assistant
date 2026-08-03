-- 006: give imported events a category, and tidy multi-line imported titles
--   wrangler d1 execute personal-assistant-db --remote --file db/migrations/006-categorize-imported-events.sql
--
-- Every CalDAV event landed with category_id NULL, so the whole calendar drew
-- in the uncategorised grey and the day list showed a blank subtitle under each
-- imported event. These are the same rules caldav.js now applies on insert
-- (see IMPORT_RULES / classifyImportedEvent) — order matters, first match wins.
--
-- Only touches rows that are still uncategorised, so anything already filed by
-- hand is left alone.

-- Sports and fixtures -> Athletic
UPDATE events SET category_id = (SELECT id FROM categories WHERE name = 'Athletic')
 WHERE source = 'caldav' AND category_id IS NULL
   AND (
        lower(title) LIKE '%soccer%'     OR lower(title) LIKE '%futsal%'
     OR lower(title) LIKE '%tennis%'     OR lower(title) LIKE '%volleyball%'
     OR lower(title) LIKE '%basketball%' OR lower(title) LIKE '%hockey%'
     OR lower(title) LIKE '%baseball%'   OR lower(title) LIKE '%swim%'
     OR lower(title) LIKE '%game%'       OR lower(title) LIKE '%practice%'
     OR lower(title) LIKE '%tournament%' OR lower(title) LIKE '%osa%'
   );

-- Training -> Fitness
UPDATE events SET category_id = (SELECT id FROM categories WHERE name = 'Fitness')
 WHERE source = 'caldav' AND category_id IS NULL
   AND (
        lower(title) LIKE '%gym%'      OR lower(title) LIKE '%workout%'
     OR lower(title) LIKE '%training%' OR lower(title) LIKE '%yoga%'
     OR lower(title) LIKE '%pilates%'
   );

-- Camps, lessons, tutoring -> Extracurriculars
UPDATE events SET category_id = (SELECT id FROM categories WHERE name = 'Extracurriculars')
 WHERE source = 'caldav' AND category_id IS NULL
   AND (
        lower(title) LIKE '%camp%'   OR lower(title) LIKE '%lesson%'
     OR lower(title) LIKE '%piano%'  OR lower(title) LIKE '%guitar%'
     OR lower(title) LIKE '%choir%'  OR lower(title) LIKE '%tutor%'
     OR lower(title) LIKE '%read write and think%'
   );

-- Everything else on the family calendar -> Family
UPDATE events SET category_id = (SELECT id FROM categories WHERE name = 'Family')
 WHERE source = 'caldav' AND category_id IS NULL;

-- Flatten titles that arrived with embedded newlines. The narrow no-break
-- space (U+202F) that Apple pastes into times is normalised to a plain space.
UPDATE events
   SET title = replace(replace(replace(title, char(13) || char(10), ' — '), char(10), ' — '), char(13), ' — ')
 WHERE source = 'caldav'
   AND (title LIKE '%' || char(10) || '%' OR title LIKE '%' || char(13) || '%');
