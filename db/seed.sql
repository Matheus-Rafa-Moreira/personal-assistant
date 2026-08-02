-- Seed: categories + UofT Fall 2026 timetable + routine/chore scaffolds
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
 (14,'Slack / Buffer', '#94A3B8','#8E8E93',1);

-- ===== School (ACORN Fall 2026; colors match ACORN) =====
-- H1 F courses run ~2026-09-08 .. 2026-12-08. MAT133Y1 is FULL YEAR (~2027-04-09).
-- EXDATEs below = fall reading week (Oct 26-30 2026), winter closure (Dec 24
-- 2026 - Jan 5 2027), winter reading week (Feb 15-19 2027), per UTSC/KPE
-- 2026-27 sessional dates. Worth double-checking against ACORN for exceptions.
INSERT INTO events (title,category_id,color_override,start,"end",rrule,exdates,location,description,source) VALUES
 ('MAT133Y1 LEC 0501','1','#1B9E77','2026-09-09T13:00:00','2026-09-09T14:00:00',
  'FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20270409T235959',
  '["2026-10-26","2026-10-28","2026-10-30","2026-12-25","2026-12-28","2026-12-30","2027-01-01","2027-01-04","2027-02-15","2027-02-17","2027-02-19"]',
  'OI 2212','Calculus & Linear Algebra (full year)','seed'),
 ('MAT133Y1 TUT 1201','1','#1B9E77','2026-09-11T12:00:00','2026-09-11T13:00:00',
  'FREQ=WEEKLY;BYDAY=FR;UNTIL=20270409T235959',
  '["2026-10-30","2026-12-25","2027-01-01","2027-02-19"]',
  'OI 8280','Weekly tutorial','seed'),
 ('ECO101H1 LEC 0301','1','#7C4DFF','2026-09-08T13:00:00','2026-09-08T15:00:00',
  'FREQ=WEEKLY;BYDAY=TU;UNTIL=20261208T235959','["2026-10-27"]','OI G162','Intro Economics (fall)','seed'),
 ('ECO101H1 TUT 1701','1','#7C4DFF','2026-09-11T10:00:00','2026-09-11T11:00:00',
  'FREQ=WEEKLY;BYDAY=FR;UNTIL=20261208T235959','["2026-10-30"]','SS 1070','Weekly tutorial','seed'),
 ('RSM100H1 LEC 0101','1','#D81B60','2026-09-08T11:00:00','2026-09-08T13:00:00',
  'FREQ=WEEKLY;BYDAY=TU;UNTIL=20261208T235959','["2026-10-27"]','OI G162','Intro to Management (fall)','seed'),
 ('PRT101H1 LEC 5101 (Mon)','1','#D95F0F','2026-09-14T17:00:00','2026-09-14T19:00:00',
  'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261208T235959','["2026-10-26"]','NF 113','Portuguese (fall)','seed'),
 ('PRT101H1 LEC 5101 (Wed)','1','#D95F0F','2026-09-09T17:00:00','2026-09-09T19:00:00',
  'FREQ=WEEKLY;BYDAY=WE;UNTIL=20261208T235959','["2026-10-28"]','NF 006','Portuguese (fall)','seed');

-- ===== Routines (PLACEHOLDERS — Matt adjusts times/steps in app) =====
INSERT INTO events (title,category_id,start,"end",rrule,description,steps,source) VALUES
 ('Morning Routine','13','2026-08-03T07:30:00','2026-08-03T08:30:00','FREQ=DAILY',
  'Bundled block — edit steps to taste',
  '[{"text":"Wake + hydrate","done":false},{"text":"Hygiene / brush teeth","done":false},{"text":"Breakfast","done":false},{"text":"Review today in this app","done":false}]','seed'),
 ('Night Routine','13','2026-08-03T22:00:00','2026-08-03T23:00:00','FREQ=DAILY',
  'Bundled block — edit steps to taste',
  '[{"text":"Tidy 10 min","done":false},{"text":"Prep tomorrow","done":false},{"text":"Hygiene / brush teeth","done":false},{"text":"Wind down, no phone","done":false}]','seed');

-- ===== Chores (linked to Notion manuals) =====
INSERT INTO events (title,category_id,start,"end",rrule,notion_url,description,source) VALUES
 ('Laundry','13','2026-08-02T11:00:00','2026-08-02T13:00:00','FREQ=WEEKLY;BYDAY=SU',
  'https://app.notion.com/p/32f9f792f0a2838ba59c81715ccc2221','Full guide: Laundry 101','seed'),
 ('Weekly Clean','13','2026-08-01T10:00:00','2026-08-01T12:00:00','FREQ=WEEKLY;BYDAY=SA',
  'https://app.notion.com/p/3a59f792f0a2804d8f4ef5c13f47a6d1','Full guide: Cleaning 101','seed'),
 ('Kitchen Reset','13','2026-08-02T17:00:00','2026-08-02T18:00:00','FREQ=WEEKLY;BYDAY=SU',
  'https://app.notion.com/p/3a59f792f0a2801da2e3e48d92ed4c46','Full guide: Kitchen & Cooking 101','seed'),
 ('Car Check','13','2026-08-01T09:30:00','2026-08-01T10:00:00','FREQ=MONTHLY;BYDAY=1SA',
  'https://app.notion.com/p/0280b2907190481ab65ff1895cc5da23','Full guide: Car Maintenance 101','seed'),
 ('Yard / Outdoors','13','2026-08-08T10:00:00','2026-08-08T11:30:00','FREQ=WEEKLY;INTERVAL=2;BYDAY=SA',
  'https://app.notion.com/p/3a59f792f0a28047a50ed1cf14739cd4','Full guide: Landscaping & Outdoors 101','seed');

-- ===== Slack buffers (visible breathing room) =====
INSERT INTO events (title,category_id,start,"end",rrule,description,source) VALUES
 ('Buffer / Catch-up','14','2026-08-03T16:00:00','2026-08-03T17:00:00','FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  'Unassigned slack time — protected breathing room','seed');
