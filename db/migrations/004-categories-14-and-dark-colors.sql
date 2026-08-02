-- 004: 14-category system + dark-mode ("nocturnal") colour variants.
-- Mirrors what was applied live via the D1 API on 2026-08-02 so a fresh
-- install (and the sellable template) reproduces the same state.
-- Safe to re-run: the ALTER is guarded by the app's migration runner, and the
-- category writes are idempotent upserts.

ALTER TABLE categories ADD COLUMN color_dark TEXT;

INSERT INTO categories (id,name,color,color_dark,is_slack) VALUES
 (1,'Academic',        '#4F46E5','#7D7AFF',0),
 (2,'Athletic',        '#EF4444','#FF453A',0),
 (3,'Fitness',         '#F97316','#FF9F0A',0),
 (4,'Religion',        '#8B5CF6','#BF5AF2',0),
 (5,'Family',          '#EC4899','#FF6FB5',0),
 (6,'Languages',       '#14B8A6','#40D9C8',0),
 (7,'Business',        '#10B981','#30D158',0),
 (8,'University',      '#3B82F6','#0A84FF',0),
 (9,'Social',          '#D946EF','#E879F9',0),
 (10,'Intelligence',   '#EAB308','#FFD60A',0),
 (11,'Extracurriculars','#06B6D4','#64D2FF',0),
 (12,'Bonus',          '#84CC16','#A3E635',0),
 (13,'Miscellaneous',  '#6B7280','#F5F5F7',0),
 (14,'Slack / Buffer', '#94A3B8','#8E8E93',1)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  color=excluded.color,
  color_dark=excluded.color_dark,
  is_slack=excluded.is_slack;
