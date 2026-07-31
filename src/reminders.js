import { queryOccurrences } from './db.js';
import { sendWebPush } from './webpush.js';
import { VAPID_PUBLIC_KEY } from './vapidPublicKey.js';

// Workers run in UTC with no host-local timezone, so "now" for comparing
// against fire_at (a naive America/Toronto wall-clock string, matching every
// other datetime in this app) has to be computed via Intl, not `new Date()`.
function nowNaiveISOInToronto() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}`;
}

function addDaysToDateStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// Fires every due, unsent reminder via Web Push. Never masks failures — a bad
// send for one subscription is logged and skipped, it never blocks the rest.
export async function fireDueReminders(env) {
  if (!env.VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY) {
    return { fired: 0, skipped: 'VAPID keys not configured yet (run scripts/setup-vapid.mjs)' };
  }

  const nowNaive = nowNaiveISOInToronto();
  const due = await env.DB.prepare('SELECT * FROM reminders WHERE sent = 0 AND fire_at <= ?').bind(nowNaive).all();
  if (due.results.length === 0) return { fired: 0 };

  const subs = await env.DB.prepare('SELECT * FROM push_subscriptions').all();
  const vapid = { publicKey: VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: `mailto:${env.APPLE_ID || 'noreply@example.com'}` };

  let fired = 0;
  for (const reminder of due.results) {
    const event = await env.DB.prepare('SELECT title FROM events WHERE id = ?').bind(reminder.event_id).first();
    if (!event) {
      await env.DB.prepare('UPDATE reminders SET sent = 1 WHERE id = ?').bind(reminder.id).run();
      continue;
    }

    const dayStart = `${reminder.occurrence_date}T00:00:00`;
    const dayEnd = `${addDaysToDateStr(reminder.occurrence_date, 1)}T00:00:00`;
    const occs = await queryOccurrences(env, dayStart, dayEnd);
    const occ = occs.find((o) => o.eventId === reminder.event_id && o.occurrenceDate === reminder.occurrence_date);
    const title = occ ? occ.title : event.title;
    const timeLabel = occ ? occ.start.slice(11, 16) : '';

    const payload = { title, body: timeLabel ? `Starts at ${timeLabel}` : 'Coming up soon' };

    for (const sub of subs.results) {
      try {
        await sendWebPush(sub, payload, vapid);
      } catch (err) {
        if (err.status === 404 || err.status === 410) {
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run();
        }
        console.error(`web push failed for subscription ${sub.id}: ${err.message}`);
      }
    }

    await env.DB.prepare('UPDATE reminders SET sent = 1 WHERE id = ?').bind(reminder.id).run();
    fired++;
  }

  return { fired };
}
