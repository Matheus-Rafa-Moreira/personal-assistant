import { expandEvents, parseNaive, toNaiveISO } from './occurrences.js';
import { runReplan } from './replan.js';
import { syncCalDav } from './caldav.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function badRequest(msg) {
  return json({ error: msg }, 400);
}

function notFound() {
  return json({ error: 'not found' }, 404);
}

const EVENT_COLUMNS = `id, title, category_id, color_override, start, "end", rrule, exdates,
  description, steps, location, contact_name, contact_phone, notion_url, source, caldav_uid, created_at, updated_at`;

async function loadOverridesByEventId(env, eventIds) {
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

async function handleGetEvents(url, env) {
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  if (!start || !end) return badRequest('start and end query params are required');

  // Fetch every event whose base start is before the range end, and whose
  // recurrence (if any) hasn't necessarily ended — occurrence expansion below
  // narrows it down to the requested range.
  const rows = await env.DB.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE start < ?`)
    .bind(end)
    .all();

  const overridesByEventId = await loadOverridesByEventId(env, rows.results.map((r) => r.id));
  const occurrences = expandEvents(rows.results, overridesByEventId, start, end);
  return json(occurrences);
}

async function handleCreateEvent(request, env) {
  const body = await request.json();
  if (!body.title || !body.start || !body.end) return badRequest('title, start, end are required');

  const result = await env.DB.prepare(
    `INSERT INTO events (title, category_id, color_override, start, "end", rrule, exdates, description, steps, location, contact_name, contact_phone, notion_url, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'app')`
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
      body.notionUrl ?? null
    )
    .run();

  const created = await env.DB.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`)
    .bind(result.meta.last_row_id)
    .first();
  return json(created, 201);
}

async function handleUpdateEvent(id, request, env) {
  const body = await request.json();
  const event = await env.DB.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`).bind(id).first();
  if (!event) return notFound();

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

    return json({ ok: true, eventId: event.id, date: body.date });
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

  const updated = await env.DB.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`).bind(id).first();
  return json(updated);
}

