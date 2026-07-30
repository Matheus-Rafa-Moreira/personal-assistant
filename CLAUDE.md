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
inserting slack." Use OPENAI_MODEL, max_tokens ~1200, temperature 0.3.

## Data notes
- Timetable seeded from UofT ACORN Fall 2026 (see db/seed.sql). H1 F courses end
  ~2026-12-08; MAT133Y1 is full-year (until ~2027-04-09). TODO Matt: confirm
  reading week + winter break EXDATEs.
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
[ ] worker.js implementation   [ ] public/ frontend implementation
[ ] npm install + deploy       [ ] secrets set        [ ] Access gate
[ ] Shortcuts notes automation [ ] on-device testing  [ ] wipe test data
v2 backlog: sellable template repo, MyScholarshipFinder (idea in Apple Notes),
live Notion sync, call logging, family shared calendar.

## Rules for any agent working here
Small commits with clear messages. Never commit secrets or .dev.vars. Never
print secret values. Don't restructure architecture without Matt's OK. Personal
data stays in this private repo only.
