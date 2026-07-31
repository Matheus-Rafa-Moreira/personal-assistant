import { expandEvents, parseNaive, toNaiveISO } from './occurrences.js';
import { runReplan } from './replan.js';

// Shared D1 access layer. Used by both the HTTP handlers in worker.js and the
// Alfred tool-calling agent (alfred.js) so the two paths can never drift.

export const EVENT_COLUMNS = `id, title, category_id, color_override, start, "end", rrule, exdates,
  description, steps, location, contact_name, contact_phone, notion_url, source, caldav_uid, created_at, updated_at`;

export async function loadOverridesByEventId(env, eventIds) {
  const map = new Map();
  if (eventIds.length === 0) return map;
  const placeholders = eventIds.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT * FROM event_overrides WHERE event_id IN (${placeholders})`
  )
    .bind(...eventIds)
    .all();
  for (const row of rows.results) {
    if (!map.has(row.event_id)) map.set(row.event_id, []);
    map.get(row.event_id).push(row);
  }
  return map;
}

export async function queryOccurrences(env, startISO, endISO) {
  const rows = await env.DB.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE start < ?`).bind(endISO).all();
  const overridesByEventId = await loadOverridesByEventId(env, rows.results.map((r) => r.id));
  return expandEvents(rows.results, overridesByEventId, startISO, endISO);
}

export async function getEvent(env, id) {
  return env.DB.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`).bind(id).first();
}

export async function createEvent(env, body) {
  if (!body.title || !body.start || !body.end) throw new Error('title, start, end are required');

  const result = await env.DB.prepare(
    `INSERT INTO events (title, category_id, color_override, start, "end", rrule, exdates, description, steps, location, contact_name, contact_phone, notion_url, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.title,
      body.categoryId ?? null,
      body.colorOverride ?? null,
      body.start,
      body.end,
      body.rrule ?? null,
      body.exdates ? JSON.stringify(body.exdates) : null,
      body.description ?? null,
      body.steps ? JSON.stringify(body.steps) : null,
      body.location ?? null,
      body.contactName ?? null,
      body.contactPhone ?? null,
      body.notionUrl ?? null,
      body.source ?? 'app'
    )
    .run();

  return getEvent(env, result.meta.last_row_id);
}

export async function updateEvent(env, id, body) {
  const event = await getEvent(env, id);
  if (!event) return null;

  if (body.date && event.rrule) {
    // Per-occurrence edit: upsert an override row for that date instead of the base event.
    // new_start/new_end must always resolve to real values here (NULL means "cancelled" to
    // the occurrence expander) — default to this occurrence's current effective time so a
    // steps_state-only or title-only PATCH doesn't accidentally cancel it.
    const existingOverride = await env.DB.prepare(
      'SELECT new_start, new_end FROM event_overrides WHERE event_id = ? AND date = ?'
    )
      .bind(event.id, body.date)
      .first();

    const durationMs = parseNaive(event.end).getTime() - parseNaive(event.start).getTime();
    const timeOfDay = event.start.slice(11);
    const defaultStart = parseNaive(`${body.date}T${timeOfDay}`);
    const defaultEnd = new Date(defaultStart.getTime() + durationMs);

    const newStart = body.start ?? existingOverride?.new_start ?? toNaiveISO(defaultStart);
    const newEnd = body.end ?? existingOverride?.new_end ?? toNaiveISO(defaultEnd);
    const newTitle = body.title ?? null;
    const stepsState = body.stepsState ? JSON.stringify(body.stepsState) : null;

    await env.DB.prepare(
      `INSERT INTO event_overrides (event_id, date, new_start, new_end, new_title, steps_state, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id, date) DO UPDATE SET
         new_start = excluded.new_start,
         new_end = excluded.new_end,
         new_title = COALESCE(excluded.new_title, event_overrides.new_title),
         steps_state = COALESCE(excluded.steps_state, event_overrides.steps_state)`
    )
      .bind(event.id, body.date, newStart, newEnd, newTitle, stepsState, body.reason ?? null)
      .run();

    return { ok: true, eventId: event.id, date: body.date };
  }

  const fields = {
    title: body.title ?? event.title,
    category_id: body.categoryId ?? event.category_id,
    color_override: body.colorOverride ?? event.color_override,
    start: body.start ?? event.start,
    end: body.end ?? event.end,
    rrule: body.rrule !== undefined ? body.rrule : event.rrule,
    exdates: body.exdates ? JSON.stringify(body.exdates) : event.exdates,
    description: body.description ?? event.description,
    steps: body.steps ? JSON.stringify(body.steps) : event.steps,
    location: body.location ?? event.location,
    contact_name: body.contactName ?? event.contact_name,
    contact_phone: body.contactPhone ?? event.contact_phone,
    notion_url: body.notionUrl ?? event.notion_url,
  };

  await env.DB.prepare(
    `UPDATE events SET title=?, category_id=?, color_override=?, start=?, "end"=?, rrule=?, exdates=?,
       description=?, steps=?, location=?, contact_name=?, contact_phone=?, notion_url=?, updated_at=datetime('now')
     WHERE id=?`
  )
    .bind(
      fields.title,
      fields.category_id,
      fields.color_override,
      fields.start,
      fields.end,
      fields.rrule,
      fields.exdates,
      fields.description,
      fields.steps,
      fields.location,
      fields.contact_name,
      fields.contact_phone,
      fields.notion_url,
      id
    )
    .run();

  return getEvent(env, id);
}

