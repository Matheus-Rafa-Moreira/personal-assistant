(() => {
  'use strict';

  let categories = [];
  let categoriesById = new Map();
  let calendar;
  let currentDetail = null; // { eventId, occurrenceDate, isRecurring, raw }
  let replanState = null; // { date, proposal }
  let activeYear = new Date().getFullYear();
  let currentViewName = 'dayGridMonth';
  let lastOccurrences = []; // raw occurrences from the most recent /api/events fetch
  let selectedDate = null; // YYYY-MM-DD selected in month view's day list
  let monthDotState = new Map(); // dateStr -> { colors: Set, count } while month-view dots mount

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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

    const detailSelect = document.getElementById('detail-category-select');
    detailSelect.innerHTML = categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');

    const legend = document.getElementById('legend');
    legend.innerHTML = categories
      .map((c) => `<span class="legend-item"><i style="background:${c.color}"></i>${c.name}</span>`)
      .join('');

    const chips = document.getElementById('qa-category-chips');
    chips.innerHTML = categories
      .map(
        (c) =>
          `<button type="button" class="qa-chip" data-category-id="${c.id}"><span class="qa-chip-dot" style="background:${c.color}"></span>${escapeHtml(c.name)}</button>`
      )
      .join('');
    chips.querySelectorAll('[data-category-id]').forEach((btn) => {
      btn.addEventListener('click', () => selectCategoryChip(btn.dataset.categoryId));
    });
  }

  function selectCategoryChip(categoryId) {
    document.getElementById('qa-category').value = categoryId;
    document.querySelectorAll('#qa-category-chips .qa-chip').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.categoryId === String(categoryId));
    });
  }

  // ---------- year scoping ----------

  async function loadYearState() {
    const res = await fetch('/api/year-state');
    const data = await res.json();
    activeYear = data.activeYear;
  }

  function yearValidRange() {
    return { start: `${activeYear}-01-01`, end: `${activeYear + 1}-01-01` };
  }

  async function prepareNextYear() {
    if (!window.confirm(`Carry recurring events from ${activeYear} into ${activeYear + 1}? You'll be able to review and edit them afterward (new reading weeks / exceptions, etc.).`)) {
      return;
    }
    const res = await fetch('/api/year-state/carry-forward', { method: 'POST' });
    const data = await res.json();
    activeYear = data.toYear;
    calendar.setOption('validRange', yearValidRange());
    calendar.refetchEvents();
    window.alert(`Copied ${data.created.length} recurring event template(s) into ${data.toYear}. Review them in Month or Year view and adjust exceptions as needed.`);
  }

  // ---------- nav bar ----------

  function setActiveViewButton(view) {
    for (const btn of document.querySelectorAll('#view-switch button')) {
      btn.classList.toggle('active', btn.dataset.view === view);
    }
  }

  function updateNavBar() {
    const titleEl = document.getElementById('nav-title');
    const upBtn = document.getElementById('nav-up');
    if (currentViewName === 'multiMonthYear') {
      titleEl.textContent = String(activeYear);
      upBtn.classList.add('hidden');
    } else {
      titleEl.textContent = calendar.view ? calendar.view.title : '';
      upBtn.textContent = `‹ ${activeYear}`;
      upBtn.classList.remove('hidden');
    }
  }

  function changeView(view, date) {
    currentViewName = view;
    if (date) calendar.changeView(view, date);
    else calendar.changeView(view);
    setActiveViewButton(view);
    updateNavBar();
    if (view === 'dayGridMonth') showMonthDayList();
    else hideMonthDayList();
  }

  // ---------- calendar ----------

  function initCalendar() {
    const el = document.getElementById('calendar');
    calendar = new FullCalendar.Calendar(el, {
      initialView: 'dayGridMonth',
      headerToolbar: false,
      height: '100%',
      firstDay: 0,
      validRange: yearValidRange(),
      navLinks: true,
      // Unlimited: eventContent's own dedup-by-color logic caps visible dots
      // at 4 per day, so FullCalendar's row-based "+N more" capping would
      // just be redundant (and would count suppressed/deduped events too).
      dayMaxEvents: false,
      eventTimeFormat: { hour: 'numeric', minute: '2-digit', meridiem: 'short' },
      events: async (fetchInfo, successCallback, failureCallback) => {
        try {
          const start = toApiDatetime(fetchInfo.start);
          const end = toApiDatetime(fetchInfo.end);
          const res = await fetch(`/api/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
          const occurrences = await res.json();
          lastOccurrences = occurrences;
          monthDotState = new Map(); // reset before this batch mounts via eventContent
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
          if (currentViewName === 'dayGridMonth' && selectedDate) renderDayList(selectedDate);
        } catch (err) {
          failureCallback(err);
        }
      },
      eventContent: (arg) => {
        // Month view: category-color dots instead of text chips, deduped by
        // color and capped at 4 per day (the day's actual events are
        // surfaced in the selected-day list below) — matches the design's
        // own `uniq.slice(0,4)` dot logic exactly.
        if (arg.view.type !== 'dayGridMonth') return undefined; // other views: FullCalendar's default rendering
        const dateStr = arg.event.extendedProps.occurrenceDate;
        const color = arg.event.backgroundColor;
        let state = monthDotState.get(dateStr);
        if (!state) {
          state = { colors: new Set(), count: 0 };
          monthDotState.set(dateStr, state);
        }
        if (state.count >= 4 || state.colors.has(color)) return { domNodes: [] };
        state.colors.add(color);
        state.count++;
        const dot = document.createElement('span');
        dot.className = 'month-dot';
        dot.style.background = color;
        return { domNodes: [dot] };
      },
      eventClick: (info) => openDetail(info.event.extendedProps),
      dateClick: (info) => {
        if (currentViewName === 'multiMonthYear') {
          changeView('dayGridMonth', info.date);
        } else if (currentViewName === 'dayGridMonth') {
          selectedDate = toInputValue(info.date).slice(0, 10);
          renderDayList(selectedDate);
        }
      },
      navLinkDayClick: (date) => changeView('timeGridDay', date),
      navLinkWeekClick: (weekStart) => changeView('timeGridWeek', weekStart),
      datesSet: () => updateNavBar(),
    });
    calendar.render();
    updateNavBar();
    showMonthDayList();
  }

  // ---------- month view: selected-day list ----------

  function formatTime(iso) {
    const d = new Date(iso.replace(/Z$/, ''));
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function renderDayList(dateStr) {
    const list = document.getElementById('month-day-list');
    if (list.classList.contains('hidden')) return;

    const dayOccs = lastOccurrences
      .filter((o) => o.occurrenceDate === dateStr)
      .sort((a, b) => a.start.localeCompare(b.start));

    const d = new Date(`${dateStr}T00:00:00`);
    const headLabel = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const countLabel = dayOccs.length === 1 ? '1 event' : `${dayOccs.length} events`;

    const rows = dayOccs
      .map((occ, i) => {
        const color = occ.colorOverride || categoryColor(occ.categoryId);
        const cat = categoriesById.get(occ.categoryId);
        return `
      <div class="day-list-row" data-row-index="${i}">
        <div class="day-list-time">${formatTime(occ.start)}</div>
        <div class="day-list-accent" style="background:${color}"></div>
        <div class="day-list-body">
          <div class="day-list-title">${escapeHtml(occ.title)}</div>
          <div class="day-list-sub">${escapeHtml(cat ? cat.name : '')}</div>
        </div>
      </div>`;
      })
      .join('');

    list.innerHTML = `
      <div class="day-list-header"><span>${headLabel}</span><span class="muted">${countLabel}</span></div>
      ${dayOccs.length ? rows : '<div class="day-list-empty">No events — tap + to add one</div>'}`;

    list.querySelectorAll('[data-row-index]').forEach((row) => {
      row.addEventListener('click', () => openDetail(dayOccs[Number(row.dataset.rowIndex)]));
    });
  }

  function showMonthDayList() {
    document.getElementById('month-day-list').classList.remove('hidden');
    calendar.setOption('height', 'auto');
    if (!selectedDate) selectedDate = todayDateStr();
    renderDayList(selectedDate);
  }

  function hideMonthDayList() {
    document.getElementById('month-day-list').classList.add('hidden');
    calendar.setOption('height', '100%');
  }

  // ---------- quick add ----------

  const LAST_CATEGORY_KEY = 'lastUsedCategoryId';

  // Defaults per the design's "quick-add in three taps": the day already
  // selected in month view (if any), and the last category used — so the
  // happy path is +, type, Add.
  function openQuickAdd() {
    const now = new Date();
    now.setSeconds(0, 0);
    now.setMinutes(Math.ceil(now.getMinutes() / 5) * 5);

    const start = new Date(now);
    if (currentViewName === 'dayGridMonth' && selectedDate) {
      const [y, m, d] = selectedDate.split('-').map(Number);
      start.setFullYear(y, m - 1, d);
    }
    const end = new Date(start.getTime() + 30 * 60000);

    document.getElementById('qa-title').value = '';
    document.getElementById('qa-start').value = toInputValue(start);
    document.getElementById('qa-end').value = toInputValue(end);
    document.getElementById('qa-repeat').value = '';

    setActiveWhenChip(toInputValue(start).slice(0, 10));

    const lastCategoryId = localStorage.getItem(LAST_CATEGORY_KEY);
    const defaultCategory = categories.find((c) => String(c.id) === lastCategoryId) || categories[0];
    if (defaultCategory) selectCategoryChip(defaultCategory.id);

    openSheet('quick-add');
    document.getElementById('qa-title').focus();
  }

  function dateStrFor(daysFromToday) {
    const d = new Date();
    d.setDate(d.getDate() + daysFromToday);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function nextSaturdayDateStr() {
    const d = new Date();
    const daysUntilSat = (6 - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + daysUntilSat);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function setActiveWhenChip(dateStr) {
    const map = { today: dateStrFor(0), tomorrow: dateStrFor(1), weekend: nextSaturdayDateStr() };
    document.querySelectorAll('#qa-when-chips .qa-chip').forEach((btn) => {
      btn.classList.toggle('active', map[btn.dataset.when] === dateStr);
    });
  }

  function applyWhenChip(when) {
    const targetDateStr = when === 'today' ? dateStrFor(0) : when === 'tomorrow' ? dateStrFor(1) : nextSaturdayDateStr();
    const [y, m, d] = targetDateStr.split('-').map(Number);

    const startInput = document.getElementById('qa-start');
    const endInput = document.getElementById('qa-end');
    const start = new Date(fromInputValue(startInput.value));
    const durationMs = new Date(fromInputValue(endInput.value)) - start;
    start.setFullYear(y, m - 1, d);
    const end = new Date(start.getTime() + durationMs);

    startInput.value = toInputValue(start);
    endInput.value = toInputValue(end);
    setActiveWhenChip(targetDateStr);
  }

  function initQuickAddChips() {
    document.querySelectorAll('#qa-when-chips .qa-chip').forEach((btn) => {
      btn.addEventListener('click', () => applyWhenChip(btn.dataset.when));
    });
  }

  async function submitQuickAdd(evt) {
    evt.preventDefault();
    const categoryId = Number(document.getElementById('qa-category').value);
    const body = {
      title: document.getElementById('qa-title').value.trim(),
      start: fromInputValue(document.getElementById('qa-start').value),
      end: fromInputValue(document.getElementById('qa-end').value),
      categoryId,
      rrule: document.getElementById('qa-repeat').value || null,
    };
    if (!body.title) return;

    await fetch('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    localStorage.setItem(LAST_CATEGORY_KEY, String(categoryId));

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
        <span>${escapeHtml(step.text)}</span>
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

  // ---- structured, editable drawer sections (V3 #1) ----

  const SECTION_FIELDS = ['location', 'contact', 'description', 'notion', 'repeat', 'category', 'reminder'];
  let editorSteps = []; // step texts, while the Checklist/Routine section form is open

  function sectionViewHTML(field, occ) {
    switch (field) {
      case 'location':
        return occ.location
          ? `<a class="detail-link" href="https://maps.apple.com/?q=${encodeURIComponent(occ.location)}" target="_blank" rel="noopener">&#128205; ${escapeHtml(occ.location)}</a>`
          : `<span class="section-empty">+ Add location</span>`;
      case 'contact':
        return occ.contactPhone || occ.contactName
          ? `<a class="detail-link" href="tel:${escapeHtml(occ.contactPhone || '')}">&#128222; ${escapeHtml(occ.contactName || occ.contactPhone)}</a>`
          : `<span class="section-empty">+ Add contact</span>`;
      case 'description':
        return occ.description
          ? `<p class="section-text">${escapeHtml(occ.description)}</p>`
          : `<span class="section-empty">+ Add notes</span>`;
      case 'notion':
        return occ.notionUrl
          ? `<a class="detail-link" href="${escapeHtml(occ.notionUrl)}" target="_blank" rel="noopener">&#128214; Notion guide &rarr;</a>`
          : `<span class="section-empty">+ Add Notion link</span>`;
      case 'repeat':
        return occ.isRecurring && occ.rrule
          ? `<p class="section-text">${formatRRule(occ.rrule)}</p>`
          : `<span class="section-empty">Doesn't repeat &middot; tap to set</span>`;
      case 'category': {
        const cat = categoriesById.get(occ.categoryId);
        return cat
          ? `<span class="badge" style="background:${occ.colorOverride || cat.color}">${escapeHtml(cat.name)}</span>`
          : `<span class="section-empty">+ Set category</span>`;
      }
      case 'reminder':
        return occ.reminderSet
          ? `<span class="section-text">Reminder set for this occurrence</span>`
          : `<span class="section-empty">+ Set reminder</span>`;
      default:
        return '';
    }
  }

  function renderDetailSections(occ) {
    for (const field of SECTION_FIELDS) {
      const view = document.querySelector(`.detail-section-view[data-view="${field}"]`);
      if (view) view.innerHTML = sectionViewHTML(field, occ);
    }
    renderSteps(occ);
    closeAllSectionForms();
  }

  function closeAllSectionForms() {
    document.querySelectorAll('.detail-section-form').forEach((f) => f.classList.add('hidden'));
  }

  function renderStepsEditor() {
    const container = document.getElementById('detail-steps-editor');
    container.innerHTML =
      editorSteps
        .map(
          (text, i) => `
      <div class="step-editor-row">
        <span>${escapeHtml(text)}</span>
        <button type="button" data-step-remove="${i}" class="step-remove" aria-label="Remove step">&times;</button>
      </div>`
        )
        .join('') || '<p class="muted">No steps yet.</p>';
  }

  function populateSectionForm(field, occ) {
    switch (field) {
      case 'location':
        document.querySelector('[data-input="location"]').value = occ.location || '';
        break;
      case 'contact':
        document.querySelector('[data-input="contactName"]').value = occ.contactName || '';
        document.querySelector('[data-input="contactPhone"]').value = occ.contactPhone || '';
        break;
      case 'description':
        document.querySelector('[data-input="description"]').value = occ.description || '';
        break;
      case 'notion':
        document.querySelector('[data-input="notionUrl"]').value = occ.notionUrl || '';
        break;
      case 'repeat':
        document.querySelector('[data-input="rrule"]').value = occ.rrule || '';
        break;
      case 'category':
        document.querySelector('[data-input="categoryId"]').value = occ.categoryId != null ? String(occ.categoryId) : '';
        break;
      case 'steps':
        editorSteps = (occ.steps || []).map((s) => s.text);
        renderStepsEditor();
        break;
      case 'reminder':
        // minutesBefore has a sensible default baked into the select; nothing to prefill.
        break;
    }
  }

  function openSectionForm(field) {
    const form = document.querySelector(`.detail-section-form[data-form="${field}"]`);
    if (!form || !currentDetail) return;
    populateSectionForm(field, currentDetail);
    form.classList.remove('hidden');
  }

  function closeSectionForm(field) {
    const form = document.querySelector(`.detail-section-form[data-form="${field}"]`);
    if (form) form.classList.add('hidden');
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  // Requests notification permission and subscribes ONLY the first time Matt
  // sets a reminder (per V3 #3) — subsequent reminders reuse the subscription.
  async function ensurePushSubscription() {
    if (localStorage.getItem('pushSubscribed') === '1') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      throw new Error('push notifications are not supported in this browser');
    }
    if (!window.VAPID_PUBLIC_KEY) {
      throw new Error('VAPID public key is not configured yet — run scripts/setup-vapid.mjs');
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('notification permission was not granted');

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(window.VAPID_PUBLIC_KEY),
    });
    const subJson = subscription.toJSON();
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: subJson.endpoint, p256dh: subJson.keys.p256dh, auth: subJson.keys.auth }),
    });
    localStorage.setItem('pushSubscribed', '1');
  }

  async function saveSectionField(field) {
    const occ = currentDetail;
    if (!occ) return;

    if (field === 'reminder') {
      const minutes = Number(document.querySelector('[data-input="reminderMinutes"]').value);
      try {
        await ensurePushSubscription();
      } catch (err) {
        window.alert(`Couldn't set the reminder: ${err.message}`);
        return;
      }
      await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventId: occ.eventId, occurrenceDate: occ.occurrenceDate, start: occ.start, minutesBefore: minutes }),
      });
      occ.reminderSet = true;
      renderDetailSections(occ);
      return;
    }

    const patch = {};
    switch (field) {
      case 'location':
        patch.location = document.querySelector('[data-input="location"]').value.trim();
        break;
      case 'contact':
        patch.contactName = document.querySelector('[data-input="contactName"]').value.trim();
        patch.contactPhone = document.querySelector('[data-input="contactPhone"]').value.trim();
        break;
      case 'description':
        patch.description = document.querySelector('[data-input="description"]').value.trim();
        break;
      case 'notion':
        patch.notionUrl = document.querySelector('[data-input="notionUrl"]').value.trim();
        break;
      case 'repeat':
        patch.rrule = document.querySelector('[data-input="rrule"]').value || null;
        break;
      case 'category': {
        const val = document.querySelector('[data-input="categoryId"]').value;
        patch.categoryId = val ? Number(val) : null;
        break;
      }
      case 'steps':
        patch.steps = editorSteps.map((text) => ({ text, done: false }));
        break;
      default:
        return;
    }

    await fetch(`/api/events/${occ.eventId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });

    Object.assign(occ, patch);
    if (field === 'repeat') occ.isRecurring = !!patch.rrule;

    renderDetailSections(occ);
    calendar.refetchEvents();
  }

  function initDetailSections() {
    const container = document.getElementById('detail-sections');

    container.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.detail-section-edit-btn');
      if (editBtn) return openSectionForm(editBtn.dataset.field);

      const viewEl = e.target.closest('.detail-section-view');
      if (viewEl) return openSectionForm(viewEl.dataset.view);

      const cancelBtn = e.target.closest('[data-cancel]');
      if (cancelBtn) return closeSectionForm(cancelBtn.dataset.cancel);

      const saveBtn = e.target.closest('[data-save]');
      if (saveBtn) return saveSectionField(saveBtn.dataset.save);

      const stepRemoveBtn = e.target.closest('[data-step-remove]');
      if (stepRemoveBtn) {
        editorSteps.splice(Number(stepRemoveBtn.dataset.stepRemove), 1);
        renderStepsEditor();
      }
    });

    // The steps section header's own edit button opens its form the same way
    // as the generic sections (handled above); only wire the add-step control.
    const addStep = () => {
      const input = document.getElementById('detail-step-new');
      const text = input.value.trim();
      if (!text) return;
      editorSteps.push(text);
      input.value = '';
      renderStepsEditor();
    };
    document.getElementById('detail-step-add').addEventListener('click', addStep);
    document.getElementById('detail-step-new').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addStep();
      }
    });
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

    renderDetailSections(occ);

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

  // ---------- sync source (V3 #4: family calendar picker) ----------

  async function openSyncSourcePanel() {
    closeSheet('more-menu');
    openSheet('sync-source-panel');
    const list = document.getElementById('sync-source-list');
    list.innerHTML = '<p class="muted">Loading calendars&hellip;</p>';
    try {
      const res = await fetch('/api/sync/calendars');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
      if (!data.calendars || data.calendars.length === 0) {
        list.innerHTML = '<p class="muted">No calendars found.</p>';
        return;
      }
      list.innerHTML = data.calendars
        .map((c) => `<button class="more-menu-item" data-calendar-name="${escapeHtml(c.displayName)}">${escapeHtml(c.displayName)}</button>`)
        .join('');
      list.querySelectorAll('[data-calendar-name]').forEach((btn) => {
        btn.addEventListener('click', () => chooseSyncSource(btn.dataset.calendarName));
      });
    } catch (err) {
      list.innerHTML = `<p class="muted">Couldn't load calendars: ${escapeHtml(err.message)}</p>`;
    }
  }

  async function chooseSyncSource(name) {
    await fetch('/api/sync/target', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    closeSheet('sync-source-panel');
    window.alert(`Sync source set to "${name}". The next sync cycle will pull from it.`);
  }

  // Manual trigger for the read-only CalDAV pull, so a sync-source change (or
  // the whole family-sync setup) can be verified immediately instead of
  // waiting for the next :00/:30 cron tick.
  async function syncNow(btn) {
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Syncing…';
    try {
      const res = await fetch('/api/sync/caldav', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
      closeSheet('more-menu');
      const { inserted, updated } = data.pull || {};
      window.alert(`Synced: ${inserted ?? 0} new, ${updated ?? 0} updated.`);
      calendar.refetchEvents();
    } catch (err) {
      window.alert(`Sync failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
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
      closeSheet('more-menu');
    });
  }

  // ---------- Alfred ----------

  let alfredMessages = []; // {role: 'user'|'assistant', content}
  let mediaRecorder = null;
  let audioChunks = [];
  let recording = false;

  function renderAlfredMessages() {
    const el = document.getElementById('alfred-messages');
    el.innerHTML = alfredMessages
      .map((m) => `<div class="alfred-msg alfred-${m.role}">${escapeHtml(m.content)}</div>`)
      .join('');
    el.scrollTop = el.scrollHeight;
  }

  function openAlfredPanel() {
    document.getElementById('alfred-panel').classList.remove('hidden');
  }

  function toggleAlfredPanel() {
    document.getElementById('alfred-panel').classList.toggle('hidden');
  }

  function speak(text) {
    if (!text || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  }

  async function sendAlfredText(rawText, wasVoice) {
    const text = rawText.trim();
    if (!text) return;

    openAlfredPanel();
    alfredMessages.push({ role: 'user', content: text });
    renderAlfredMessages();
    document.getElementById('alfred-input').value = '';

    try {
      const res = await fetch('/api/alfred/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: alfredMessages.map((m) => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      const reply = data.reply || "Sorry, I didn't catch that.";
      alfredMessages.push({ role: 'assistant', content: reply });
      renderAlfredMessages();
      if (wasVoice) speak(reply);

      const wroteSomething = (data.actions || []).some((a) => a.result && a.result.ok);
      if (wroteSomething) calendar.refetchEvents();
    } catch (err) {
      // Never mask the real failure behind a generic apology (V3 #2).
      const reply = `Alfred hit an error reaching the server: ${err.message}`;
      alfredMessages.push({ role: 'assistant', content: reply });
      renderAlfredMessages();
      if (wasVoice) speak(reply);
    }
  }

  function setListeningUI(isListening) {
    document.querySelector('.alfred-bar-default').classList.toggle('hidden', isListening);
    document.querySelector('.alfred-bar-listening').classList.toggle('hidden', !isListening);
    document.getElementById('alfred-mic').classList.toggle('recording', isListening);
  }

  async function startVoiceInput() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      window.alert('Voice input needs microphone access, which this browser does not support here.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.addEventListener('dataavailable', (e) => audioChunks.push(e.data));
      mediaRecorder.addEventListener('stop', async () => {
        stream.getTracks().forEach((t) => t.stop());
        recording = false;
        setListeningUI(false);
        const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        try {
          const res = await fetch('/api/alfred/transcribe', {
            method: 'POST',
            headers: { 'content-type': blob.type },
            body: blob,
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `transcription failed (${res.status})`);
          if (data.text) await sendAlfredText(data.text, true);
        } catch (err) {
          window.alert(`Couldn't transcribe that: ${err.message}`);
        }
      });
      mediaRecorder.start();
      recording = true;
      setListeningUI(true);
    } catch (err) {
      window.alert('Microphone permission is needed for voice input.');
      recording = false;
      setListeningUI(false);
    }
  }

  function stopVoiceInput() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  }

  function initAlfred() {
    const bar = document.getElementById('alfred-bar');
    const input = document.getElementById('alfred-input');
    const mic = document.getElementById('alfred-mic');
    const send = document.getElementById('alfred-send');

    bar.addEventListener('click', (e) => {
      if (e.target === bar) toggleAlfredPanel();
    });

    send.addEventListener('click', () => sendAlfredText(input.value, false));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendAlfredText(input.value, false);
    });
    input.addEventListener('focus', openAlfredPanel);

    mic.addEventListener('click', () => {
      if (recording) stopVoiceInput();
      else startVoiceInput();
    });

    document.getElementById('alfred-stop').addEventListener('click', stopVoiceInput);

    document.getElementById('alfred-collapse').addEventListener('click', () => {
      document.getElementById('alfred-panel').classList.add('hidden');
    });
  }

  // ---------- wire up ----------

  function init() {
    Promise.all([loadCategories(), loadYearState()]).then(initCalendar);
    initTheme();
    initAlfred();
    initDetailSections();
    initQuickAddChips();

    document.getElementById('view-switch').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-view]');
      if (!btn) return;
      changeView(btn.dataset.view);
    });

    document.getElementById('nav-up').addEventListener('click', () => changeView('multiMonthYear'));
    document.getElementById('nav-prev').addEventListener('click', () => calendar.prev());
    document.getElementById('nav-next').addEventListener('click', () => calendar.next());

    document.getElementById('btn-more').addEventListener('click', () => openSheet('more-menu'));

    document.getElementById('btn-add').addEventListener('click', openQuickAdd);
    document.getElementById('quick-add-form').addEventListener('submit', submitQuickAdd);

    document.getElementById('detail-edit').addEventListener('click', editDetail);
    document.getElementById('detail-delete').addEventListener('click', deleteDetail);

    document.getElementById('btn-replan').addEventListener('click', () => {
      resetReplanPanel();
      document.getElementById('replan-date').value = todayDateStr();
      closeSheet('more-menu');
      openSheet('replan-panel');
    });
    document.getElementById('replan-submit').addEventListener('click', submitReplan);
    document.getElementById('replan-accept').addEventListener('click', acceptReplan);
    document.getElementById('replan-cancel').addEventListener('click', () => {
      resetReplanPanel();
      closeAllSheets();
    });

    document.getElementById('btn-prepare-year').addEventListener('click', () => {
      closeSheet('more-menu');
      prepareNextYear();
    });

    document.getElementById('btn-sync-source').addEventListener('click', openSyncSourcePanel);
    document.getElementById('btn-sync-now').addEventListener('click', (e) => syncNow(e.currentTarget));

    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeSheet(btn.dataset.close));
    });
    document.getElementById('scrim').addEventListener('click', closeAllSheets);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
