import ICAL from 'ical.js';
import { createDAVClient } from 'tsdav';
import { toNaiveISO } from './occurrences.js';

const PULL_WINDOW_DAYS_BACK = 7;
const PULL_WINDOW_DAYS_FORWARD = 120;

async function getClient(env) {
  return createDAVClient({
    serverUrl: 'https://caldav.icloud.com',
    credentials: { username: env.APPLE_ID, password: env.APPLE_APP_PASSWORD },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
}

// Family calendar picker (REFINEMENTS.md V3 #4): sync_state.caldav_target_calendar
// wins when set (chosen via More menu -> "Sync source..."), falling back to the
// CALDAV_CALENDAR_NAME secret so existing deployments keep working untouched.
async function getTargetCalendarName(env) {
  const row = await env.DB.prepare("SELECT value FROM sync_state WHERE key='caldav_target_calendar'").first();
  return row?.value || env.CALDAV_CALENDAR_NAME || 'Personal Assistant';
}

export async function setSyncTarget(env, name) {
  await env.DB.prepare(
    `INSERT INTO sync_state (key, value) VALUES ('caldav_target_calendar', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  )
    .bind(name)
    .run();
  return { ok: true, target: name };
}

// Lists CalDAV calendar display names using the existing Apple ID creds, so the
// UI can offer a picker instead of round-tripping through `wrangler secret put`.
export async function listCalendars(env) {
  const client = await getClient(env);
  const calendars = await client.fetchCalendars();
  return calendars.map((c) => ({ displayName: typeof c.displayName === 'string' ? c.displayName : String(c.displayName || '') }));
}

async function getTargetCalendar(client, env) {
  const calendars = await client.fetchCalendars();
  const targetName = await getTargetCalendarName(env);
  const match = calendars.find((c) => {
    const name = typeof c.displayName === 'string' ? c.displayName : '';
    return name.toLowerCase() === targetName.toLowerCase();
  });
  if (!match) throw new Error(`CalDAV calendar "${targetName}" not found among: ${calendars.map((c) => c.displayName).join(', ')}`);
  return match;
}

// Convert an absolute instant to a naive wall-clock ISO string in the given
// IANA time zone. Workers run in UTC, so toISOString() alone shifted every
// synced event by the UTC offset (e.g. an 8:45pm Toronto game saved as 00:45).
// All-day events keep their calendar date with no zone shift.
function pad(n, w = 2) { return String(n).padStart(w, '0'); }
function icalTimeToNaive(icalTime, timeZone) {
  const tz = timeZone || 'America/Toronto';
  if (icalTime.isDate) {
    return `${pad(icalTime.year, 4)}-${pad(icalTime.month)}-${pad(icalTime.day)}T00:00:00`;
  }
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(icalTime.toJSDate()).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}`;
}

// Imported summaries arrive with hard newlines and narrow no-break spaces
// pasted in from other apps ("Read Write and Think\nScheduled: Aug 12, 2024 at
// 9:00 AM"), which break the single-line layout of the list and day views.
// Collapse to one line here so nothing downstream has to cope with it.
function cleanTitle(raw) {
  const flat = String(raw || '')
    .replace(/[   ]/g, ' ')
    .replace(/\s*[\r\n]+\s*/g, ' — ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!flat) return '(untitled)';
  return flat.length > 120 ? `${flat.slice(0, 119).trimEnd()}…` : flat;
}

// Imported events used to land with no category at all, which rendered the
// whole calendar in the uncategorised grey and left the day list with a blank
// subtitle. They come from a family calendar, so Family is the honest default;
// the obvious sport and activity cases get sorted out on the way in. Applied
// only on INSERT, so re-categorising an event in the app survives the next sync.
const IMPORT_RULES = [
  [/\b(soccer|futsal|tennis|volleyball|basketball|hockey|baseball|swim|game|practice|tournament|osa)\b/i, 'Athletic'],
  [/\b(gym|workout|training|run|yoga|pilates)\b/i, 'Fitness'],
  [/\b(camp|lesson|lessons|piano|guitar|choir|tutor|read write and think)\b/i, 'Extracurriculars'],
];

export function classifyImportedEvent(title, categoryIdByName) {
  const pick = (name) => categoryIdByName.get(name.toLowerCase()) ?? null;
  for (const [pattern, name] of IMPORT_RULES) {
    if (pattern.test(title)) {
      const id = pick(name);
      if (id) return id;
    }
  }
  return pick('Family');
}

function parseVEvent(icsData, timeZone) {
  const jcal = ICAL.parse(icsData);
  const comp = new ICAL.Component(jcal);
  const vevent = comp.getFirstSubcomponent('vevent');
  if (!vevent) return null;
  const ev = new ICAL.Event(vevent);
  const rruleProp = vevent.getFirstPropertyValue('rrule');
  return {
    uid: ev.uid,
    title: cleanTitle(ev.summary),
    start: icalTimeToNaive(ev.startDate, timeZone),
    end: icalTimeToNaive(ev.endDate, timeZone),
    // ICAL marks a date-only DTSTART as isDate. Without carrying this through,
    // an all-day event becomes a 24-hour timed block that covers the entire
    // column in week and day view.
    allDay: !!ev.startDate?.isDate,
    location: ev.location || null,
    description: ev.description || null,
    rrule: rruleProp ? rruleProp.toString() : null,
  };
}

async function pull(env, client, calendar) {
  const now = Date.now();
  const timeRange = {
    start: new Date(now - PULL_WINDOW_DAYS_BACK * 86400000).toISOString(),
    end: new Date(now + PULL_WINDOW_DAYS_FORWARD * 86400000).toISOString(),
  };
  const objects = await client.fetchCalendarObjects({ calendar, timeRange });

  const categoryRows = await env.DB.prepare('SELECT id, name FROM categories').all();
  const categoryIdByName = new Map(categoryRows.results.map((c) => [c.name.toLowerCase(), c.id]));

  let inserted = 0;
  let updated = 0;
  for (const obj of objects) {
    if (!obj.data) continue;
    let parsed;
    try {
      parsed = parseVEvent(obj.data, env.TIMEZONE || 'America/Toronto');
    } catch {
      continue; // skip events ical.js can't parse (e.g. exotic recurrence overrides)
    }
    if (!parsed) continue;

    const existing = await env.DB.prepare('SELECT id FROM events WHERE caldav_uid = ?')
      .bind(parsed.uid)
      .first();

    if (existing) {
      // category_id is deliberately not touched on update: if you re-file an
      // imported event in the app, the next sync must not undo that.
      await env.DB.prepare(
        `UPDATE events SET title=?, start=?, "end"=?, all_day=?, location=?, rrule=?, caldav_url=?, caldav_etag=?, updated_at=datetime('now')
         WHERE id=?`
      )
        .bind(parsed.title, parsed.start, parsed.end, parsed.allDay ? 1 : 0, parsed.location, parsed.rrule, obj.url, obj.etag, existing.id)
        .run();
      updated++;
    } else {
      await env.DB.prepare(
        `INSERT INTO events (title, category_id, start, "end", all_day, location, description, rrule, source, caldav_uid, caldav_url, caldav_etag)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'caldav', ?, ?, ?)`
      )
        .bind(
          parsed.title,
          classifyImportedEvent(parsed.title, categoryIdByName),
          parsed.start,
          parsed.end,
          parsed.allDay ? 1 : 0,
          parsed.location,
          parsed.description,
          parsed.rrule,
          parsed.uid,
          obj.url,
          obj.etag
        )
        .run();
      inserted++;
    }
  }
  return { inserted, updated };
}

// READ-ONLY import from the family iCloud calendar (CALDAV_CALENDAR_NAME).
// Per REFINEMENTS.md V2 decision log this is pull-in ONLY — the app never
// writes app events out to CalDAV. Upserts by caldav_uid, source='caldav'.
export async function syncCalDav(env) {
  const client = await getClient(env);
  const calendar = await getTargetCalendar(client, env);
  const pullResult = await pull(env, client, calendar);
  await env.DB.prepare(
    `INSERT INTO sync_state (key, value) VALUES ('last_sync', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  )
    .bind(new Date().toISOString())
    .run();
  return { pull: pullResult };
}
