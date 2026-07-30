# REFINEMENTS.md — V2 authoritative spec (locked 2026-07-30, decision final)
Supplements the v1.1 notes in CLAUDE.md. Where they differ, THIS file wins.

## DECISION (from Matt, 2026-07-30): family calendar sync = PULL IN ONLY
- CalDAV scheduled sync becomes a READ-ONLY import from the family calendar:
  upsert events with source='caldav' + caldav_uid. NEVER push app events out.
- Remove/disable any push/two-way write paths to CalDAV.
- CALDAV_CALENDAR_NAME secret will be re-pointed at the family calendar
  (exact name pending from Matt — leave code reading the secret as-is).

## 1. Alfred — agentic widget (the differentiating feature)
- Bottom-docked widget on every view, identical on mobile + desktop. Name: Alfred.
- Text input (keyboard) AND mic voice input; if spoken to, Alfred SPEAKS back
  (conversational loop). Text mode replies as text only.
- Server-side tool-calling agent, grounded ONLY in app data. Tools:
  create_event, update_event, delete_event, move_event, query_schedule,
  replan_day, add_goal, query_goals, search_notes_inbox.
  Execute against D1, then confirm in the reply exactly what changed.

## V2 API additions (Worker)
- POST /api/alfred/chat  {messages:[...]}  -> runs OpenAI tool-calling loop
  (OPENAI_MODEL), executes tools on D1, returns {reply, actions:[...]}.
- POST /api/alfred/transcribe  (audio blob) -> proxies OpenAI transcription,
  returns {text}. OpenAI key stays server-side ONLY — never in client JS.
- Voice OUT: client-side speechSynthesis (free). Voice IN: MediaRecorder ->
  /api/alfred/transcribe (reliable in installed iOS PWAs; native Safari
  SpeechRecognition only as progressive enhancement, never the sole path).
- Reality note: no local LLM inside Workers. Options = OpenAI API (default)
  and/or Cloudflare Workers AI (free daily allocation) as a router target later.

## 2. Year-by-year navigation
- iOS-Calendar drill-down: Year grid -> Month -> Week -> Day.
- Visible range scoped to current year (through Dec 31, 2026).
- "Start next year" action: carry recurring template into next year for
  tailoring (adjust rrule/UNTIL; storage cost is trivial — rules stored once).

## 3. Interface — Apple iOS Calendar lookalike
- Success criteria: as visually close to native iOS Calendar as possible.
  Declutter hard. SF-style system typography, red accent, clean light/dark,
  month dot-grid, day timeline, minimal chrome.
- Apple Calendar is NOT open source — rebuild the look, take no code.
- Optional polish route later: Claude Design pass, ported into public/.
- Two connected sections one tap apart: Calendar | Alfred.

## Build rules for implementing agent
- Modify code files only. Do NOT run shell commands, do NOT deploy, do NOT
  commit — the orchestrating session handles install/deploy/git.
- Never print or embed secret values. Client JS must never contain API keys.
- Keep the quick-add (<=20s entry) and event drawer features working.

## Post-build punch list (orchestrator + Matt)
- [ ] npm install (if deps changed), wrangler deploy
- [ ] Re-point CALDAV_CALENDAR_NAME to family calendar (needs exact name)
- [ ] iPhone: re-test PWA, mic permission prompt, voice loop end-to-end
- [ ] Wipe test data, verify seeded real data intact
- [ ] THEN: sellable template version (standing reminder)