export async function deleteEvent(env, id, date) {
  const event = await env.DB.prepare('SELECT id, rrule FROM events WHERE id = ?').bind(id).first();
  if (!event) return null;

  if (date && event.rrule) {
    await env.DB.prepare(
      `INSERT INTO event_overrides (event_id, date, new_start, new_end, reason)
       VALUES (?, ?, NULL, NULL, 'cancelled')
       ON CONFLICT(event_id, date) DO UPDATE SET new_start=NULL, new_end=NULL, reason='cancelled'`
    )
      .bind(id, date)
      .run();
    return { ok: true, cancelledDate: date };
  }

  await env.DB.prepare('DELETE FROM event_overrides WHERE event_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  return { ok: true };
}

export async function listCategories(env) {
  const rows = await env.DB.prepare('SELECT * FROM categories ORDER BY id').all();
  return rows.results;
}

export async function listGoals(env) {
  const rows = await env.DB.prepare('SELECT * FROM goals ORDER BY created_at DESC').all();
  return rows.results;
}

export async function createGoal(env, body) {
  if (!body.title) throw new Error('title is required');
  const result = await env.DB.prepare(
    'INSERT INTO goals (title, detail, horizon) VALUES (?, ?, ?)'
  )
    .bind(body.title, body.detail ?? null, body.horizon ?? 'year')
    .run();
  return env.DB.prepare('SELECT * FROM goals WHERE id = ?').bind(result.meta.last_row_id).first();
}

export async function searchNotesInbox(env, query, limit = 10) {
  const like = `%${query}%`;
  const rows = await env.DB.prepare(
    'SELECT * FROM notes_inbox WHERE title LIKE ? OR body LIKE ? ORDER BY received_at DESC LIMIT ?'
  )
    .bind(like, like, limit)
    .all();
  return rows.results;
}

export async function replanDay(env, date, disruption) {
  const dayStart = `${date}T00:00:00`;
  const dayEnd = `${date}T23:59:59`;
  const occurrences = await queryOccurrences(env, dayStart, dayEnd);
  return runReplan(env, occurrences, disruption);
}

export async function applyReplan(env, date, proposal) {
  const dayStart = `${date}T00:00:00`;
  const dayEnd = `${date}T23:59:59`;
  const currentOccurrences = await queryOccurrences(env, dayStart, dayEnd);

  // Cancel every occurrence currently on this date.
  for (const occ of currentOccurrences) {
    await env.DB.prepare(
      `INSERT INTO event_overrides (event_id, date, new_start, new_end, reason)
       VALUES (?, ?, NULL, NULL, ?)
       ON CONFLICT(event_id, date) DO UPDATE SET new_start=NULL, new_end=NULL, reason=excluded.reason`
    )
      .bind(occ.eventId, date, `replan ${date}`)
      .run();
  }

  // Insert the proposed events as new one-off entries for that date.
  const categories = await listCategories(env);
  const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const miscId = categoryByName.get('misc') ?? null;

  for (const item of proposal) {
    const categoryId = categoryByName.get(String(item.category || '').toLowerCase()) ?? miscId;
    await env.DB.prepare(
      `INSERT INTO events (title, category_id, start, "end", source) VALUES (?, ?, ?, ?, 'replan')`
    )
      .bind(item.title, categoryId, item.start, item.end)
      .run();
  }

  return { cancelled: currentOccurrences.length, inserted: proposal.length };
}

export async function setReminder(env, eventId, occurrenceDate, occurrenceStartISO, minutesBefore) {
  const fireAt = toNaiveISO(new Date(parseNaive(occurrenceStartISO).getTime() - minutesBefore * 60000));
  await env.DB.prepare(
    `INSERT INTO reminders (event_id, occurrence_date, fire_at, sent) VALUES (?, ?, ?, 0)
     ON CONFLICT(event_id, occurrence_date) DO UPDATE SET fire_at=excluded.fire_at, sent=0`
  )
    .bind(eventId, occurrenceDate, fireAt)
    .run();
  return { ok: true, eventId, occurrenceDate, fireAt };
}

export async function savePushSubscription(env, sub) {
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth`
  )
    .bind(sub.endpoint, sub.p256dh, sub.auth)
    .run();
  return { ok: true };
}

export async function getYearState(env) {
  const row = await env.DB.prepare("SELECT value FROM sync_state WHERE key='active_year'").first();
  if (row?.value) return { activeYear: Number(row.value) };
  const defaultYear = new Date().getFullYear();
  await env.DB.prepare(
    `INSERT INTO sync_state (key, value) VALUES ('active_year', ?) ON CONFLICT(key) DO NOTHING`
  )
    .bind(String(defaultYear))
    .run();
  return { activeYear: defaultYear };
}

export async function setYearState(env, year) {
  await env.DB.prepare(
    `INSERT INTO sync_state (key, value) VALUES ('active_year', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  )
    .bind(String(year))
    .run();
}

function shiftYear(naiveISO, delta) {
  const [datePart, timePart] = naiveISO.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  return `${y + delta}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${timePart}`;
}

function shiftRruleUntil(rrule, delta) {
  if (!rrule) return rrule;
  return rrule.replace(/UNTIL=(\d{4})(\d{4}T\d{6})/, (_, y, rest) => `UNTIL=${Number(y) + delta}${rest}`);
}

// "Prepare next year": copy every recurring event's template forward one year
// (new start/end/UNTIL) so Matt can review and tailor exceptions (new EXDATEs,
// section changes, etc.) before the active year switches over. One-off events
// aren't carried forward — they don't repeat, so there's nothing to roll.
export async function carryYearForward(env) {
  const { activeYear: fromYear } = await getYearState(env);
  const toYear = fromYear + 1;

  const rows = await env.DB.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE rrule IS NOT NULL`).all();
  const created = [];
  for (const row of rows.results) {
    const inserted = await createEvent(env, {
      title: row.title,
      categoryId: row.category_id,
      colorOverride: row.color_override,
      start: shiftYear(row.start, 1),
      end: shiftYear(row.end, 1),
      rrule: shiftRruleUntil(row.rrule, 1),
      description: row.description,
      steps: row.steps ? JSON.parse(row.steps) : null,
      location: row.location,
      contactName: row.contact_name,
      contactPhone: row.contact_phone,
      notionUrl: row.notion_url,
      source: 'app',
    });
    created.push(inserted);
  }

  await setYearState(env, toYear);
  return { fromYear, toYear, created };
}
