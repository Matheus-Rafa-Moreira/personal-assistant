import {
  queryOccurrences,
  createEvent,
  updateEvent,
  deleteEvent,
  listCategories,
  listGoals,
  createGoal,
  searchNotesInbox,
  replanDay,
  setReminder,
} from './db.js';

const MAX_TOOL_ROUNDS = 6;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'query_schedule',
      description: "List Matt's events between two naive local datetimes (no timezone suffix).",
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'string', description: 'ISO datetime, e.g. 2026-09-15T00:00:00' },
          end: { type: 'string', description: 'ISO datetime, e.g. 2026-09-16T00:00:00' },
        },
        required: ['start', 'end'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_event',
      description: 'Create a new calendar event.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          start: { type: 'string', description: 'ISO datetime, naive local time' },
          end: { type: 'string', description: 'ISO datetime, naive local time' },
          category: { type: 'string', description: 'One of the category names given in your instructions' },
          rrule: { type: 'string', description: 'Optional RFC5545 RRULE string for recurring events' },
          description: { type: 'string' },
          location: { type: 'string' },
        },
        required: ['title', 'start', 'end'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_event',
      description: "Change an existing event's title, time, category, description, or location.",
      parameters: {
        type: 'object',
        properties: {
          eventId: { type: 'integer' },
          title: { type: 'string' },
          start: { type: 'string' },
          end: { type: 'string' },
          category: { type: 'string' },
          description: { type: 'string' },
          location: { type: 'string' },
          occurrenceDate: {
            type: 'string',
            description: 'YYYY-MM-DD — set this to edit only one occurrence of a recurring event instead of the whole series',
          },
        },
        required: ['eventId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_event',
      description: 'Move an event (or one occurrence of a recurring event) to a new start/end time.',
      parameters: {
        type: 'object',
        properties: {
          eventId: { type: 'integer' },
          newStart: { type: 'string' },
          newEnd: { type: 'string' },
          occurrenceDate: {
            type: 'string',
            description: 'YYYY-MM-DD — set this to move only one occurrence of a recurring event',
          },
        },
        required: ['eventId', 'newStart', 'newEnd'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_event',
      description:
        'Delete an event, or cancel one occurrence of a recurring event. Destructive — the first call without confirm:true will NOT delete anything; it only reports that confirmation is required. Ask Matt to confirm, then call again with confirm:true.',
      parameters: {
        type: 'object',
        properties: {
          eventId: { type: 'integer' },
          occurrenceDate: { type: 'string', description: 'YYYY-MM-DD — set to cancel only one occurrence' },
          confirm: { type: 'boolean', description: 'Must be true to actually perform the deletion' },
        },
        required: ['eventId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replan_day',
      description:
        'Given a disruption, propose a revised schedule for a day. This only proposes — it does not change the calendar. Tell Matt to use the "Something changed" panel to accept it, or summarize the proposal for him.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          disruption: { type: 'string', description: "What changed, e.g. 'gym cancelled, dentist at 2pm instead'" },
        },
        required: ['date', 'disruption'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_goal',
      description: 'Add a new goal.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          horizon: { type: 'string', enum: ['year', 'semester', 'month'] },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_goals',
      description: "List Matt's goals.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_notes_inbox',
      description: 'Search raw notes Matt has captured via the Apple Notes inbox.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_reminder',
      description:
        "Set an opt-in web-push reminder for one occurrence of an event, some number of minutes before it starts. Only works if Matt has enabled notifications in the app at least once — if the tool result says so, tell him to tap 'Reminder' on the event in-app first.",
      parameters: {
        type: 'object',
        properties: {
          eventId: { type: 'integer' },
          occurrenceDate: { type: 'string', description: 'YYYY-MM-DD' },
          minutesBefore: { type: 'integer', description: 'Minutes before the event to fire the reminder (0 = at start time)' },
        },
        required: ['eventId', 'occurrenceDate', 'minutesBefore'],
      },
    },
  },
];

function systemPrompt(todayISO, categories) {
  const categoryNames = categories.map((c) => c.name).join(', ');
  return `You are Alfred, Matt's personal calendar assistant. Today's date is ${todayISO}, timezone America/Toronto. \
Categories: ${categoryNames}. Ground every answer ONLY in data returned by your tools — never invent events, times, or goals. \
Keep replies SHORT and speakable (1-3 sentences), suitable for being read aloud by a voice synthesizer. \
Matt often talks to you in short, terse spoken commands — read them charitably, using the conversation so far for context, but \
NEVER guess a missing date, time, duration, or title. If any of those are missing or ambiguous for the action he wants, ask ONE \
short clarifying question instead of calling a tool with a made-up value. \
After ANY write action (create, update, move, delete, set_reminder) succeeds, confirm plainly and specifically what changed — \
e.g. "Added Dentist, Fri Aug 7, 3-4pm — want a reminder?" — never a vague "done" or "okay". \
If a tool call fails or a tool result contains an error, say so plainly in your reply — never mask, hide, or soften a real \
backend error behind a generic apology. \
delete_event requires confirm:true to actually run — if it reports confirmation is required, ask Matt to confirm before retrying.`;
}

async function execTool(env, categories, name, args) {
  const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const resolveCategory = (name) => (name ? categoryByName.get(String(name).toLowerCase()) ?? null : undefined);

  switch (name) {
    case 'query_schedule': {
      const occs = await queryOccurrences(env, args.start, args.end);
      return occs.map((o) => ({
        eventId: o.eventId,
        title: o.title,
        start: o.start,
        end: o.end,
        category: categories.find((c) => c.id === o.categoryId)?.name || null,
        location: o.location,
      }));
    }
    case 'create_event': {
      const created = await createEvent(env, {
        title: args.title,
        start: args.start,
        end: args.end,
        categoryId: resolveCategory(args.category) ?? null,
        rrule: args.rrule || null,
        description: args.description || null,
        location: args.location || null,
      });
      return { ok: true, event: { id: created.id, title: created.title, start: created.start, end: created.end } };
    }
    case 'update_event': {
      const patch = {};
      if (args.title) patch.title = args.title;
      if (args.start) patch.start = args.start;
      if (args.end) patch.end = args.end;
      if (args.description) patch.description = args.description;
      if (args.location) patch.location = args.location;
      if (args.category) patch.categoryId = resolveCategory(args.category);
      if (args.occurrenceDate) patch.date = args.occurrenceDate;
      const updated = await updateEvent(env, args.eventId, patch);
      if (!updated) return { ok: false, error: 'event not found' };
      return { ok: true, result: updated };
    }
    case 'move_event': {
      const patch = { start: args.newStart, end: args.newEnd };
      if (args.occurrenceDate) patch.date = args.occurrenceDate;
      const updated = await updateEvent(env, args.eventId, patch);
      if (!updated) return { ok: false, error: 'event not found' };
      return { ok: true, result: updated };
    }
    case 'delete_event': {
      if (!args.confirm) {
        return {
          ok: false,
          requiresConfirmation: true,
          message: 'Ask Matt to confirm this deletion in plain language, then call delete_event again with confirm:true.',
        };
      }
      const result = await deleteEvent(env, args.eventId, args.occurrenceDate || null);
      if (!result) return { ok: false, error: 'event not found' };
      return { ok: true, result };
    }
    case 'replan_day': {
      const { summary, proposal } = await replanDay(env, args.date, args.disruption);
      return { summary, proposal };
    }
    case 'add_goal': {
      const created = await createGoal(env, { title: args.title, detail: args.detail || null, horizon: args.horizon || 'year' });
      return { ok: true, goal: created };
    }
    case 'query_goals': {
      return await listGoals(env);
    }
    case 'search_notes_inbox': {
      return await searchNotesInbox(env, args.query);
    }
    case 'set_reminder': {
      const occs = await queryOccurrences(env, `${args.occurrenceDate}T00:00:00`, `${args.occurrenceDate}T23:59:59`);
      const occ = occs.find((o) => o.eventId === args.eventId && o.occurrenceDate === args.occurrenceDate);
      if (!occ) return { ok: false, error: 'No occurrence found for that event on that date' };
      const result = await setReminder(env, args.eventId, args.occurrenceDate, occ.start, args.minutesBefore);
      return {
        ok: true,
        reminder: result,
        note: 'This only fires if Matt has enabled push notifications in the app at least once (tap Reminder on an event in-app to opt in).',
      };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

// Runs the OpenAI tool-calling loop grounded in D1 via db.js, looping tool
// calls until the model returns final text. `messages` is prior conversation
// turns (role/content only) — the system prompt is injected fresh each call
// so it always carries today's date and the live category list.
export async function runAlfredChat(env, messages) {
  const categories = await listCategories(env);
  const today = new Date().toISOString().slice(0, 10);
  const convo = [{ role: 'system', content: systemPrompt(today, categories) }, ...messages];
  const actions = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        messages: convo,
        tools: TOOLS,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI request failed (${res.status}): ${body}`);
    }

    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('OpenAI response had no message');

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { reply: msg.content || '', actions };
    }

    convo.push({ role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls });

    for (const call of msg.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        args = {};
      }
      const result = await execTool(env, categories, call.function.name, args);
      actions.push({ tool: call.function.name, args, result });
      convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  return { reply: "I'm having trouble finishing that — could you try rephrasing?", actions };
}

// Proxies an audio blob to OpenAI's transcription API. The OpenAI key never
// leaves the Worker; the client only ever sees {text}.
export async function transcribeAudio(env, request) {
  const arrayBuffer = await request.arrayBuffer();
  const contentType = request.headers.get('content-type') || 'audio/webm';
  const ext = contentType.includes('mp4') ? 'mp4' : contentType.includes('wav') ? 'wav' : contentType.includes('ogg') ? 'ogg' : 'webm';

  const form = new FormData();
  form.append('file', new Blob([arrayBuffer], { type: contentType }), `audio.${ext}`);
  form.append('model', 'whisper-1');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`transcription failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return { text: data.text || '' };
}
