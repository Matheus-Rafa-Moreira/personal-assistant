-- Seed: categories + UofT Fall 2026 timetable + routine/chore scaffolds
INSERT INTO categories (id,name,color,is_slack) VALUES
 (1,'School','#4F46E5',0),
 (2,'Routines','#0EA5E9',0),
 (3,'Health & Gym','#EF4444',0),
 (4,'Chores & Errands','#F59E0B',0),
 (5,'Family & Social','#EC4899',0),
 (6,'Goals & Growth','#10B981',0),
 (7,'Misc','#6B7280',0),
 (8,'Slack / Buffer','#94A3B8',1);

-- ===== School (ACORN Fall 2026; colors match ACORN) =====
-- H1 F courses run ~2026-09-08 .. 2026-12-08. MAT133Y1 is FULL YEAR (~2027-04-09).
-- TODO(Matt): confirm fall reading week + winter break EXDATEs.
INSERT INTO events (title,category_id,color_override,start,"end",rrule,location,description,source) VALUES
 ('MAT133Y1 LEC 0501','1','#1B9E77','2026-09-09T13:00:00','2026-09-09T14:00:00',
  'FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20270409T235959','OI 2212','Calculus & Linear Algebra (full year)','seed'),
 ('MAT133Y1 TUT 1201','1','#1B9E77','2026-09-11T12:00:00','2026-09-11T13:00:00',
  'FREQ=WEEKLY;BYDAY=FR;UNTIL=20270409T235959','OI 8280','Weekly tutorial','seed'),
 ('ECO101H1 LEC 0301','1','#7C4DFF','2026-09-08T13:00:00','2026-09-08T15:00:00',
  'FREQ=WEEKLY;BYDAY=TU;UNTIL=20261208T235959','OI G162','Intro Economics (fall)','seed'),
 ('ECO101H1 TUT 1701','1','#7C4DFF','2026-09-11T10:00:00','2026-09-11T11:00:00',
  'FREQ=WEEKLY;BYDAY=FR;UNTIL=20261208T235959','SS 1070','Weekly tutorial','seed'),
 ('RSM100H1 LEC 0101','1','#D81B60','2026-09-08T11:00:00','2026-09-08T13:00:00',
  'FREQ=WEEKLY;BYDAY=TU;UNTIL=20261208T235959','OI G162','Intro to Management (fall)','seed'),
 ('PRT101H1 LEC 5101 (Mon)','1','#D95F0F','2026-09-14T17:00:00','2026-09-14T19:00:00',
  'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261208T235959','NF 113','Portuguese (fall)','seed'),
 ('PRT101H1 LEC 5101 (Wed)','1','#D95F0F','2026-09-09T17:00:00','2026-09-09T19:00:00',
  'FREQ=WEEKLY;BYDAY=WE;UNTIL=20261208T235959','NF 006','Portuguese (fall)','seed');

-- ===== Routines (PLACEHOLDERS — Matt adjusts times/steps in app) =====
INSERT INTO events (title,category_id,start,"end",rrule,description,steps,source) VALUES
 ('Morning Routine','2','2026-08-03T07:30:00','2026-08-03T08:30:00','FREQ=DAILY',
  'Bundled block — edit steps to taste',
  '[{"text":"Wake + hydrate","done":false},{"text":"Hygiene / brush teeth","done":false},{"text":"Breakfast","done":false},{"text":"Review today in this app","done":false}]','seed'),
 ('Night Routine','2','2026-08-03T22:00:00','2026-08-03T23:00:00','FREQ=DAILY',
  'Bundled block — edit steps to taste',
  '[{"text":"Tidy 10 min","done":false},{"text":"Prep tomorrow","done":false},{"text":"Hygiene / brush teeth","done":false},{"text":"Wind down, no phone","done":false}]','seed');

-- ===== Chores (linked to Notion manuals) =====
INSERT INTO events (title,category_id,start,"end",rrule,notion_url,description,source) VALUES
 ('Laundry','4','2026-08-02T11:00:00','2026-08-02T13:00:00','FREQ=WEEKLY;BYDAY=SU',
  'https://app.notion.com/p/32f9f792f0a2838ba59c81715ccc2221','Full guide: Laundry 101','seed'),
 ('Weekly Clean','4','2026-08-01T10:00:00','2026-08-01T12:00:00','FREQ=WEEKLY;BYDAY=SA',
  'https://app.notion.com/p/3a59f792f0a2804d8f4ef5c13f47a6d1','Full guide: Cleaning 101','seed'),
 ('Kitchen Reset','4','2026-08-02T17:00:00','2026-08-02T18:00:00','FREQ=WEEKLY;BYDAY=SU',
  'https://app.notion.com/p/3a59f792f0a2801da2e3e48d92ed4c46','Full guide: Kitchen & Cooking 101','seed'),
 ('Car Check','4','2026-08-01T09:30:00','2026-08-01T10:00:00','FREQ=MONTHLY;BYDAY=1SA',
  'https://app.notion.com/p/0280b2907190481ab65ff1895cc5da23','Full guide: Car Maintenance 101','seed'),
 ('Yard / Outdoors','4','2026-08-08T10:00:00','2026-08-08T11:30:00','FREQ=WEEKLY;INTERVAL=2;BYDAY=SA',
  'https://app.notion.com/p/3a59f792f0a28047a50ed1cf14739cd4','Full guide: Landscaping & Outdoors 101','seed');

-- ===== Slack buffers (visible breathing room) =====
INSERT INTO events (title,category_id,start,"end",rrule,description,source) VALUES
 ('Buffer / Catch-up','8','2026-08-03T16:00:00','2026-08-03T17:00:00','FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  'Unassigned slack time — protected breathing room','seed');
