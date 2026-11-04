/**
 * TaskList quick-add: one line in, a task out.
 *
 *   "Call vendor tomorrow 5pm #gokesari"  ->
 *   { title: 'Call vendor', due_date: '<tomorrow, IST>', due_time: '17:00', tags: ['gokesari'], priority: 0 }
 *
 * Understands (case-insensitive, anywhere in the line):
 *   dates     today, tonight, tomorrow, day after tomorrow, mon..sun / monday..sunday,
 *             next monday, in 3 days, in 2 weeks, 5 nov, nov 5, 5/11, 5/11/2026, 2026-11-05;
 *             आज / उद्या / परवा (mr), आज / कल / परसों (hi)
 *   times     5pm, 5:30pm, 5.30 pm, 17:00, at 5 (afternoon if 1-7), noon, midnight
 *   tags      #word (letters, digits, - and _ ; Devanagari too)
 *   list      @list-name   -> list (matched against your lists by the app)
 *   priority  !high !med !low, !1 !2 !3, p1 p2 p3, !!!
 *   repeat    every day | daily | every weekday | weekly | every week | monthly | every month
 *             | yearly | every monday
 * Dates are IST calendar days: "today" is today in India whatever the device clock's zone.
 *
 * Browser: window.TLQuickAdd.parse(text, { now }). Node: require(...).parse.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TLQuickAdd = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const IST = 330 * 60000;
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  /** The IST calendar day of `now` as a UTC-midnight Date (date arithmetic only). */
  function istDay(now) {
    const d = new Date((now instanceof Date ? now.getTime() : Number(now) || Date.now()) + IST);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const pad = (n) => String(n).padStart(2, '0');

  function validDate(y, m, day) {
    const d = new Date(Date.UTC(y, m, day));
    return d.getUTCFullYear() === y && d.getUTCMonth() === m && d.getUTCDate() === day ? d : null;
  }

  /**
   * A day-of-month + month with no year: this year's, unless that is more than
   * 30 days gone, then next year's. "Report 2 Nov" written on 3 Nov is an
   * overdue report, not one due a year from now.
   */
  function nextOccurrence(today, m, day) {
    let d = validDate(today.getUTCFullYear(), m, day);
    if (d && d < addDays(today, -30)) d = validDate(today.getUTCFullYear() + 1, m, day);
    return d;
  }

  const RULES = [];
  const rule = (re, fn) => RULES.push({ re, fn });

  // Order matters: longer phrases before the words they contain.
  rule(/\b(?:every\s+weekday|weekdays)\b/i, (m, s) => { s.recurrence = 'weekdays'; });
  rule(/\b(?:every\s+day|daily)\b/i, (m, s) => { s.recurrence = 'daily'; });
  rule(/\b(?:every\s+week|weekly)\b/i, (m, s) => { s.recurrence = 'weekly'; });
  rule(/\b(?:every\s+month|monthly)\b/i, (m, s) => { s.recurrence = 'monthly'; });
  rule(/\b(?:every\s+year|yearly|annually)\b/i, (m, s) => { s.recurrence = 'yearly'; });
  rule(/\bevery\s+(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i, (m, s, today) => {
    s.recurrence = 'weekly';
    const want = DAYS.findIndex((d) => d.startsWith(m[1].toLowerCase().slice(0, 3)));
    s.date = addDays(today, (want - today.getUTCDay() + 7) % 7);
  });
  // Devanagari words have no \b in JavaScript regexes, so they are matched between spaces.
  rule(/\bday\s+after\s+tomorrow\b|(?<=\s)(?:परवा|परसों)(?=\s)/i, (m, s, today) => { s.date = addDays(today, 2); });
  rule(/\b(?:tomorrow|tmrw|tmr)\b|(?<=\s)(?:उद्या|कल)(?=\s)/i, (m, s, today) => { s.date = addDays(today, 1); });
  rule(/\btonight\b/i, (m, s, today) => { s.date = today; if (!s.time) s.time = '20:00'; });
  rule(/\btoday\b|(?<=\s)आज(?=\s)/i, (m, s, today) => { s.date = today; });
  rule(/\bin\s+(\d{1,3})\s+(day|days|week|weeks|month|months)\b/i, (m, s, today) => {
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    if (unit.startsWith('day')) s.date = addDays(today, n);
    else if (unit.startsWith('week')) s.date = addDays(today, 7 * n);
    else s.date = validDate(today.getUTCFullYear(), today.getUTCMonth() + n, today.getUTCDate()) || addDays(today, 30 * n);
  });
  // Full day names anywhere; the short forms only after "on" or "next", so
  // "buy sun cream" is not a Sunday task.
  rule(/\b(?:(?:next|on)\s+(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)|(?:next\s+|on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/i, (m, s, today) => {
    const name = (m[1] || m[2]).toLowerCase().slice(0, 3);
    const want = DAYS.findIndex((d) => d.startsWith(name));
    s.date = addDays(today, ((want - today.getUTCDay() + 7) % 7) || 7);
  });
  rule(/\b(\d{4})-(\d{2})-(\d{2})\b/, (m, s) => { s.date = validDate(Number(m[1]), Number(m[2]) - 1, Number(m[3])) || s.date; });
  rule(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/, (m, s, today) => {
    // Indian order: day/month(/year).
    const day = Number(m[1]); const mon = Number(m[2]) - 1;
    if (m[3]) { const y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]); s.date = validDate(y, mon, day) || s.date; } else s.date = nextOccurrence(today, mon, day) || s.date;
  });
  rule(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i, (m, s, today) => {
    s.date = nextOccurrence(today, MONTHS.indexOf(m[2].toLowerCase().slice(0, 3)), Number(m[1])) || s.date;
  });
  rule(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/i, (m, s, today) => {
    s.date = nextOccurrence(today, MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)), Number(m[2])) || s.date;
  });
  rule(/\bnoon\b/i, (m, s) => { s.time = '12:00'; });
  rule(/\bmidnight\b/i, (m, s) => { s.time = '23:59'; });
  rule(/\b(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i, (m, s) => {
    let h = Number(m[1]); const min = Number(m[2] || 0);
    if (h < 1 || h > 12 || min > 59) return false;
    if (m[3].toLowerCase() === 'pm' && h < 12) h += 12;
    if (m[3].toLowerCase() === 'am' && h === 12) h = 0;
    s.time = `${pad(h)}:${pad(min)}`;
  });
  rule(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/, (m, s) => { s.time = `${pad(Number(m[1]))}:${m[2]}`; });
  rule(/\bat\s+(\d{1,2})\b/i, (m, s) => {
    let h = Number(m[1]);
    if (h < 1 || h > 23) return false;
    if (h >= 1 && h <= 7) h += 12; // "at 5" means the afternoon
    s.time = `${pad(h)}:00`;
  });
  rule(/(?:^|\s)!(high|hi|h|1)\b|(?:^|\s)!!!(?=\s|$)|\bp1\b/i, (m, s) => { s.priority = 3; });
  rule(/(?:^|\s)!(medium|med|m|2)\b|(?:^|\s)!!(?=\s|$)|\bp2\b/i, (m, s) => { s.priority = 2; });
  rule(/(?:^|\s)!(low|lo|l|3)\b|\bp3\b/i, (m, s) => { s.priority = 1; });

  /**
   * @param {string} text
   * @param {{ now?: Date|number }} [opts]
   * @returns {{ title: string, due_date: string|null, due_time: string|null, tags: string[], priority: number, list: string|null, recurrence: string|null }}
   */
  function parse(text, opts = {}) {
    const today = istDay(opts.now || Date.now());
    const state = { date: null, time: null, priority: 0, recurrence: null };
    let rest = ` ${String(text || '').replace(/\s+/g, ' ').trim()} `;

    const tags = [];
    rest = rest.replace(/(^|\s)#([\p{L}\p{M}\p{N}_-]{1,40})/gu, (all, sp, tag) => {
      const t = tag.toLowerCase();
      if (!tags.includes(t)) tags.push(t);
      return sp;
    });
    let list = null;
    rest = rest.replace(/(^|\s)@([\p{L}\p{M}\p{N}_-]{1,60})/u, (all, sp, name) => { list = name; return sp; });

    for (const { re, fn } of RULES) {
      const m = re.exec(rest);
      if (!m) continue;
      if (fn(m, state, today) === false) continue;
      rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`;
    }
    // "at 5pm" leaves a dangling "at"; "on 5 Nov" a dangling "on"; "by" too.
    const title = rest.replace(/\s+(?:at|on|by|due)\s*$/i, ' ').replace(/^\s*(?:at|on|by)\s+/i, ' ').replace(/\s+/g, ' ').trim();
    const dueDate = state.date ? iso(state.date) : (state.time || state.recurrence ? iso(today) : null);
    return { title, due_date: dueDate, due_time: state.time, tags, priority: state.priority, list, recurrence: state.recurrence };
  }

  /** The next due date for a repeating task, from its current due date (IST). */
  function nextDue(dueDate, recurrence) {
    if (!dueDate || !recurrence) return null;
    const [y, m, d] = dueDate.split('-').map(Number);
    const cur = new Date(Date.UTC(y, m - 1, d));
    switch (recurrence) {
      case 'daily': return iso(addDays(cur, 1));
      case 'weekdays': { let n = addDays(cur, 1); while (n.getUTCDay() === 0 || n.getUTCDay() === 6) n = addDays(n, 1); return iso(n); }
      case 'weekly': return iso(addDays(cur, 7));
      case 'monthly': { const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return iso(new Date(Date.UTC(y, m, Math.min(d, last)))); }
      case 'yearly': return iso(validDate(y + 1, m - 1, d) || new Date(Date.UTC(y + 1, m - 1, 28)));
      default: return null;
    }
  }

  return { parse, nextDue, istDay: (now) => iso(istDay(now)), RECURRENCES: ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'] };
});
