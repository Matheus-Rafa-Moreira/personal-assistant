import { RRule } from 'rrule';

// All datetimes in this app are stored and displayed as naive local wall-clock
// strings (no real IANA timezone math — single user, single timezone). We parse
// them as UTC so date arithmetic (rrule, comparisons) is simple and consistent,
// then strip the trailing Z again before returning to callers.
export function parseNaive(iso) {
  return new Date(iso.replace(/Z$/, '') + 'Z');
}

export function toNaiveISO(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, '');
}

function dateOnly(iso) {
  return iso.slice(0, 10);
}

// Expand a single event row into concrete occurrences within [rangeStart, rangeEnd].
// `overrides` is the list of event_overrides rows for this event_id.
export function expandEvent(event, rangeStart, rangeEnd, overrides = []) {
  const overridesByDate = new Map(overrides.map((o) => [o.date, o]));
  const exdates = event.exdates ? JSON.parse(event.exdates) : [];
  const exdateSet = new Set(exdates.map((d) => d.slice(0, 10)));

  const baseStart = parseNaive(event.start);
  const baseEnd = parseNaive(event.end);
  const durationMs = baseEnd.getTime() - baseStart.getTime();

  const results = [];

  const emit = (occStart, occEnd) => {
    const occDate = dateOnly(toNaiveISO(occStart));
    if (exdateSet.has(occDate)) return;

    const override = overridesByDate.get(occDate);
    let start = occStart;
    let end = occEnd;
    let title = event.title;
    let overridden = false;

    let stepsState = null;
    if (override) {
      if (!override.new_start || !override.new_end) return; // cancelled that date
      start = parseNaive(override.new_start);
      end = parseNaive(override.new_end);
      title = override.new_title || event.title;
      stepsState = override.steps_state ? JSON.parse(override.steps_state) : null;
      overridden = true;
    }

    const stepsTemplate = event.steps ? JSON.parse(event.steps) : null;
    const steps = stepsTemplate
      ? stepsTemplate.map((step, i) => ({ ...step, done: !!(stepsState && stepsState[i]) }))
      : null;

    results.push({
      id: `${event.id}:${occDate}`,
      eventId: event.id,
      occurrenceDate: occDate,
      title,
      start: toNaiveISO(start),
      end: toNaiveISO(end),
      categoryId: event.category_id,
      colorOverride: event.color_override || null,
      description: event.description,
      steps,
      location: event.location,
      contactName: event.contact_name,
      contactPhone: event.contact_phone,
      notionUrl: event.notion_url,
      rrule: event.rrule,
      isRecurring: !!event.rrule,
      allDay: !!event.all_day,
      overridden,
    });
  };

  if (!event.rrule) {
    if (baseStart < rangeEnd && baseEnd > rangeStart) emit(baseStart, baseEnd);
    return results;
  }

  const options = RRule.parseString('RRULE:' + event.rrule);
  options.dtstart = baseStart;
  const rule = new RRule(options);
  const starts = rule.between(rangeStart, rangeEnd, true);
  for (const occStart of starts) {
    emit(occStart, new Date(occStart.getTime() + durationMs));
  }

  return results;
}

// events: array of event rows. overridesByEventId: Map(event_id -> override rows[]).
export function expandEvents(events, overridesByEventId, rangeStartISO, rangeEndISO) {
  const rangeStart = parseNaive(rangeStartISO);
  const rangeEnd = parseNaive(rangeEndISO);
  const out = [];
  for (const event of events) {
    const overrides = overridesByEventId.get(event.id) || [];
    out.push(...expandEvent(event, rangeStart, rangeEnd, overrides));
  }
  out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return out;
}