async function handleDeleteEvent(id, url, env) {
  const date = url.searchParams.get('date');
  const event = await env.DB.prepare('SELECT id, rrule FROM events WHERE id = ?').bind(id).first();
  if (!event) return notFound();

  if (date && event.rrule) {
    await env.DB.prepare(
      `INSERT INTO event_overrides (event_id, date, new_start, new_end, reason)
       VALUES (?, ?, NULL, NULL, 'cancelled')
       ON CONFLICT(event_id, date) DO UPDATE SET new_start=NULL, new_end=NULL, reason='cancelled'`
    )
      .bind(id, date)
      .run();
    return json({ ok: true, cancelledDate: date });
  }

  await env.DB.prepare('DELETE FROM event_overrides WHERE event_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function handleGetCategories(env) {
  const rows = await env.DB.prepare('SELECT * FROM categories ORDER BY id').all();
  return json(rows.results);
}

async function handleGetGoals(env) {
  const rows = await env.DB.prepare('SELECT * FROM goals ORDER BY created_at DESC').all();
  return json(rows.results);
}

async function handleCreateGoal(request, env) {
  const body = await request.json();
  if (!body.title) return badRequest('title is required');
  const result = await env.DB.prepare(
    'INSERT INTO goals (title, detail, horizon) VALUES (?, ?, ?)'
  )
    .bind(body.title, body.detail ?? null, body.horizon ?? 'year')
    .run();
  const created = await env.DB.prepare('SELECT * FROM goals WHERE id = ?').bind(result.meta.last_row_id).first();
  return json(created, 201);
}

async function handleReplan(request, env) {
  const body = await request.json();
  if (!body.date || !body.disruption) return badRequest('date and disruption are required');

  const dayStart = `${body.date}T00:00:00`;
  const dayEnd = `${body.date}T23:59:59`;
  const rows = await env.DB.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE start < ?`).bind(dayEnd).all();
  const overridesByEventId = await loadOverridesByEventId(env, rows.results.map((r) => r.id));
  const occurrences = expandEvents(rows.results, overridesByEventId, dayStart, dayEnd);

  const { summary, proposal } = await runReplan(env, occurrences, body.disruption);
  return json({ summary, proposal });
}

async function handleReplanApply(request, env) {
  const body = await request.json();
  if (!body.date || !Array.isArray(body.proposal)) return badRequest('date and proposal[] are required');

  const dayStart = `${body.date}T00:00:00`;
  const dayEnd = `${body.date}T23:59:59`;
  const rows = await env.DB.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE start < ?`).bind(dayEnd).all();
  const overridesByEventId = await loadOverridesByEventId(env, rows.results.map((r) => r.id));
  const currentOccurrences = expandEvents(rows.results, overridesByEventId, dayStart, dayEnd);

  // Cancel every occurrence currently on this date.
  for (const occ of currentOccurrences) {
    await env.DB.prepare(
      `INSERT INTO event_overrides (event_id, date, new_start, new_end, reason)
       VALUES (?, ?, NULL, NULL, ?)
       ON CONFLICT(event_id, date) DO UPDATE SET new_start=NULL, new_end=NULL, reason=excluded.reason`
    )
      .bind(occ.eventId, body.date, `replan ${body.date}`)
      .run();
  }

  // Insert the proposed events as new one-off entries for that date.
  const categories = await env.DB.prepare('SELECT id, name FROM categories').all();
  const categoryByName = new Map(categories.results.map((c) => [c.name.toLowerCase(), c.id]));
  const miscId = categoryByName.get('misc') ?? null;

  for (const item of body.proposal) {
    const categoryId = categoryByName.get(String(item.category || '').toLowerCase()) ?? miscId;
    await env.DB.prepare(
      `INSERT INTO events (title, category_id, start, "end", source) VALUES (?, ?, ?, ?, 'replan')`
    )
      .bind(item.title, categoryId, item.start, item.end)
      .run();
  }

  return json({ ok: true, cancelled: currentOccurrences.length, inserted: body.proposal.length });
}

async function handleNotesInbox(request, env) {
  const auth = request.headers.get('authorization') || '';
  if (auth !== `Bearer ${env.NOTES_INBOX_TOKEN}`) return json({ error: 'unauthorized' }, 401);

  const body = await request.json();
  if (!body.title && !body.body) return badRequest('title or body is required');

  await env.DB.prepare('INSERT INTO notes_inbox (title, body) VALUES (?, ?)')
    .bind(body.title ?? null, body.body ?? null)
    .run();

  return json({ ok: true }, 201);
}

async function handleManualSync(env) {
  const result = await syncCalDav(env);
  return json(result);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const { method } = request;

    try {
      if (pathname === '/api/events' && method === 'GET') return await handleGetEvents(url, env);
      if (pathname === '/api/events' && method === 'POST') return await handleCreateEvent(request, env);

      const eventMatch = pathname.match(/^\/api\/events\/(\d+)$/);
      if (eventMatch && method === 'PATCH') return await handleUpdateEvent(eventMatch[1], request, env);
      if (eventMatch && method === 'DELETE') return await handleDeleteEvent(eventMatch[1], url, env);

      if (pathname === '/api/categories' && method === 'GET') return await handleGetCategories(env);
      if (pathname === '/api/goals' && method === 'GET') return await handleGetGoals(env);
      if (pathname === '/api/goals' && method === 'POST') return await handleCreateGoal(request, env);

      if (pathname === '/api/replan' && method === 'POST') return await handleReplan(request, env);
      if (pathname === '/api/replan/apply' && method === 'POST') return await handleReplanApply(request, env);

      if (pathname === '/api/notes-inbox' && method === 'POST') return await handleNotesInbox(request, env);
      if (pathname === '/api/sync/caldav' && method === 'POST') return await handleManualSync(env);

      if (pathname.startsWith('/api/')) return notFound();

      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ error: err.message || 'internal error' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncCalDav(env));
  },
};
