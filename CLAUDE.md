# CLAUDE.md — Personal Life Assistant (Matthew R. Moreira)

THE BRAIN FILE. Any Claude session (chat or Claude Code) resumes from here.

## Mission
A private, free, all-devices "everything calendar" PWA for one user (Matt).
Unifies school, routines, chores, family, goals, misc into one color-coded
calendar with rich event details and an AI "adaptive replanning" feature.
Deployed on Cloudflare (Workers + D1 + static assets) at:
  https://matthew-r-moreira-mypersonallifeassistant.ca  (domain already in CF account)
Gated by Cloudflare Access (only Matt's email). v2 later: sellable template version.

## Architecture (LOCKED — do not change without asking Matt)
- Frontend: NO-BUILD static assets in /public. Vanilla JS + FullCalendar via CDN
  (dayGrid, timeGrid, list, rrule plugin). PWA: manifest.json + sw.js (cache shell).
- Backend: single Cloudflare Worker (src/worker.js), ES modules, bundled by wrangler.
- DB: Cloudflare D1 "personal-assistant-db" id=159ee2e4-308f-4d16-a557-921a14a1356c
  Schema: db/schema.sql, seed: db/seed.sql (apply with wrangler d1 execute --remote).
- Deps: tsdav + ical.js (Worker only, for CalDAV). devDep: wrangler.
- Cron: one scheduled() handler every 30 min -> CalDAV two-way sync.

## Secrets (NEVER commit; NEVER echo into chat; Matt pastes them himself)
wrangler secret put for each: OPENAI_API_KEY, APPLE_ID (email),
APPLE_APP_PASSWORD (app-specific pw), NOTES_INBOX_TOKEN (random string),
CALDAV_CALENDAR_NAME (target iCloud calendar, default "Personal Assistant").
Local dev: .dev.vars (gitignored). OPENAI_MODEL var defaults to "gpt-5-mini".

## API contract (Worker routes; JSON; no auth in-app — Cloudflare Access is the gate)
GET  /api/events?start=ISO&end=ISO   -> expanded occurrences for range
POST /api/events                     -> create (accepts rrule string)
PATCH/api/events/:id                 -> update  DELETE /api/events/:id
GET  /api/categories                 -> list    GET/POST /api/goals
POST /api/replan  {date, disruption} -> calls OpenAI, returns {proposal:[events], summary}
POST /api/replan/apply {date, proposal} -> writes overrides for that date
POST /api/notes-inbox  (Bearer NOTES_INBOX_TOKEN) {title, body} -> store raw note
POST /api/sync/caldav               -> manual trigger of the cron sync
Occurrence expansion: rrule lib server-side OR FullCalendar rrule client-side —
implementer's choice, but /api/replan needs server-side expansion for the day.

## Frontend requirements
- Views: month / week / day / list. Category colors from DB; per-event color
  override allowed (school courses keep their ACORN colors).
- Slack/buffer time = its own category with distinct muted color (#94A3B8).
- Event detail drawer: description, sub-routine checklist (JSON steps),
  location (tap -> Apple Maps link), contact (tap -> tel:), Notion deep-link,
  repeat rule, category. Quick-add bar optimized for <=20s entry on mobile.
- Replan flow: button "Something changed" -> text box -> shows proposed day
  side-by-side vs current -> Accept writes overrides. No push notifications ever.
- Clean, calm UI. Dark-mode friendly. iPhone/iPad/Mac Safari PWA installable.

## Replan prompt (Worker-side, keep tokens lean)
System: "You are Matt's schedule replanner. Given today's events (JSON) and a
disruption, output STRICT JSON {summary, proposal:[{title,start,end,category}]}
keeping fixed commitments (school) unless impossible, preserving routines,
inserting slack." Use OPENAI_MODEL. NOTE: gpt-5-family models REJECT
`temperature` and `max_tokens` — use `max_completion_tokens` and omit
temperature. Sending the old params made every Alfred call 400 (surfaced
to Matt as "Sorry, I didn't catch that"). Do not reintroduce them.

## Data notes
- Timetable seeded from UofT ACORN Fall 2026 (see db/seed.sql). H1 F courses end
  ~2026-12-08; MAT133Y1 is full-year (until ~2027-04-09). EXDATEs applied for
  fall reading week (Oct 26-30 2026), winter closure (Dec 24 2026-Jan 5 2027),
  and winter reading week (Feb 15-19 2027) per UTSC/KPE sessional dates —
  worth a quick cross-check against ACORN for section-specific exceptions.
- Notion manuals are LINKED not copied (notion_url on events). Live Notion sync = v2.
- Apple Notes: Shortcuts automation POSTs to /api/notes-inbox hourly
  (calendar-event trigger workaround). Recipe in README.
- Goals: table exists, UI section, seeded empty. Matt fills in-app.

## Deploy runbook
1. npm install
2. npx wrangler login            (Matt clicks Allow)
3. npx wrangler d1 execute personal-assistant-db --remote --file db/schema.sql
   then --file db/seed.sql
4. npx wrangler secret put <each secret above>   (Matt pastes values)
5. npx wrangler deploy           (wrangler.jsonc already routes the custom domain)
6. Cloudflare dashboard -> Zero Trust -> Access: app for the domain, policy =
   allow only Matt's email (free plan). THEN test PWA install on iPhone.

## Status
[x] Repo scaffold, schema, seed, config (built by Claude chat 2026-07-30)
[x] D1 database created in CF account
[x] worker.js implementation   [x] public/ frontend implementation
[x] npm install                [x] deploy              [x] secrets set
[x] Access gate                [x] Cron trigger (needed a workers.dev
    subdomain provisioned first, then `wrangler deploy` attached it clean)
[x] Shortcuts notes automation [x] on-device testing  [x] Git repo connected
    for auto-deploy on push
CalDAV: confirmed connecting to real iCloud + completing a sync cycle
cleanly (last_sync/last_push in sync_state). Not yet confirmed moving real
data both directions — add a test event in-app and in the "Personal
Assistant" iCloud calendar and check it shows up on the other side after
the next 30-min cycle, whenever convenient.
v2 backlog: sellable template repo, MyScholarshipFinder (idea in Apple Notes),
live Notion sync, call logging, family shared calendar.

## Rules for any agent working here
Small commits with clear messages. Never commit secrets or .dev.vars. Never
print secret values. Don't restructure architecture without Matt's OK. Personal
data stays in this private repo only.


## v1.1 SPEC — "Alfred" upgrade (2026-07-30, from Matt's refinement transcript) — CURRENT WORK
Priority order: (1) Alfred widget, (2) iOS-Calendar-look redesign, (3) year
scoping + rollover, (4) CalDAV family-calendar fix, (5) verify cron registered.

### 1. ALFRED — assistant widget (THE differentiating feature)
- Persistent bottom bar on EVERY view, mobile + desktop: text input + mic
  button + send. Tapping expands a chat sheet (conversation history, session-only).
- Backend: POST /api/alfred {messages:[...]} -> OpenAI chat w/ TOOLS executed
  server-side against D1: list_events(start,end), create_event(obj),
  update_event(id,patch), move_event(id,start,end), delete_event(id),
  replan(date,disruption), list_categories, add_goal, list_goals.
  Loop tool calls until final text; return {reply, actions:[summaries]}.
  Destructive ops (delete, bulk change) need a confirm round-trip.
- System prompt: "You are Alfred, Matt's personal calendar assistant." Inject
  today's date, TZ America/Toronto, category list. Replies SHORT and speakable.
- Voice IN: Web Speech API (webkitSpeechRecognition) where available;
  fallback MediaRecorder -> POST /api/transcribe -> OpenAI transcription.
- Voice OUT: if the turn arrived by voice, speak reply via speechSynthesis
  (natural en voice, mute toggle). Conversation feel: voice in -> voice out.
- Calendar view refreshes immediately after any Alfred write.

### 2. iOS CALENDAR LOOKALIKE (frontend redesign)
- FACT: Apple Calendar is not open source; replicate the AESTHETIC by hand.
  Success criterion = passes the "looks like iOS Calendar" eyeball test.
- -apple-system font stack, iOS red #FF3B30 accent, light/dark auto.
- Month: clean grid, tiny event dots/bars, today = red circle. Tap day ->
  day timeline (hour lines, rounded colored blocks w/ left accent bar).
  Week + list views styled to match. Top bar: "< Year", month title, +.
- Keep no-build vanilla JS. If FullCalendar can't be themed close enough,
  hand-roll month grid + day timeline (permitted and probably cleaner).
- Event sheet mirrors iOS: rounded card; rows for time, repeat, location
  (-> Apple Maps link), contact (-> tel:), Notion link, checklist steps.
- De-clutter is the point: fewer borders, more whitespace, no toolbars.

### 3. YEAR SCOPING + ROLLOVER
- sync_state key active_year (default 2026). All navigation clamped to
  Jan 1 - Dec 31 of active_year (matches Matt's storage/simplicity intent).
- Settings: "Prepare 2027" wizard -> copies recurring events forward with
  new UNTILs, shows review list for edits, then switches active_year.

### 4. CALDAV FIX
- Matt set the wrong target calendar during secrets. His iCloud calendars:
  Family, Home, Work, Holidays in Canada, Birthdays, (+gmail accounts).
- Fix: npx wrangler secret put CALDAV_CALENDAR_NAME -> value exactly: Family
- Sync loop must read/write ONLY that calendar.

### 5. Verify the */30 cron actually registered on deploy (commit dc932fa
  noted it pending). wrangler deploy output must list the schedule.

### Acceptance test (all must pass before "done")
- One VOICE prompt to Alfred creates an event, moves another, and answers
  "what does my Tuesday look like" — spoken reply.
- UI eyeball test vs iOS Calendar passes on iPhone + desktop.
- Year nav clamped to 2026; rollover wizard produces editable 2027 copy.
- Family calendar shows a test event synced from the app within 30 min.

## V2 DECISION LOG (2026-07-30)
- Family calendar CalDAV sync: PULL IN ONLY (read-only import; never push).
- Authoritative V2 spec: REFINEMENTS.md (wins over v1.1 notes above on conflict).

## SESSION LOG 2026-07-31 (categories + deploy + tz fix)
- CATEGORIES: replaced 8-cat scheme with the 14 locked categories (Academic,
  Athletic, Fitness, Religion, Family, Languages, Business, University, Social,
  Intelligence, Extracurriculars, Bonus, Miscellaneous, Slack/Buffer) + rainbow
  palette. Applied LIVE via Cloudflare D1 MCP. Seed events remapped: courses->
  Academic(1); routines+chores->Miscellaneous(13) [Matt to confirm vs Bonus];
  buffer->Slack/Buffer(14). Frontend reads /api/categories dynamically = auto.
  TODO: dark-mode white/gray category colors (Matt's "nocturnal" request) - CSS.
- DEPLOYED HEAD (design refinement pass + full V3) — was committed but never
  deployed; that's why Matt "couldn't see the changes". Versions this session:
  756c7f18 (design+V3+cats), 3eb8adc9 (tz fix).
- TZ FIX: caldav.js stored synced times via toNaiveISO=UTC on a UTC Worker ->
  every synced event +offset (8:45pm shown as 00:45). Added all-day-safe
  icalTimeToNaive() using Intl in America/Toronto; toNaiveISO left untouched
  (recurrence engine depends on its naive round-trip). Corrected times land on
  next sync (cron :00/:30 or in-app Sync Now).
- OPEN: (1) Matt picks correct sync calendar via More->Sync source (many synced
  events "don't pertain to me"); after that, bulk-categorize caldav events via
  D1 + prune stale rows from the old calendar. (2) routines/chores category home.
  (3) template repo (sellable/tailorable + fill-out form) still to build.

## SESSION LOG 2026-08-02 (dark-mode colours + punch-list cleanup)
- DARK MODE ("nocturnal"): categories.color_dark added (D1 + schema.sql +
  db/migrations/004 + seed.sql). Miscellaneous -> #F5F5F7 (white),
  Slack/Buffer -> #8E8E93 (gray), all other hues brightened to iOS dark
  values. app.js: isDarkMode()/catColor()/contrastText()/refreshThemeColors();
  every colour site now theme-aware; badge text switches black/white by
  luminance (the stylesheet's blanket `color: white` would have made the white
  category unreadable). OS-level theme flips repaint via matchMedia listener.
  Repaint happens WITHOUT rebuilding markup so open sheets keep their state.
- DOC FIX: removed the stale "temperature 0.3 / max_tokens" guidance that
  caused the original Alfred 400s; replaced with an explicit gpt-5 warning.
- SW cache pla-shell-v7 -> v8 so PWAs pull the new app.js.
- Test data wiped (event id 38 "Test Event"). NOTE: it was source='caldav', so
  if it still exists in the Apple calendar it WILL resync — delete it there.
- Deploys this session: 1ca9a0c5 (dark colours). Verified via D1; live HTTP
  checks return the Cloudflare Access login page by design (gate works).
- STILL OPEN: (1) Matt picks sync source in-app; then bulk-categorize the 64
  caldav events + prune ones from the wrong calendar. (2) routines/chores
  category home (currently Miscellaneous — Bonus is the alternative).
  (3) confirm UofT fall reading week EXDATEs (seed assumes 2026-10-28).
  (4) on-device test: Alfred text/voice + reminder permission prompt.
  (5) FINAL ITEM: sellable template repo + tailoring form.
