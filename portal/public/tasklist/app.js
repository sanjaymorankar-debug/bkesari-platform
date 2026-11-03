/* TaskList app. One page; the path picks the view:
     /tasklist/            Today (overdue + due today, IST)
     /tasklist/upcoming    agenda or calendar
     /tasklist/board       Kanban by status, drag and drop or keyboard
     /tasklist/lists       lists, plus links to tags, search, completed, settings
     /tasklist/list/:id    one list      /tasklist/tag/:tag   one tag
     /tasklist/tags /search /archive /settings
     /tasklist/task/:id    a task's detail over Today
   Works offline: the last data shown is kept on this device (per account,
   cleared on sign-out) and changes made offline wait in a queue that is sent,
   in order, when the connection returns. Creates carry a client_id so a
   retried send never makes a second copy. */
(function () {
  'use strict';
  const K = window.Kesari;
  const Q = window.TLQuickAdd;
  const t = (k, v) => K.t(k, v);
  const esc = K.escapeHtml;
  const BASE = '/tasklist';
  const API = `${BASE}/api`;
  const STATUS_COLS = [['Not Started', 'board.todo'], ['In Progress', 'board.doing'], ['On Hold', 'board.waiting'], ['Completed', 'board.done']];
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];

  const state = { user: null, csrf: null, lists: [], tags: [], today: Q.istDay(Date.now()), settings: {}, tasks: [], done: null, features: {}, offline: false, loaded: false };
  let queue = [];

  /* ---------------- storage (per account, wrapped: storage can throw) ---------------- */
  const key = (k) => `tl.${k}.${state.user ? state.user.id : 'anon'}`;
  const save = () => { if (!state.user) return; K.store.set(key('cache'), JSON.stringify({ lists: state.lists, tags: state.tags, tasks: state.tasks, settings: state.settings, user: state.user })); K.store.set(key('queue'), JSON.stringify(queue)); };
  function restore(userId) {
    try {
      const c = JSON.parse(K.store.get(`tl.cache.${userId}`) || 'null');
      queue = JSON.parse(K.store.get(`tl.queue.${userId}`) || '[]');
      return c;
    } catch { return null; }
  }

  /* ---------------- API ---------------- */
  async function api(method, path, body) {
    let r;
    try {
      r = await fetch(API + path, {
        method, credentials: 'same-origin',
        headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(state.csrf ? { 'X-CSRF-Token': state.csrf } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) { throw Object.assign(new Error('offline'), { offline: true }); }
    if (r.status === 401) { location.href = `${BASE}/sign-in?next=${encodeURIComponent(location.pathname)}`; throw new Error('signed out'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || `Error ${r.status}`), { status: r.status });
    return data;
  }

  const uid = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  /** Apply a change here at once, then send it (now, or when back online). */
  function mutate(op) {
    queue.push(op);
    save();
    paintOffline();
    flush();
  }
  let flushing = false;
  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      while (queue.length) {
        const op = queue[0];
        // A task created offline has a temporary id until the server answers.
        if (/\/tasks\/tmp-/.test(op.path)) {
          const tmp = op.path.match(/tmp-[a-z0-9]+/)[0];
          const real = state.tasks.find((x) => x.tmp === tmp && !String(x.id).startsWith('tmp-'));
          if (!real) { queue.shift(); continue; }
          op.path = op.path.replace(tmp, real.id);
        }
        let res;
        try { res = await api(op.method, op.path, op.body); } catch (err) {
          if (err.offline) { state.offline = true; paintOffline(); return; }
          queue.shift();
          K.toast(t('err.save', { msg: err.message }), { kind: 'danger' });
          save();
          await refresh();
          continue;
        }
        queue.shift();
        state.offline = false;
        if (op.tmp && res && res.id) {
          const local = state.tasks.find((x) => x.id === op.tmp);
          if (local) Object.assign(local, res, { tmp: op.tmp });
        }
        if (res && res.nextDue) K.toast(t('task.nextOn', { date: K.formatDate(`${res.nextDue}T00:00:00+05:30`) }), { kind: 'success' });
        save();
      }
      paintOffline();
      if (state.wasQueued) { state.wasQueued = false; K.toast(t('offline.synced')); await refresh(); }
    } finally { flushing = false; }
  }
  window.addEventListener('online', () => { state.offline = false; paintOffline(); flush(); refresh(); });
  window.addEventListener('offline', () => { state.offline = true; paintOffline(); });

  function paintOffline() {
    const el = $('#offline');
    const pending = queue.length;
    if (state.offline || !navigator.onLine) {
      el.hidden = false;
      el.textContent = `${t('offline.banner')}${pending ? ` ${t('offline.pending', { n: pending })}` : ''}`;
      if (pending) state.wasQueued = true;
    } else el.hidden = true;
  }

  async function refresh() {
    try {
      const [b, list] = await Promise.all([api('GET', '/bootstrap'), api('GET', '/tasks')]);
      Object.assign(state, { user: b.user, csrf: b.csrf, lists: b.lists, tags: b.tags, today: b.today, settings: b.settings || {}, features: b.features || {} });
      // Keep tasks made offline that the server has not seen yet.
      const pendingTmp = state.tasks.filter((x) => String(x.id).startsWith('tmp-'));
      state.tasks = list.tasks.concat(pendingTmp);
      state.offline = false;
      state.loaded = true;
      save();
    } catch (err) {
      if (!err.offline) throw err;
      state.offline = true;
    }
    paintOffline();
    render();
  }

  /* ---------------- helpers ---------------- */
  const listName = (id) => { const l = state.lists.find((x) => x.id === id); return l ? l.name : t('nav.inbox'); };
  const isDone = (x) => x.status === 'Completed' || x.status === 'Cancelled';
  const dueText = (x) => {
    if (!x.due_date) return '';
    const day = x.due_date === state.today ? t('nav.today') : x.due_date === Q.nextDue(state.today, 'daily') ? t('upcoming.tomorrow') : K.formatDate(`${x.due_date}T00:00:00+05:30`);
    return x.due_time ? `${day}, ${K.formatTime(`${x.due_date}T${x.due_time}:00+05:30`)}` : day;
  };
  const overdue = (x) => x.due_date && !isDone(x) && (x.due_date < state.today || (x.due_date === state.today && x.due_time && x.due_time < nowIstTime()));
  function nowIstTime() { const p = K.toIstParts(new Date()); return `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`; }
  const prioFlag = (p) => (p ? `<span class="tl-prio tl-prio--${p}" title="${esc(t(`prio.${p}`))}"><span class="k-sr-only">${esc(t('task.priority'))}: ${esc(t(`prio.${p}`))}</span></span>` : '');

  function taskRow(x, { showList = true } = {}) {
    const late = overdue(x);
    const meta = [
      x.due_date ? `<span class="tl-due${late ? ' tl-due--late' : ''}">${late ? `${esc(t('task.overdue'))} · ` : ''}${esc(dueText(x))}</span>` : '',
      showList && x.list_id ? `<span>${esc(listName(x.list_id))}</span>` : '',
      ...(x.tags || []).map((g) => `<span class="tl-tag">#${esc(g)}</span>`),
      x.subtask_count ? `<span>☑ ${esc(t('task.subOf', { done: x.subtask_done, total: x.subtask_count }))}</span>` : '',
      x.recurrence ? `<span title="${esc(t(`rep.${x.recurrence}`))}">↻ <span class="k-sr-only">${esc(t('task.repeats'))}</span></span>` : '',
    ].filter(Boolean).join('');
    return `<li class="tl-task${isDone(x) ? ' tl-task--done' : ''}" data-id="${esc(x.id)}">
  <button class="tl-check" type="button" aria-pressed="${isDone(x)}" data-act="toggle" aria-label="${esc(isDone(x) ? t('task.undone') : t('task.done'))}: ${esc(x.title)}"></button>
  <a class="tl-task-main" href="${BASE}/task/${esc(x.id)}" data-act="open">${prioFlag(x.priority)}<span class="tl-title">${esc(x.title)}</span>
    ${meta ? `<span class="tl-meta">${meta}</span>` : ''}</a></li>`;
  }

  const empty = (title, body, icon = 'sun') => `<div class="k-empty">${ICONS[icon]}<h3>${esc(title)}</h3><p>${esc(body)}</p></div>`;
  const ICONS = {
    sun: '<svg viewBox="0 0 120 96" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><circle cx="60" cy="46" r="16"/><path d="M60 14v8M60 70v8M28 46h8M84 46h8M37 23l6 6M77 63l6 6M37 69l6-6M77 29l6-6"/><path d="M14 90h92" stroke-opacity=".3"/></svg>',
    cal: '<svg viewBox="0 0 120 96" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><rect x="24" y="18" width="72" height="60" rx="8"/><path d="M24 36h72M44 10v14M76 10v14"/><path d="M14 90h92" stroke-opacity=".3"/></svg>',
    list: '<svg viewBox="0 0 120 96" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M46 28h44M46 48h44M46 68h30"/><circle cx="32" cy="28" r="3"/><circle cx="32" cy="48" r="3"/><circle cx="32" cy="68" r="3"/><path d="M14 90h92" stroke-opacity=".3"/></svg>',
    done: '<svg viewBox="0 0 120 96" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="22" y="14" width="76" height="62" rx="10"/><path d="m44 46 12 12 22-24"/></svg>',
  };

  /* ---------------- router ---------------- */
  function route() {
    const parts = location.pathname.replace(/^\/tasklist\/?/, '').split('/').filter(Boolean);
    return { view: parts[0] || 'today', arg: parts[1] ? decodeURIComponent(parts[1]) : null };
  }
  function go(href) { history.pushState({}, '', href); render(); }
  window.addEventListener('popstate', render);

  function setActiveNav(view) {
    const nav = view === 'task' ? 'today' : ['list', 'tag'].includes(view) ? 'lists' : view;
    $$('[data-nav]').forEach((a) => {
      const on = a.dataset.nav.split(' ').includes(nav) || (nav === 'tags' && a.dataset.nav === 'lists more') || (['search', 'archive', 'settings'].includes(nav) && a.dataset.nav === 'lists more');
      if (on && (a.dataset.nav.split(' ')[0] === nav || a.closest('.k-bottomnav'))) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function render() {
    const { view, arg } = route();
    setActiveNav(view);
    // The back button closes an open task.
    if (view !== 'task' && $('#detail').open) closeDetail();
    const el = $('#view');
    if (!state.loaded && !state.tasks.length) return;
    const views = { today, upcoming, board, lists, list: () => listView(Number(arg)), tags, tag: () => tagView(arg), search, archive, settings, task: today };
    (views[view] || today)(el);
    K.refresh(el);
    // Never repaint a detail the person is editing.
    if (view === 'task' && arg && !($('#detail').open && String(detailId) === String(arg))) openDetail(arg);
    document.title = `${$('#view h1') ? $('#view h1').textContent : 'TaskList'} — TaskList`;
  }

  /* ---------------- views ---------------- */
  function today(el) {
    const open = state.tasks.filter((x) => !isDone(x));
    const late = open.filter((x) => x.due_date && x.due_date < state.today);
    const due = open.filter((x) => x.due_date === state.today);
    el.innerHTML = `<header class="tl-head"><h1>${esc(t('today.title'))}</h1><p class="k-muted">${esc(t('today.dateLine', { date: K.formatDate(new Date()) }))}</p></header>
${late.length ? `<section aria-labelledby="h-late"><h2 id="h-late" class="tl-section tl-section--late">${esc(t('today.overdue'))} <span class="k-badge">${late.length}</span></h2><ul class="tl-tasks">${late.map((x) => taskRow(x)).join('')}</ul></section>` : ''}
<section aria-labelledby="h-due"><h2 id="h-due" class="tl-section">${esc(t('today.due'))}</h2>
${due.length ? `<ul class="tl-tasks">${due.map((x) => taskRow(x)).join('')}</ul>` : (late.length ? '' : empty(t('today.none'), t('today.noneBody')))}</section>`;
  }

  let upcomingMode = 'agenda';
  let calMonth = null;
  function upcoming(el) {
    const open = state.tasks.filter((x) => !isDone(x) && (!x.due_date || x.due_date > state.today));
    const dated = open.filter((x) => x.due_date);
    const head = `<header class="tl-head tl-head--row"><h1>${esc(t('upcoming.title'))}</h1>
<div class="k-tabs tl-toggle" role="tablist"><button role="tab" type="button" data-mode="agenda" aria-selected="${upcomingMode === 'agenda'}">${esc(t('upcoming.agenda'))}</button>
<button role="tab" type="button" data-mode="calendar" aria-selected="${upcomingMode === 'calendar'}">${esc(t('upcoming.calendar'))}</button></div></header>`;
    if (upcomingMode === 'calendar') { el.innerHTML = head + calendar(dated); return; }
    if (!open.length) { el.innerHTML = head + empty(t('upcoming.none'), t('upcoming.noneBody'), 'cal'); return; }
    const groups = {};
    for (const x of open) (groups[x.due_date || '~'] = groups[x.due_date || '~'] || []).push(x);
    const tomorrow = Q.nextDue(state.today, 'daily');
    el.innerHTML = head + Object.keys(groups).sort().map((d) => `<section><h2 class="tl-section">${esc(d === '~' ? t('upcoming.later') : d === tomorrow ? `${t('upcoming.tomorrow')} · ${K.formatDate(`${d}T00:00:00+05:30`)}` : K.formatDate(`${d}T00:00:00+05:30`))}</h2>
<ul class="tl-tasks">${groups[d].map((x) => taskRow(x)).join('')}</ul></section>`).join('');
  }
  function calendar(dated) {
    const [ty, tm] = state.today.split('-').map(Number);
    if (!calMonth) calMonth = { y: ty, m: tm - 1 };
    const { y, m } = calMonth;
    const first = new Date(Date.UTC(y, m, 1));
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7; // weeks start on Monday
    const byDay = {};
    for (const x of dated) (byDay[x.due_date] = byDay[x.due_date] || []).push(x);
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<td></td>');
    for (let d = 1; d <= days; d++) {
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const n = (byDay[iso] || []).length;
      cells.push(`<td><button type="button" class="tl-day${iso === state.today ? ' tl-day--today' : ''}${n ? ' tl-day--has' : ''}" data-day="${iso}" aria-label="${esc(K.formatDate(`${iso}T00:00:00+05:30`))}${n ? `, ${n}` : ''}">${d}${n ? `<span class="tl-dot" aria-hidden="true">${n}</span>` : ''}</button></td>`);
    }
    while (cells.length % 7) cells.push('<td></td>');
    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(`<tr>${cells.slice(i, i + 7).join('')}</tr>`);
    const monthName = K.formatDate(first).replace(/^\d+ /, '');
    const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return `<div class="tl-cal"><div class="k-row k-row--between"><button class="k-btn k-btn--secondary k-btn--sm" type="button" data-cal="-1" aria-label="Previous month">‹</button>
<h2 class="tl-section" aria-live="polite">${esc(monthName)}</h2><button class="k-btn k-btn--secondary k-btn--sm" type="button" data-cal="1" aria-label="Next month">›</button></div>
<table class="tl-cal-grid"><thead><tr>${wd.map((w) => `<th scope="col">${w}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>
<div id="cal-day"></div></div>`;
  }

  let boardList = '';
  function board(el) {
    const open = state.tasks.filter((x) => !boardList || String(x.list_id) === boardList);
    const done = (state.done || []).filter((x) => !boardList || String(x.list_id) === boardList).slice(0, 30);
    const cols = STATUS_COLS.map(([status, label]) => {
      const cards = (status === 'Completed' ? done : open.filter((x) => x.status === status)).sort((a, b) => a.position - b.position || a.id - b.id);
      return `<section class="tl-col" data-status="${esc(status)}" aria-labelledby="col-${label}"><h2 id="col-${label}" class="tl-col-head">${esc(t(label))} <span class="k-chip k-chip--plain">${cards.length}</span></h2>
<ul class="tl-col-cards" data-drop="${esc(status)}">${cards.map((x) => `<li class="tl-card" draggable="true" tabindex="0" data-id="${esc(x.id)}" aria-describedby="board-keys">
<a href="${BASE}/task/${esc(x.id)}" data-act="open" class="tl-card-title">${prioFlag(x.priority)}${esc(x.title)}</a>
${x.due_date ? `<span class="tl-due${overdue(x) ? ' tl-due--late' : ''}">${esc(dueText(x))}</span>` : ''}
<label class="tl-move"><span class="k-sr-only">${esc(t('board.moveTo'))}</span><select class="k-select" data-move="${esc(x.id)}" aria-label="${esc(t('board.moveTo'))}: ${esc(x.title)}">${STATUS_COLS.map(([s, l]) => `<option value="${esc(s)}"${s === status ? ' selected' : ''}>${esc(t(l))}</option>`).join('')}</select></label></li>`).join('')}</ul></section>`;
    }).join('');
    el.innerHTML = `<header class="tl-head tl-head--row"><h1>${esc(t('board.title'))}</h1>
<label class="tl-board-filter"><span class="k-label">${esc(t('board.list'))}</span><select class="k-select" id="board-list"><option value="">${esc(t('board.allLists'))}</option>${state.lists.map((l) => `<option value="${l.id}"${String(l.id) === boardList ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label></header>
<p id="board-keys" class="k-hint">${esc(t('board.keys'))}</p><div class="tl-board">${cols}</div>`;
    if (state.done === null) api('GET', '/tasks?status=done&limit=30').then((r) => { state.done = r.tasks; if (route().view === 'board') render(); }).catch(() => { state.done = []; });
  }

  function lists(el) {
    el.innerHTML = `<header class="tl-head"><h1>${esc(t('lists.title'))}</h1></header>
<nav class="tl-more" aria-label="${esc(t('nav.more'))}"><a class="k-card k-card--link" href="${BASE}/tags" data-nav-link>${esc(t('nav.tags'))}</a><a class="k-card k-card--link" href="${BASE}/search" data-nav-link>${esc(t('nav.search'))}</a>
<a class="k-card k-card--link" href="${BASE}/archive" data-nav-link>${esc(t('nav.archive'))}</a><a class="k-card k-card--link" href="${BASE}/settings" data-nav-link>${esc(t('nav.settings'))}</a></nav>
<h2 class="tl-section">${esc(t('nav.lists'))}</h2>
${state.lists.length ? `<ul class="tl-lists">${state.lists.map((l) => `<li><a class="k-card k-card--link tl-list" href="${BASE}/list/${l.id}"><strong>${esc(l.name)}</strong><span class="k-muted">${esc(t('lists.open', { n: K.formatNumber(l.open_count || 0) }))}</span></a>
<button class="k-btn k-btn--ghost k-btn--sm" type="button" data-del-list="${l.id}" aria-label="${esc(t('lists.delete'))}: ${esc(l.name)}">✕</button></li>`).join('')}</ul>` : empty(t('lists.none'), t('lists.noneBody'), 'list')}
<form id="new-list" class="k-card tl-new-list" novalidate><div class="k-field"><label class="k-label" for="list-name">${esc(t('lists.new'))}</label>
<input class="k-input" id="list-name" maxlength="200" required aria-describedby="list-err"><span class="k-error" id="list-err"></span></div>
<button class="k-btn" type="submit">${esc(t('lists.create'))}</button></form>`;
  }

  function listView(id) {
    const l = state.lists.find((x) => x.id === id);
    const items = state.tasks.filter((x) => x.list_id === id && !isDone(x));
    $('#view').innerHTML = `<header class="tl-head"><p><a href="${BASE}/lists">← ${esc(t('nav.lists'))}</a></p><h1>${esc(l ? l.name : t('nav.inbox'))}</h1></header>
${items.length ? `<ul class="tl-tasks">${items.map((x) => taskRow(x, { showList: false })).join('')}</ul>` : empty(t('upcoming.none'), t('lists.noneBody'), 'list')}`;
  }

  function tags(el) {
    el.innerHTML = `<header class="tl-head"><h1>${esc(t('tags.title'))}</h1></header>
${state.tags.length ? `<ul class="tl-tagcloud">${state.tags.map((g) => `<li><a class="k-chip k-chip--accent k-chip--plain tl-tagchip" href="${BASE}/tag/${encodeURIComponent(g.tag)}">#${esc(g.tag)} <span>${esc(K.formatNumber(g.count))}</span></a></li>`).join('')}</ul>` : empty(t('tags.none'), t('tags.noneBody'), 'list')}`;
  }
  function tagView(tag) {
    const items = state.tasks.filter((x) => (x.tags || []).includes(tag) && !isDone(x));
    $('#view').innerHTML = `<header class="tl-head"><p><a href="${BASE}/tags">← ${esc(t('nav.tags'))}</a></p><h1>#${esc(tag)}</h1></header>
${items.length ? `<ul class="tl-tasks">${items.map((x) => taskRow(x)).join('')}</ul>` : empty(t('search.none'), t('tags.noneBody'), 'list')}`;
  }

  let searchTerm = '';
  function search(el) {
    el.innerHTML = `<header class="tl-head"><h1>${esc(t('search.title'))}</h1></header>
<form id="search-form" role="search" class="k-search"><label class="k-sr-only" for="search-q">${esc(t('search.label'))}</label>
<input class="k-input" id="search-q" type="search" value="${esc(searchTerm)}" placeholder="${esc(t('search.label'))}" autofocus></form>
<div id="search-results" aria-live="polite">${searchTerm ? '' : `<p class="k-muted">${esc(t('search.prompt'))}</p>`}</div>`;
    if (searchTerm) runSearch();
  }
  let searchTimer;
  function runSearch() {
    const out = $('#search-results');
    if (!out) return;
    const q = searchTerm.toLowerCase();
    const local = state.tasks.filter((x) => x.title.toLowerCase().includes(q) || String(x.notes || '').toLowerCase().includes(q) || (x.tags || []).some((g) => g.includes(q.replace(/^#/, ''))));
    out.innerHTML = local.length ? `<ul class="tl-tasks">${local.map((x) => taskRow(x)).join('')}</ul>` : `<div class="k-skel k-skel--line"></div>`;
    api('GET', `/tasks?status=all&q=${encodeURIComponent(searchTerm)}&limit=100`).then((r) => {
      if (searchTerm.toLowerCase() !== q || !$('#search-results')) return;
      $('#search-results').innerHTML = r.tasks.length ? `<ul class="tl-tasks">${r.tasks.map((x) => taskRow(x)).join('')}</ul>` : empty(t('search.none'), t('search.prompt'), 'list');
    }).catch(() => { if (!local.length) out.innerHTML = empty(t('search.none'), t('search.prompt'), 'list'); });
  }

  function archive(el) {
    el.innerHTML = `<header class="tl-head"><h1>${esc(t('archive.title'))}</h1></header><div id="archive-list"><div class="k-skel k-skel--card"></div></div>`;
    api('GET', '/tasks?status=done&limit=200').then((r) => {
      state.done = r.tasks;
      const box = $('#archive-list');
      if (!box) return;
      box.innerHTML = r.tasks.length ? `<ul class="tl-tasks">${r.tasks.map((x) => taskRow(x)).join('')}</ul>` : empty(t('archive.none'), t('archive.noneBody'), 'done');
    }).catch(() => { const box = $('#archive-list'); if (box) box.innerHTML = `<div class="k-banner k-banner--danger"><p>${esc(t('err.load'))}</p></div>`; });
  }

  function settings(el) {
    const s = state.settings || {};
    const u = state.user || {};
    const leads = [0, 5, 10, 15, 30, 60];
    el.innerHTML = `<header class="tl-head"><h1>${esc(t('settings.title'))}</h1><p class="k-muted">${esc(t('settings.separate'))}</p></header>
<section class="k-card tl-settings"><h2>${esc(t('settings.account'))}</h2>
<p class="k-muted">${esc(u.email || '')}${u.email && u.mobile ? ' · ' : ''}${u.mobile ? `+91 ${esc(u.mobile)}` : ''}</p>
<form id="s-name" class="k-row" novalidate><div class="k-field" style="flex:1;min-width:200px"><label class="k-label" for="s-name-in">${esc(t('settings.name'))}</label><input class="k-input" id="s-name-in" value="${esc(u.name || '')}" maxlength="120"></div>
<button class="k-btn k-btn--secondary" type="submit">${esc(t('settings.saveName'))}</button></form>
<form id="s-pw" novalidate><h3>${esc(t('settings.password'))}</h3>
${u.hasPassword ? `<div class="k-field"><label class="k-label" for="s-cur">${esc(t('settings.current'))}</label><input class="k-input" id="s-cur" type="password" autocomplete="current-password"></div>` : ''}
<div class="k-field"><label class="k-label" for="s-new">${esc(t('settings.new'))}</label><span class="k-hint" id="s-new-hint">${esc(t('auth.passwordHint'))}</span><input class="k-input" id="s-new" type="password" autocomplete="new-password" aria-describedby="s-new-hint s-pw-err"><span class="k-error" id="s-pw-err"></span></div>
<button class="k-btn k-btn--secondary" type="submit">${esc(t('settings.setPassword'))}</button></form></section>
<section class="k-card tl-settings"><h2>${esc(t('settings.reminders'))}</h2><form id="s-prefs" novalidate>
<label class="k-check"><input type="checkbox" id="s-rem"${s.reminders ? ' checked' : ''}><span>${esc(t('settings.remindersOn'))}</span></label>
<p class="k-error" id="s-rem-err"></p>
<div class="k-field"><label class="k-label" for="s-lead">${esc(t('settings.lead'))}</label><select class="k-select" id="s-lead">${leads.map((n) => `<option value="${n}"${Number(s.reminderLead ?? 10) === n ? ' selected' : ''}>${esc(t('settings.min', { n }))}</option>`).join('')}</select></div>
<label class="k-check"><input type="checkbox" id="s-digest"${s.emailDigest ? ' checked' : ''}><span>${esc(t('settings.emailDigest'))}</span></label>
<div class="k-field"><label class="k-label" for="s-start">${esc(t('settings.start'))}</label><select class="k-select" id="s-start">${['today', 'upcoming', 'board'].map((v) => `<option value="${v}"${(s.startView || 'today') === v ? ' selected' : ''}>${esc(t(`nav.${v}`))}</option>`).join('')}</select></div>
<button class="k-btn" type="submit">${esc(t('settings.save'))}</button></form></section>
<section class="k-card tl-settings"><h2>${esc(t('settings.data'))}</h2><div class="k-row">
<button class="k-btn k-btn--secondary" type="button" id="s-export">${esc(t('settings.export'))}</button>
<button class="k-btn k-btn--danger" type="button" id="s-delete">${esc(t('settings.deleteAcc'))}</button></div>
<p><button class="k-btn k-btn--ghost" type="button" id="s-signout">${esc(t('settings.signOut'))}</button></p></section>`;
  }

  /* ---------------- task detail ---------------- */
  let detailId = null;
  async function openDetail(id) {
    const dlg = $('#detail');
    detailId = id;
    const local = state.tasks.find((x) => String(x.id) === String(id)) || (state.done || []).find((x) => String(x.id) === String(id));
    paintDetail(local ? { ...local, subtasks: null, comments: null } : null);
    if (!dlg.open) K.openDialog(dlg);
    if (String(id).startsWith('tmp-')) return;
    try {
      const full = await api('GET', `/tasks/${encodeURIComponent(id)}`);
      if (detailId === id) paintDetail(full);
    } catch (err) {
      if (!local) $('#detail-body').innerHTML = `<div class="k-banner k-banner--danger"><p>${esc(err.offline ? t('offline.banner') : err.message)}</p></div>`;
    }
  }
  function paintDetail(x) {
    const body = $('#detail-body');
    if (!x) { body.innerHTML = '<div class="k-skel k-skel--card"></div>'; return; }
    const reps = [null, ...Q.RECURRENCES];
    const remind = x.remind_at ? new Date(x.remind_at) : null;
    const remindLocal = remind ? (() => { const p = K.toIstParts(remind); return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}T${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`; })() : '';
    body.innerHTML = `
<div class="k-field"><label class="k-label" for="d-title">${esc(t('task.title'))}</label><input class="k-input" id="d-title" value="${esc(x.title)}" maxlength="250" required aria-describedby="d-title-err"><span class="k-error" id="d-title-err"></span></div>
<div class="tl-grid2">
<div class="k-field"><label class="k-label" for="d-due">${esc(t('task.due'))}</label><input class="k-input" id="d-due" type="date" value="${esc(x.due_date || '')}"></div>
<div class="k-field"><label class="k-label" for="d-time">${esc(t('task.time'))}</label><input class="k-input" id="d-time" type="time" value="${esc(x.due_time || '')}"></div>
<div class="k-field"><label class="k-label" for="d-prio">${esc(t('task.priority'))}</label><select class="k-select" id="d-prio">${[0, 1, 2, 3].map((p) => `<option value="${p}"${x.priority === p ? ' selected' : ''}>${esc(t(`prio.${p}`))}</option>`).join('')}</select></div>
<div class="k-field"><label class="k-label" for="d-status">${esc(t('task.status'))}</label><select class="k-select" id="d-status">${['Not Started', 'In Progress', 'On Hold', 'Completed', 'Cancelled'].map((s) => `<option value="${esc(s)}"${x.status === s ? ' selected' : ''}>${esc(t(`status.${s}`))}</option>`).join('')}</select></div>
<div class="k-field"><label class="k-label" for="d-list">${esc(t('task.list'))}</label><select class="k-select" id="d-list"><option value="">${esc(t('nav.inbox'))}</option>${state.lists.map((l) => `<option value="${l.id}"${x.list_id === l.id ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
<div class="k-field"><label class="k-label" for="d-rep">${esc(t('task.repeat'))}</label><select class="k-select" id="d-rep">${reps.map((r) => `<option value="${r || ''}"${(x.recurrence || null) === r ? ' selected' : ''}>${esc(t(`rep.${r || 'none'}`))}</option>`).join('')}</select></div>
</div>
<div class="k-field"><label class="k-label" for="d-tags">${esc(t('task.tags'))}</label><span class="k-hint" id="d-tags-hint">${esc(t('task.tagsHint'))}</span><input class="k-input" id="d-tags" value="${esc((x.tags || []).map((g) => `#${g}`).join(' '))}" aria-describedby="d-tags-hint"></div>
<div class="k-field"><label class="k-label" for="d-remind">${esc(t('task.reminder'))}</label><input class="k-input" id="d-remind" type="datetime-local" value="${esc(remindLocal)}"></div>
<div class="k-field"><label class="k-label" for="d-notes">${esc(t('task.notes'))}</label><textarea class="k-textarea" id="d-notes" maxlength="5000">${esc(x.notes || '')}</textarea></div>
<fieldset class="tl-fs"><legend class="k-label">${esc(t('task.subtasks'))}</legend>
${x.subtasks === null ? '<div class="k-skel k-skel--line"></div>' : `<ul class="tl-tasks tl-subtasks">${(x.subtasks || []).map((s) => taskRow(s, { showList: false })).join('')}</ul>`}
<div class="k-row"><label class="k-sr-only" for="d-sub">${esc(t('task.addSub'))}</label><input class="k-input" id="d-sub" placeholder="${esc(t('task.addSub'))}" style="flex:1" maxlength="250"><button class="k-btn k-btn--secondary" type="button" id="d-sub-add">+</button></div></fieldset>
<fieldset class="tl-fs"><legend class="k-label">${esc(t('task.attachments'))}</legend>
<ul class="tl-links">${(x.attachments || []).map((a, i) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.name)}</a> <button class="k-btn k-btn--ghost k-btn--sm" type="button" data-rm-link="${i}" aria-label="Remove ${esc(a.name)}">✕</button></li>`).join('')}</ul>
<div class="tl-grid2"><input class="k-input" id="d-link-name" placeholder="${esc(t('task.linkName'))}" aria-label="${esc(t('task.linkName'))}" maxlength="120"><input class="k-input" id="d-link-url" type="url" placeholder="${esc(t('task.linkUrl'))}" aria-label="${esc(t('task.linkUrl'))}"></div>
<button class="k-btn k-btn--secondary k-btn--sm" type="button" id="d-link-add">${esc(t('task.addLink'))}</button></fieldset>
<fieldset class="tl-fs"><legend class="k-label">${esc(t('task.updates'))}</legend>
<div class="k-row"><label class="k-sr-only" for="d-update">${esc(t('task.addUpdate'))}</label><input class="k-input" id="d-update" placeholder="${esc(t('task.updatePh'))}" style="flex:1" maxlength="5000"><button class="k-btn k-btn--secondary" type="button" id="d-update-add">${esc(t('task.addUpdate'))}</button></div>
${x.comments === null ? '' : `<ul class="tl-updates">${(x.comments || []).map((c) => `<li><span class="k-muted k-small">${esc(K.formatDateTime(`${String(c.created_at).replace(' ', 'T')}Z`))}</span><p>${esc(c.body)}</p></li>`).join('')}</ul>`}</fieldset>`;
    body.dataset.attachments = JSON.stringify(x.attachments || []);
    $('#detail-h').textContent = x.title;
  }

  function detailPayload() {
    const tagsIn = $('#d-tags').value.split(/[\s,]+/).map((g) => g.replace(/^#/, '').trim()).filter(Boolean);
    const remind = $('#d-remind').value;
    return {
      title: $('#d-title').value.trim(), notes: $('#d-notes').value, due_date: $('#d-due').value || null, due_time: $('#d-time').value || null,
      priority: Number($('#d-prio').value), status: $('#d-status').value, list_id: $('#d-list').value ? Number($('#d-list').value) : null,
      recurrence: $('#d-rep').value || null, tags: tagsIn, attachments: JSON.parse($('#detail-body').dataset.attachments || '[]'),
      remind_at: remind ? new Date(`${remind}:00+05:30`).toISOString() : null,
    };
  }

  function applyLocal(id, patch) {
    const x = state.tasks.find((y) => String(y.id) === String(id));
    if (x) Object.assign(x, patch);
    if (x && isDone(x)) state.tasks = state.tasks.filter((y) => y !== x);
    state.done = null;
    save();
  }

  /* ---------------- events ---------------- */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a && a.getAttribute('href') && a.getAttribute('href').startsWith(`${BASE}/`) && !a.target && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      const href = a.getAttribute('href');
      if (/^\/tasklist\/(sign-|forgot|reset|verify|api)/.test(href)) return;
      e.preventDefault();
      if (a.dataset.act === 'open') { history.pushState({ detail: true }, '', href); openDetail(href.split('/').pop()); return; }
      go(href);
      $('#view').focus();
      return;
    }
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.act === 'toggle') {
      const li = btn.closest('[data-id]');
      const id = li.dataset.id;
      const x = state.tasks.find((y) => String(y.id) === id) || (state.done || []).find((y) => String(y.id) === id);
      if (!x) {
        // A sub-task in the detail dialog: not in the top-level list.
        const pressed = btn.getAttribute('aria-pressed') === 'true';
        btn.setAttribute('aria-pressed', String(!pressed));
        li.classList.toggle('tl-task--done', !pressed);
        api('PATCH', `/tasks/${id}`, { status: pressed ? 'Not Started' : 'Completed' }).then(() => refresh())
          .catch((err) => K.toast(err.offline ? t('offline.banner') : err.message, { kind: 'danger' }));
        return;
      }
      const status = isDone(x) ? 'Not Started' : 'Completed';
      li.classList.toggle('tl-task--done', status === 'Completed');
      btn.setAttribute('aria-pressed', String(status === 'Completed'));
      if (status === 'Not Started') { x.status = status; state.tasks.push(x); state.done = null; }
      setTimeout(() => { applyLocal(id, { status }); render(); if ($('#detail').open) openDetail(detailId); }, 250);
      mutate({ method: 'PATCH', path: `/tasks/${id}`, body: { status } });
      return;
    }
    if (btn.dataset.mode) { upcomingMode = btn.dataset.mode; render(); return; }
    if (btn.dataset.cal) { calMonth.m += Number(btn.dataset.cal); if (calMonth.m < 0) { calMonth.m = 11; calMonth.y -= 1; } if (calMonth.m > 11) { calMonth.m = 0; calMonth.y += 1; } render(); return; }
    if (btn.dataset.day) {
      const day = btn.dataset.day;
      const items = state.tasks.filter((x) => x.due_date === day && !isDone(x));
      $('#cal-day').innerHTML = `<h3 class="tl-section">${esc(K.formatDate(`${day}T00:00:00+05:30`))}</h3>${items.length ? `<ul class="tl-tasks">${items.map((x) => taskRow(x)).join('')}</ul>` : `<p class="k-muted">${esc(t('upcoming.none'))}</p>`}`;
      return;
    }
    if (btn.dataset.delList) {
      const l = state.lists.find((x) => String(x.id) === btn.dataset.delList);
      confirmDialog(t('lists.delete'), t('lists.deleteAsk', { name: l ? l.name : '' }), t('lists.delete'), () => {
        state.lists = state.lists.filter((x) => x !== l);
        state.tasks.forEach((x) => { if (l && x.list_id === l.id) x.list_id = null; });
        mutate({ method: 'DELETE', path: `/lists/${btn.dataset.delList}` });
        render();
      });
      return;
    }
    if (btn.dataset.rmLink !== undefined) {
      const body = $('#detail-body');
      const list = JSON.parse(body.dataset.attachments || '[]');
      list.splice(Number(btn.dataset.rmLink), 1);
      body.dataset.attachments = JSON.stringify(list);
      btn.closest('li').remove();
      return;
    }
    switch (btn.id) {
      case 'd-sub-add': {
        const title = $('#d-sub').value.trim();
        if (!title || String(detailId).startsWith('tmp-')) return;
        api('POST', '/tasks', { title, parent_id: Number(detailId), client_id: uid() }).then(() => { $('#d-sub').value = ''; openDetail(detailId); refresh(); })
          .catch((err) => K.toast(err.offline ? t('offline.banner') : err.message, { kind: 'danger' }));
        return;
      }
      case 'd-link-add': {
        const url = $('#d-link-url').value.trim();
        if (!/^https:\/\//.test(url)) { K.toast(t('task.linkUrl'), { kind: 'danger' }); return; }
        const body = $('#detail-body');
        const list = JSON.parse(body.dataset.attachments || '[]');
        list.push({ name: $('#d-link-name').value.trim() || url, url });
        body.dataset.attachments = JSON.stringify(list);
        $('.tl-links').insertAdjacentHTML('beforeend', `<li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc($('#d-link-name').value.trim() || url)}</a></li>`);
        $('#d-link-url').value = ''; $('#d-link-name').value = '';
        return;
      }
      case 'd-update-add': {
        const text = $('#d-update').value.trim();
        if (!text) return;
        api('POST', `/tasks/${detailId}/comments`, { body: text }).then(() => { $('#d-update').value = ''; openDetail(detailId); })
          .catch((err) => K.toast(err.offline ? t('offline.banner') : err.message, { kind: 'danger' }));
        return;
      }
      case 'detail-delete': {
        const x = state.tasks.find((y) => String(y.id) === String(detailId)) || {};
        confirmDialog(t('task.delete'), t('task.deleteAsk', { title: x.title || '' }), t('task.delete'), () => {
          const id = detailId;
          state.tasks = state.tasks.filter((y) => String(y.id) !== String(id));
          closeDetail();
          mutate({ method: 'DELETE', path: `/tasks/${id}` });
          render();
          K.toast(t('task.deleted'));
        });
        return;
      }
      case 's-export': {
        api('GET', '/export').then((data) => {
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `tasklist-export-${state.today}.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        }).catch((err) => K.toast(err.message, { kind: 'danger' }));
        return;
      }
      case 's-delete':
        confirmDialog(t('settings.deleteAcc'), `${t('settings.deleteAsk')}<div class="k-field" style="margin-top:12px"><label class="k-label" for="del-confirm">DELETE</label><input class="k-input" id="del-confirm" autocomplete="off"></div>`, t('settings.deleteAcc'), () => {
          api('POST', '/account/delete', { confirm: $('#del-confirm').value }).then(() => { clearLocal(); location.href = `${BASE}/sign-up`; })
            .catch((err) => K.toast(err.message, { kind: 'danger' }));
        }, true);
        return;
      case 's-signout':
        api('POST', '/auth/sign-out', {}).finally(() => { clearLocal(); location.href = `${BASE}/sign-in`; });
        return;
      default:
    }
  });

  function clearLocal() { if (!state.user) return; K.store.remove(key('cache')); K.store.remove(key('queue')); }

  function confirmDialog(title, html, okLabel, onOk, raw) {
    const dlg = $('#confirm');
    $('#confirm-h').textContent = title;
    $('#confirm-body').innerHTML = raw ? html : `<p>${esc(html)}</p>`;
    const ok = $('#confirm-ok');
    ok.textContent = okLabel;
    ok.onclick = () => { dlg.close(); onOk(); };
    K.openDialog(dlg);
  }

  // A dialog's close event arrives later, as a task of its own, so the address
  // is put back here first: a render straight after must not reopen the task.
  function closeDetail() {
    detailId = null;
    if (/\/task\//.test(location.pathname)) history.replaceState({}, '', `${BASE}/`);
    if ($('#detail').open) $('#detail').close();
  }
  $('#detail').addEventListener('close', () => {
    detailId = null;
    if (/\/task\//.test(location.pathname)) history.replaceState({}, '', `${BASE}/`);
  });
  $('#detail-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const p = detailPayload();
    if (!p.title) { $('#d-title-err').textContent = t('quick.empty'); $('#d-title').setAttribute('aria-invalid', 'true'); $('#d-title').focus(); return; }
    const id = detailId;
    applyLocal(id, { ...p, notes: p.notes });
    mutate({ method: 'PATCH', path: `/tasks/${id}`, body: p });
    closeDetail();
    render();
    K.toast(t('task.saved'), { kind: 'success' });
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id === 'new-list') {
      e.preventDefault();
      const name = $('#list-name').value.trim();
      if (!name) { $('#list-err').textContent = t('lists.name'); return; }
      api('POST', '/lists', { name }).then((l) => { state.lists.push({ ...l, open_count: 0 }); save(); render(); })
        .catch((err) => K.toast(err.offline ? t('offline.banner') : err.message, { kind: 'danger' }));
    }
    if (e.target.id === 'search-form') { e.preventDefault(); searchTerm = $('#search-q').value.trim(); runSearch(); }
    if (e.target.id === 's-name') {
      e.preventDefault();
      api('POST', '/auth/account', { name: $('#s-name-in').value }).then((r) => { state.user = r.user; save(); K.toast(t('task.saved'), { kind: 'success' }); }).catch((err) => K.toast(err.message, { kind: 'danger' }));
    }
    if (e.target.id === 's-pw') {
      e.preventDefault();
      api('POST', '/auth/account', { newPassword: $('#s-new').value, currentPassword: $('#s-cur') ? $('#s-cur').value : undefined })
        .then((r) => { state.user = r.user; $('#s-pw-err').textContent = ''; e.target.reset(); K.toast(t('task.saved'), { kind: 'success' }); })
        .catch((err) => { $('#s-pw-err').textContent = err.message; });
    }
    if (e.target.id === 's-prefs') {
      e.preventDefault();
      const body = { reminders: $('#s-rem').checked, reminderLead: Number($('#s-lead').value), emailDigest: $('#s-digest').checked, startView: $('#s-start').value };
      const go2 = () => api('PUT', '/settings', body).then((r) => { state.settings = r.settings; save(); K.toast(t('settings.saved'), { kind: 'success' }); }).catch((err) => K.toast(err.message, { kind: 'danger' }));
      if (body.reminders && 'Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission().then((p) => { if (p !== 'granted') { $('#s-rem-err').textContent = t('settings.notifyBlocked'); body.reminders = false; } go2(); });
      } else go2();
    }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'search-q') { clearTimeout(searchTimer); searchTerm = e.target.value.trim(); searchTimer = setTimeout(runSearch, 250); }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'board-list') { boardList = e.target.value; render(); }
    if (e.target.dataset.move) moveCard(e.target.dataset.move, e.target.value, null);
  });

  /* ---------------- quick add ---------------- */
  const quickInput = $('#quick-input');
  function preview() {
    const p = Q.parse(quickInput.value);
    const chips = [];
    if (p.due_date) chips.push(`📅 ${esc(dueText({ due_date: p.due_date, due_time: p.due_time }))}`);
    if (p.recurrence) chips.push(`↻ ${esc(t(`rep.${p.recurrence}`))}`);
    if (p.priority) chips.push(`⚑ ${esc(t(`prio.${p.priority}`))}`);
    if (p.list) chips.push(`▤ ${esc(p.list)}`);
    p.tags.forEach((g) => chips.push(`#${esc(g)}`));
    $('#quick-preview').innerHTML = quickInput.value && chips.length ? chips.map((c) => `<span class="k-chip k-chip--accent k-chip--plain">${c}</span>`).join(' ') : '';
  }
  quickInput.addEventListener('input', preview);
  $('#quick').addEventListener('submit', (e) => {
    e.preventDefault();
    const p = Q.parse(quickInput.value);
    if (!p.title) { K.toast(t('quick.empty'), { kind: 'danger' }); quickInput.focus(); return; }
    const list = p.list ? state.lists.find((l) => l.name.toLowerCase() === p.list.toLowerCase().replace(/[-_]/g, ' ') || l.name.toLowerCase() === p.list.toLowerCase()) : null;
    const clientId = uid();
    const tmp = `tmp-${clientId}`;
    const body = { title: p.title, due_date: p.due_date, due_time: p.due_time, tags: p.tags, priority: p.priority, recurrence: p.recurrence, list_id: list ? list.id : null, client_id: clientId };
    state.tasks.push({ ...body, id: tmp, tmp, status: 'Not Started', position: 0, subtask_count: 0, subtask_done: 0, attachments: [] });
    mutate({ method: 'POST', path: '/tasks', body, tmp });
    quickInput.value = '';
    preview();
    render();
    K.toast(t('quick.added', { title: p.title }));
    quickInput.focus();
  });

  /* ---------------- board: drag and drop, and the keyboard ---------------- */
  function columnIds(status) { return $$(`[data-drop="${CSS.escape(status)}"] .tl-card`).map((c) => c.dataset.id).filter((id) => !id.startsWith('tmp-')); }
  function moveCard(id, status, beforeId) {
    const x = state.tasks.find((y) => String(y.id) === String(id)) || (state.done || []).find((y) => String(y.id) === String(id));
    if (!x) return;
    const from = x.status;
    const col = $(`[data-drop="${CSS.escape(status)}"]`);
    const card = $(`.tl-card[data-id="${CSS.escape(String(id))}"]`);
    if (col && card) { const before = beforeId ? $(`.tl-card[data-id="${CSS.escape(String(beforeId))}"]`, col) : null; col.insertBefore(card, before); }
    x.status = status;
    if (status === 'Completed') { state.tasks = state.tasks.filter((y) => y !== x); state.done = [x, ...(state.done || []).filter((y) => y !== x)]; } else if (from === 'Completed') { state.done = (state.done || []).filter((y) => y !== x); state.tasks.push(x); }
    const ids = columnIds(status);
    ids.forEach((cid, i) => { const y = state.tasks.find((z) => String(z.id) === cid); if (y) y.position = i; });
    mutate({ method: 'POST', path: '/board/move', body: { status, ids: ids.map(Number) } });
    if (from !== status) mutate({ method: 'POST', path: '/board/move', body: { status: from, ids: columnIds(from).map(Number) } });
    const label = STATUS_COLS.find(([s]) => s === status)[1];
    K.toast(t('board.moved', { column: t(label) }));
    render();
    const again = $(`.tl-card[data-id="${CSS.escape(String(id))}"]`);
    if (again) again.focus();
  }
  document.addEventListener('dragstart', (e) => { const c = e.target.closest && e.target.closest('.tl-card'); if (c) { e.dataTransfer.setData('text/plain', c.dataset.id); c.classList.add('tl-card--drag'); } });
  document.addEventListener('dragend', (e) => { const c = e.target.closest && e.target.closest('.tl-card'); if (c) c.classList.remove('tl-card--drag'); });
  document.addEventListener('dragover', (e) => { const col = e.target.closest && e.target.closest('[data-drop]'); if (col) { e.preventDefault(); col.classList.add('tl-col--over'); } });
  document.addEventListener('dragleave', (e) => { const col = e.target.closest && e.target.closest('[data-drop]'); if (col) col.classList.remove('tl-col--over'); });
  document.addEventListener('drop', (e) => {
    const col = e.target.closest && e.target.closest('[data-drop]');
    if (!col) return;
    e.preventDefault();
    col.classList.remove('tl-col--over');
    const before = e.target.closest('.tl-card');
    moveCard(e.dataTransfer.getData('text/plain'), col.dataset.drop, before ? before.dataset.id : null);
  });
  document.addEventListener('keydown', (e) => {
    const card = e.target.closest && e.target.closest('.tl-card');
    if (card && e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const status = card.closest('[data-drop]').dataset.drop;
      const i = STATUS_COLS.findIndex(([s]) => s === status);
      if (e.key === 'ArrowLeft' && i > 0) moveCard(card.dataset.id, STATUS_COLS[i - 1][0], null);
      if (e.key === 'ArrowRight' && i < STATUS_COLS.length - 1) moveCard(card.dataset.id, STATUS_COLS[i + 1][0], null);
      if (e.key === 'ArrowUp' && card.previousElementSibling) moveCard(card.dataset.id, status, card.previousElementSibling.dataset.id);
      if (e.key === 'ArrowDown' && card.nextElementSibling) moveCard(card.dataset.id, status, card.nextElementSibling.nextElementSibling ? card.nextElementSibling.nextElementSibling.dataset.id : null);
    }
    if (card && e.key === 'Enter' && e.target === card) { const a = $('a', card); if (a) a.click(); }
    // "n" or "/" from anywhere but a field: jump to the quick-add bar.
    if ((e.key === 'n' || e.key === '/') && !e.target.closest('input,textarea,select,[contenteditable]') && !e.altKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); quickInput.focus(); }
  });

  /* ---------------- reminders (on this device, while TaskList is open) ---------------- */
  function checkReminders() {
    if (!state.settings.reminders || !('Notification' in window) || Notification.permission !== 'granted') return;
    const lead = Number(state.settings.reminderLead ?? 10) * 60000;
    const now = Date.now();
    let seen;
    try { seen = JSON.parse(sessionStorage.getItem('tl.reminded') || '[]'); } catch { seen = []; }
    for (const x of state.tasks) {
      const at = x.remind_at ? Date.parse(x.remind_at) : (x.due_date && x.due_time ? Date.parse(`${x.due_date}T${x.due_time}:00+05:30`) - lead : NaN);
      if (!Number.isFinite(at) || at > now || now - at > 6 * 3600000 || seen.includes(String(x.id))) continue;
      seen.push(String(x.id));
      const text = `${x.title}${x.due_time ? ` — ${K.formatTime(`${x.due_date}T${x.due_time}:00+05:30`)}` : ''}`;
      if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then((r) => r.showNotification('TaskList', { body: text, tag: `tl-${x.id}`, icon: '/icons/icon-192.png', data: { url: `${BASE}/task/${x.id}` } }));
      else new Notification('TaskList', { body: text, tag: `tl-${x.id}` });
    }
    try { sessionStorage.setItem('tl.reminded', JSON.stringify(seen.slice(-200))); } catch { /* blocked */ }
  }

  /* ---------------- start ---------------- */
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: `${BASE}/` }).catch(() => {});
  window.addEventListener('kesari:lang', () => render());

  (async function start() {
    // Show what this device last saw at once, then fetch fresh data.
    try {
      const me = await api('GET', '/auth/session');
      if (!me.user) { location.href = `${BASE}/sign-in`; return; }
      state.user = me.user;
      state.csrf = me.csrf;
    } catch (err) {
      if (!err.offline) throw err;
    }
    const lastUser = state.user ? state.user.id : (() => { try { return K.store.get('tl.last'); } catch { return null; } })();
    if (lastUser) {
      const c = restore(lastUser);
      if (c) { Object.assign(state, { lists: c.lists || [], tags: c.tags || [], tasks: c.tasks || [], settings: c.settings || {}, user: state.user || c.user, loaded: true }); render(); }
      K.store.set('tl.last', String(lastUser));
    }
    if (location.pathname === `${BASE}/` && state.settings.startView && state.settings.startView !== 'today') history.replaceState({}, '', `${BASE}/${state.settings.startView}`);
    await refresh();
    flush();
    setInterval(checkReminders, 30000);
    checkReminders();
    if (state.features.live) {
      const s = document.createElement('script');
      s.src = `${BASE}/live.js`;
      s.onload = () => window.bkLive && window.bkLive.watchTracker({ fetchLive: () => api('GET', '/live').catch(() => null), onChange: () => refresh() });
      document.body.appendChild(s);
    }
  })().catch(() => {
    $('#view').innerHTML = `<div class="k-banner k-banner--danger" role="alert"><p>${esc(t('err.load'))}</p></div><button class="k-btn" type="button" id="retry">${esc(t('err.retry'))}</button>`;
    $('#retry').addEventListener('click', () => location.reload());
  });
})();
