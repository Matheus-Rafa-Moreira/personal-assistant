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

async function getTargetCalendar(client, env) {
  const calendars = await client.fetchCalendars();
  const targetName = env.CALDAV_CALENDAR_NAME || 'Personal Assistant';
  const match = calendars.find((c) => {
    const name = typeof c.displayName === 'string' ? c.displayName : '';
    return name.toLowerCase() === targetName.toLowerCase();
  });
  if (!match) throw new Error(`CalDAV calendar "${targetName}" not found among: ${calendars.map((c) => c.displayName).join(', ')}`);
  return match;
}

function escapeICSText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function toICSDate(naiveISO) {
  return naiveISO.replace(/[-:]/g, '').slice(0, 15);
}

function buildICS({ uid, title, start, end, location, description, rrule }) {
  const stamp = toICSDate(new Date().toISOString());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Personal Life Assistant//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}Z`,
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    `SUMMARY:${escapeICSText(title)}`,
  ];
  if (location) lines.push(`LOCATION:${escapeICSText(location)}`);
  if (description) lines.push(`DESCRIPTION:${escapeICSText(description)}`);
  if (rrule) lines.push(`RRULE:${rrule}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

function parseVEvent(icsData) {
  const jcal = ICAL.parse(icsData);
  const comp = new ICAL.Component(jcal);
  const vevent = comp.getFirstSubcomponent('vevent');
  if (!vevent) return null;
  const ev = new ICAL.Event(vevent);
  const rruleProp = vevent.getFirstPropertyValue('rrule');
  return {
    uid: ev.uid,
    title: ev.summary || '(untitled)',
    start: toNaiveISO(ev.startDate.toJSDate()),
    end: toNaiveISO(ev.endDate.toJSDate()),
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
  let inserted = 0;
  let updated = 0;
  for (const obj of objects) {
    if (!obj.data) continue;
    let parsed;
    try {
      parsed = parseVEvent(obj.data);
    } catch {
      continue; // skip events ical.js can't parse (e.g. exotic recurrence overrides)
    }
    if (!parsed) continue;

    const existing = await env.DB.prepare('SELECT id FROM events WHERE caldav_uid = ?')
      .bind(parsed.uid)
      .first();

    if (existing) {
      await env.DB.prepare(
        `UPDATE events SET title=?, start=?, "end"=?, location=?, rrule=?, caldav_url=?, caldav_etag=?, updated_at=datetime('now')
         WHERE id=?`
      )
        .bind(parsed.title, parsed.start, parsed.end, parsed.location, parsed.rrule, obj.url, obj.etag, existing.id)
        .run();
      updated++;
    } else {
      await env.DB.prepare(
        `INSERT INTO events (title, start, "end", location, description, rrule, source, caldav_uid, caldav_url, caldav_etag)
         VALUES (?, ?, ?, ?, ?, ?, 'caldav', ?, ?, ?)`
      )
        .bind(parsed.title, parsed.start, parsed.end, parsed.location, parsed.description, parsed.rrule, parsed.uid, obj.url, obj.etag)
        .run();
      inserted++;
    }
  }
  return { inserted, updated };
}

async function push(env, client, calendar) {
  const cursorRow = await env.DB.prepare("SELECT value FROM sync_state WHERE key='last_push'").first();
  const cursor = cursorRow?.value || '1970-01-01T00:00:00Z';

  const rows = await env.DB.prepare(
    `SELECT * FROM events WHERE source IN ('app','replan') AND (caldav_uid IS NULL OR updated_at > ?)`
  )
    .bind(cursor)
    .all();

  let created = 0;
  let updated = 0;
  for (const row of rows.results) {
    const isNew = !row.caldav_uid;
    const uid = row.caldav_uid || crypto.randomUUID();
    const ics = buildICS({
      uid,
      title: row.title,
      start: row.start,
      end: row.end,
      location: row.location,
      description: row.description,
      rrule: row.rrule,
    });

    if (isNew) {
      const filename = `${uid}.ics`;
      const res = await client.createCalendarObject({ calendar, iCalString: ics, filename });
      if (!res.ok) throw new Error(`CalDAV create failed for event ${row.id}: ${res.status}`);
      const url = new URL(filename, calendar.url).href;
      const etag = res.headers.get('etag') || (await fetchEtag(client, calendar, url));
      await env.DB.prepare('UPDATE events SET caldav_uid=?, caldav_url=?, caldav_etag=? WHERE id=?')
        .bind(uid, url, etag, row.id)
        .run();
      created++;
    } else {
      const res = await client.updateCalendarObject({
        calendarObject: { url: row.caldav_url, etag: row.caldav_etag, data: ics },
      });
      if (!res.ok) throw new Error(`CalDAV update failed for event ${row.id}: ${res.status}`);
      const etag = res.headers.get('etag') || (await fetchEtag(client, calendar, row.caldav_url));
      await env.DB.prepare('UPDATE events SET caldav_etag=? WHERE id=?').bind(etag, row.id).run();
      updated++;
    }
  }

  await env.DB.prepare(
    `INSERT INTO sync_state (key, value) VALUES ('last_push', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  )
    .bind(new Date().toISOString())
    .run();

  return { created, updated };
}

async function fetchEtag(client, calendar, url) {
  const [obj] = await client.fetchCalendarObjects({ calendar, objectUrls: [url] });
  return obj?.etag || null;
}

export async function syncCalDav(env) {
  const client = await getClient(env);
  const calendar = await getTargetCalendar(client, env);
  const pullResult = await pull(env, client, calendar);
  const pushResult = await push(env, client, calendar);
  await env.DB.prepare(
    `INSERT INTO sync_state (key, value) VALUES ('last_sync', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  )
    .bind(new Date().toISOString())
    .run();
  return { pull: pullResult, push: pushResult };
}
