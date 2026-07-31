import { syncCalDav } from './caldav.js';
import { runAlfredChat, transcribeAudio } from './alfred.js';
import {
  queryOccurrences,
  createEvent,
  updateEvent,
  deleteEvent,
  listCategories,
  listGoals,
  createGoal,
  replanDay,
  applyReplan,
  getYearState,
  carryYearForward,
} from './db.js';

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

async function handleGetEvents(url, env) {
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  if (!start || !end) return badRequest('start and end query params are required');
  return json(await queryOccurrences(env, start, end));
}

async function handleCreateEvent(request, env) {
  const body = await request.json();
  try {
    const created = await createEvent(env, body);
    return json(created, 201);
  } catch (err) {
    return badRequest(err.message);
  }
}

async function handleUpdateEvent(id, request, env) {
  const body = await request.json();
  const updated = await updateEvent(env, id, body);
  if (!updated) return notFound();
  return json(updated);
}

async function handleDeleteEvent(id, url, env) {
  const date = url.searchParams.get('date');
  const result = await deleteEvent(env, id, date);
  if (!result) return notFound();
  return json(result);
}

async function handleGetCategories(env) {
  return json(await listCategories(env));
}

async function handleGetGoals(env) {
  return json(await listGoals(env));
}

async function handleCreateGoal(request, env) {
  const body = await request.json();
  try {
    return json(await createGoal(env, body), 201);
  } catch (err) {
    return badRequest(err.message);
  }
}

async function handleReplan(request, env) {
  const body = await request.json();
  if (!body.date || !body.disruption) return badRequest('date and disruption are required');
  const { summary, proposal } = await replanDay(env, body.date, body.disruption);
  return json({ summary, proposal });
}

async function handleReplanApply(request, env) {
  const body = await request.json();
  if (!body.date || !Array.isArray(body.proposal)) return badRequest('date and proposal[] are required');
  const result = await applyReplan(env, body.date, body.proposal);
  return json({ ok: true, ...result });
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

async function handleAlfredChat(request, env) {
  const body = await request.json();
  if (!Array.isArray(body.messages)) return badRequest('messages[] is required');
  const { reply, actions } = await runAlfredChat(env, body.messages);
  return json({ reply, actions });
}

async function handleAlfredTranscribe(request, env) {
  const { text } = await transcribeAudio(env, request);
  return json({ text });
}

async function handleYearState(env) {
  return json(await getYearState(env));
}

async function handleCarryForward(env) {
  return json(await carryYearForward(env));
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

      if (pathname === '/api/alfred/chat' && method === 'POST') return await handleAlfredChat(request, env);
      if (pathname === '/api/alfred/transcribe' && method === 'POST') return await handleAlfredTranscribe(request, env);

      if (pathname === '/api/year-state' && method === 'GET') return await handleYearState(env);
      if (pathname === '/api/year-state/carry-forward' && method === 'POST') return await handleCarryForward(env);

      if (pathname.startsWith('/api/')) return notFound();

      return env.ASSETS.fetch(request);
    } catch (err) {
      const message = err.message || 'internal error';
      // reply included so the Alfred widget surfaces real failures
      // instead of masking them as "Sorry, I didn't catch that."
      return json({ error: message, reply: `⚠️ Alfred hit a backend error: ${message}` }, 500);
    }
  },

  // CalDAV sync is READ-ONLY pull-in from the family calendar (see
  // REFINEMENTS.md V2 decision log) — never pushes app events out.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncCalDav(env));
  },
};
