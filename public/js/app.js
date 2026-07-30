(() => {
  'use strict';

  let categories = [];
  let categoriesById = new Map();
  let calendar;
  let currentDetail = null; // { eventId, occurrenceDate, isRecurring, raw }
  let replanState = null; // { date, proposal }

  // ---------- helpers ----------

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  // Format a JS Date using the BROWSER's local wall-clock fields (no timezone
  // conversion) — matches the server's "naive local datetime" convention,
  // since this is a single-user app and the browser's local time IS Matt's time.
  function toApiDatetime(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function toInputValue(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function fromInputValue(value) {
    return value.length === 16 ? `${value}:00` : value;
  }

  function todayDateStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function formatRange(startIso, endIso) {
    const s = new Date(startIso.replace(/Z$/, ''));
    const e = new Date(endIso.replace(/Z$/, ''));
    const dateFmt = { weekday: 'short', month: 'short', day: 'numeric' };
    const timeFmt = { hour: 'numeric', minute: '2-digit' };
    return `${s.toLocaleDateString(undefined, dateFmt)} · ${s.toLocaleTimeString(undefined, timeFmt)} – ${e.toLocaleTimeString(undefined, timeFmt)}`;
  }

  const DAY_NAMES = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' };

  function formatRRule(rrule) {
    if (!rrule) return '';
    const parts = Object.fromEntries(rrule.split(';').map((kv) => kv.split('=')));
    const freqMap = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' };
    const interval = parts.INTERVAL ? Number(parts.INTERVAL) : 1;
    const unit = freqMap[parts.FREQ] || (parts.FREQ || '').toLowerCase();
    let base = interval > 1 ? `Every ${interval} ${unit}s` : `Every ${unit}`;
    if (parts.BYDAY) {
      const days = parts.BYDAY.split(',').map((d) => {
        const m = d.match(/^(-?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/);
        if (!m) return d;
        const [, n, code] = m;
        return n ? `${n} ${DAY_NAMES[code]}` : DAY_NAMES[code];
      });
      base += ` on ${days.join(', ')}`;
    }
    if (parts.UNTIL) base += ` until ${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}`;
    return base;
  }

  function categoryColor(categoryId) {
    const c = categoriesById.get(categoryId);
    return c ? c.color : '#6B7280';
  }

  // ---------- sheets ----------

  function openSheet(id) {
    document.getElementById(id).classList.remove('hidden');
    document.getElementById('scrim').classList.remove('hidden');
  }

  function closeSheet(id) {
    document.getElementById(id).classList.add('hidden');
    document.getElementById('scrim').classList.add('hidden');
  }

  function closeAllSheets() {
    for (const el of document.querySelectorAll('.sheet')) el.classList.add('hidden');
    document.getElementById('scrim').classList.add('hidden');
  }

  // ---------- categories ----------

  async function loadCategories() {
    const res = await fetch('/api/categories');
    categories = await res.json();
    categoriesById = new Map(categories.map((c) => [c.id, c]));

    const select = document.getElementById('qa-category');
    select.innerHTML = categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');

    const legend = document.getElementById('legend');
    legend.innerHTML = categories
      .map((c) => `<span class="legend-item"><i style="background:${c.color}"></i>${c.name}</span>`)
      .join('');
  }

  // ---------- calendar ----------

  function initCalendar() {
    const el = document.getElementById('calendar');
    calendar = new FullCalendar.Calendar(el, {
      initialView: 'dayGridMonth',
      headerToolbar: false,
      height: '100%',
      firstDay: 0,
      events: async (fetchInfo, successCallback, failureCallback) => {
        try {
          const start = toApiDatetime(fetchInfo.start);
          const end = toApiDatetime(fetchInfo.end);
          const res = await fetch(`/api/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
          const occurrences = await res.json();
          successCallback(
            occurrences.map((occ) => ({
              id: occ.id,
              title: occ.title,
              start: occ.start,
              end: occ.end,
              backgroundColor: occ.colorOverride || categoryColor(occ.categoryId),
              borderColor: occ.colorOverride || categoryColor(occ.categoryId),
              extendedProps: occ,
            }))
          );
        } catch (err) {
          failureCallback(err);
        }
      },
      eventClick: (info) => openDetail(info.event.extendedProps),
    });
    calendar.render();
  }

  function setActiveViewButton(view) {
    for (const btn of document.querySelectorAll('#view-switch button')) {
      btn.classList.toggle('active', btn.dataset.view === view);
    }
  }

  // ---------- quick add ----------

  function openQuickAdd() {
    const start = new Date();
    start.setSeconds(0, 0);
    start.setMinutes(Math.ceil(start.getMinutes() / 5) * 5);
    const end = new Date(start.getTime() + 30 * 60000);

    document.getElementById('qa-title').value = '';
    document.getElementById('qa-start').value = toInputValue(start);
    document.getElementById('qa-end').value = toInputValue(end);
    document.getElementById('qa-repeat').value = '';
    openSheet('quick-add');
    document.getElementById('qa-title').focus();
  }

  async function submitQuickAdd(evt) {
    evt.preventDefault();
    const body = {
      title: document.getElementById('qa-title').value.trim(),
      start: fromInputValue(document.getElementById('qa-start').value),
      end: fromInputValue(document.getElementById('qa-end').value),
      categoryId: Number(document.getElementById('qa-category').value),
      rrule: document.getElementById('qa-repeat').value || null,
    };
    if (!body.title) return;

    await fetch('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    closeSheet('quick-add');
    calendar.refetchEvents();
  }

  // ---------- detail drawer ----------

  function renderSteps(occ) {
    const container = document.getElementById('detail-steps');
    if (!occ.steps || occ.steps.length === 0) {
      container.classList.add('hidden');
      container.innerHTML = '';
      return;
    }
    container.classList.remove('hidden');
    container.innerHTML = occ.steps
      .map(
        (step, i) => `
      <label class="step">
        <input type="checkbox" data-step-index="${i}" ${step.done ? 'checked' : ''} />
        <span>${step.text}</span>
      </label>`
      )
      .join('');

    container.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.addEventListener('change', () => toggleStep(occ, Number(cb.dataset.stepIndex), cb.checked));
    });
  }

  async function toggleStep(occ, index, done) {
    const newSteps = occ.steps.map((s, i) => (i === index ? { ...s, done } : s));
    occ.steps = newSteps;
    const stepsState = newSteps.map((s) => !!s.done);

    if (occ.isRecurring) {
      await fetch(`/api/events/${occ.eventId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: occ.occurrenceDate, stepsState }),
      });
    } else {
      await fetch(`/api/events/${occ.eventId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ steps: newSteps }),
      });
    }
  }

  function openDetail(occ) {
    currentDetail = occ;

    const cat = categoriesById.get(occ.categoryId);
    const badge = document.getElementById('detail-category-badge');
    if (cat) {
      badge.textContent = cat.name;
      badge.style.background = occ.colorOverride || cat.color;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    document.getElementById('detail-title').textContent = occ.title;
    document.getElementById('detail-time').textContent = formatRange(occ.start, occ.end);

    const repeatEl = document.getElementById('detail-repeat');
    if (occ.isRecurring) {
      repeatEl.textContent = `Repeats: ${formatRRule(occ.rrule)}`;
      repeatEl.classList.remove('hidden');
    } else {
      repeatEl.classList.add('hidden');
    }

    const descEl = document.getElementById('detail-description');
    if (occ.description) {
      descEl.textContent = occ.description;
      descEl.classList.remove('hidden');
    } else {
      descEl.classList.add('hidden');
    }

    renderSteps(occ);

    const locEl = document.getElementById('detail-location');
    if (occ.location) {
      locEl.href = `https://maps.apple.com/?q=${encodeURIComponent(occ.location)}`;
      locEl.querySelector('span').textContent = occ.location;
      locEl.classList.remove('hidden');
    } else {
      locEl.classList.add('hidden');
    }

    const contactEl = document.getElementById('detail-contact');
    if (occ.contactPhone) {
      contactEl.href = `tel:${occ.contactPhone}`;
      contactEl.querySelector('span').textContent = occ.contactName || occ.contactPhone;
      contactEl.classList.remove('hidden');
    } else {
      contactEl.classList.add('hidden');
    }

    const notionEl = document.getElementById('detail-notion');
    if (occ.notionUrl) {
      notionEl.href = occ.notionUrl;
      notionEl.classList.remove('hidden');
    } else {
      notionEl.classList.add('hidden');
    }

    openSheet('detail-drawer');
  }

  async function editDetail() {
    if (!currentDetail) return;
    const occ = currentDetail;

    const newTitle = window.prompt('Event title', occ.title);
    if (newTitle === null) return;

    let scope = 'series';
    if (occ.isRecurring) {
      scope = window.confirm('OK = edit only this occurrence.\nCancel = edit the entire series.') ? 'occurrence' : 'series';
    }

    const body = { title: newTitle };
    if (scope === 'occurrence') body.date = occ.occurrenceDate;

    await fetch(`/api/events/${occ.eventId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    closeAllSheets();
    calendar.refetchEvents();
  }

  async function deleteDetail() {
    if (!currentDetail) return;
    const occ = currentDetail;

    let deleteDate = null;
    if (occ.isRecurring) {
      const onlyThis = window.confirm('OK = delete only this occurrence.\nCancel = delete the entire series.');
      if (onlyThis) {
        deleteDate = occ.occurrenceDate;
      } else if (!window.confirm('Delete the entire series? This cannot be undone.')) {
        return;
      }
    } else if (!window.confirm('Delete this event?')) {
      return;
    }

    const qs = deleteDate ? `?date=${encodeURIComponent(deleteDate)}` : '';
    await fetch(`/api/events/${occ.eventId}${qs}`, { method: 'DELETE' });

    closeAllSheets();
    calendar.refetchEvents();
  }

  // ---------- replan ----------

  function renderOccurrenceList(el, items) {
    el.innerHTML = items
      .map((it) => `<li><strong>${it.title}</strong><br><span class="muted">${formatRange(it.start, it.end)}</span></li>`)
      .join('') || '<li class="muted">Nothing scheduled</li>';
  }

  async function submitReplan() {
    const date = document.getElementById('replan-date').value;
    const disruption = document.getElementById('replan-disruption').value.trim();
    if (!date || !disruption) return;

    const dayStart = `${date}T00:00:00`;
    const dayEnd = `${date}T23:59:59`;

    const [currentRes, replanRes] = await Promise.all([
      fetch(`/api/events?start=${encodeURIComponent(dayStart)}&end=${encodeURIComponent(dayEnd)}`),
      fetch('/api/replan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date, disruption }),
      }),
    ]);

    const current = await currentRes.json();
    const { summary, proposal } = await replanRes.json();

    replanState = { date, proposal };

    document.getElementById('replan-summary').textContent = summary;
    renderOccurrenceList(document.getElementById('replan-current'), current);
    renderOccurrenceList(document.getElementById('replan-proposed'), proposal);
    document.getElementById('replan-result').classList.remove('hidden');
  }

  async function acceptReplan() {
    if (!replanState) return;
    await fetch('/api/replan/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(replanState),
    });
    resetReplanPanel();
    closeAllSheets();
    calendar.refetchEvents();
  }

  function resetReplanPanel() {
    replanState = null;
    document.getElementById('replan-result').classList.add('hidden');
    document.getElementById('replan-disruption').value = '';
  }

  // ---------- theme ----------

  function initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved) document.documentElement.dataset.theme = saved;

    document.getElementById('btn-theme').addEventListener('click', () => {
      const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('theme', next);
    });
  }

  // ---------- wire up ----------

  function init() {
    loadCategories().then(initCalendar);
    initTheme();

    document.getElementById('view-switch').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-view]');
      if (!btn) return;
      calendar.changeView(btn.dataset.view);
      setActiveViewButton(btn.dataset.view);
    });

    document.getElementById('btn-add').addEventListener('click', openQuickAdd);
    document.getElementById('quick-add-form').addEventListener('submit', submitQuickAdd);

    document.getElementById('detail-edit').addEventListener('click', editDetail);
    document.getElementById('detail-delete').addEventListener('click', deleteDetail);

    document.getElementById('btn-replan').addEventListener('click', () => {
      resetReplanPanel();
      document.getElementById('replan-date').value = todayDateStr();
      openSheet('replan-panel');
    });
    document.getElementById('replan-submit').addEventListener('click', submitReplan);
    document.getElementById('replan-accept').addEventListener('click', acceptReplan);
    document.getElementById('replan-cancel').addEventListener('click', () => {
      resetReplanPanel();
      closeAllSheets();
    });

    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeSheet(btn.dataset.close));
    });
    document.getElementById('scrim').addEventListener('click', closeAllSheets);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
