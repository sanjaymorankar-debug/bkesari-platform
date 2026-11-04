/**
 * TaskList's quick add (portal/public/tasklist/quickadd.js): one line in, a
 * task out, with dates as IST calendar days. Fixed "now": Tuesday 3 Nov 2026,
 * 08:42 AM IST.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const q = require('../portal/public/tasklist/quickadd.js');

const now = new Date('2026-11-03T03:12:00Z');
const p = (text) => q.parse(text, { now });

test('the owner\'s example: "Call vendor tomorrow 5pm #gokesari"', () => {
  assert.deepEqual(p('Call vendor tomorrow 5pm #gokesari'), {
    title: 'Call vendor', due_date: '2026-11-04', due_time: '17:00', tags: ['gokesari'], priority: 0, list: null, recurrence: null,
  });
});

test('dates: words, weekdays, offsets and written dates, in Indian day/month order', () => {
  assert.equal(p('x today').due_date, '2026-11-03');
  assert.equal(p('x day after tomorrow').due_date, '2026-11-05');
  assert.equal(p('x friday').due_date, '2026-11-06');
  assert.equal(p('x next monday').due_date, '2026-11-09');
  assert.equal(p('x tuesday').due_date, '2026-11-10', 'today\'s weekday means next week');
  assert.equal(p('x on fri').due_date, '2026-11-06');
  assert.equal(p('x in 3 days').due_date, '2026-11-06');
  assert.equal(p('x in 2 weeks').due_date, '2026-11-17');
  assert.equal(p('x 5/12').due_date, '2026-12-05', 'day first');
  assert.equal(p('x 15/11/2026').due_date, '2026-11-15');
  assert.equal(p('x 2026-12-01').due_date, '2026-12-01');
  assert.equal(p('x 5 nov').due_date, '2026-11-05');
  assert.equal(p('x Jan 26').due_date, '2027-01-26', 'the next 26 Jan');
  assert.equal(p('Report 2 Nov').due_date, '2026-11-02', 'a date just gone is overdue, not next year');
  assert.equal(p('x 31/2').due_date, null, 'no such date');
});

test('times: 12-hour, 24-hour, "at 5" in the afternoon, noon', () => {
  assert.equal(p('x 5pm').due_time, '17:00');
  assert.equal(p('x 5:30 pm').due_time, '17:30');
  assert.equal(p('x 12am').due_time, '00:00');
  assert.equal(p('x 17:45').due_time, '17:45');
  assert.equal(p('x at 5').due_time, '17:00');
  assert.equal(p('x at 9').due_time, '09:00');
  assert.equal(p('x noon').due_time, '12:00');
  assert.equal(p('x tonight').due_time, '20:00');
  assert.equal(p('x 5pm').due_date, '2026-11-03', 'a time alone is today');
});

test('tags, list, priority and repeat come out of the title', () => {
  const r = p('Pay rent #home #Bills @Home-Budget !high every month');
  assert.equal(r.title, 'Pay rent');
  assert.deepEqual(r.tags, ['home', 'bills']);
  assert.equal(r.list, 'Home-Budget');
  assert.equal(r.priority, 3);
  assert.equal(r.recurrence, 'monthly');
  assert.equal(r.due_date, '2026-11-03', 'a repeating task starts today');
  assert.equal(p('x p2').priority, 2);
  assert.equal(p('x !low').priority, 1);
  assert.equal(p('Standup every weekday at 9:30am').recurrence, 'weekdays');
  assert.equal(p('Gym every monday').recurrence, 'weekly');
  assert.equal(p('Gym every monday').due_date, '2026-11-09');
});

test('Marathi and Hindi day words work, and Devanagari tags', () => {
  assert.deepEqual(p('उद्या दूध आणा #घर'), { title: 'दूध आणा', due_date: '2026-11-04', due_time: null, tags: ['घर'], priority: 0, list: null, recurrence: null });
  assert.equal(p('कल बैंक जाना 11am').due_date, '2026-11-04');
  assert.equal(p('आज औषध').due_date, '2026-11-03');
  assert.equal(p('परवा बाजार').due_date, '2026-11-05');
  assert.equal(p('नई कलम खरीदना').due_date, null, 'कल inside a word is not "tomorrow"');
});

test('ordinary words are left alone', () => {
  assert.equal(p('Buy sun cream').title, 'Buy sun cream');
  assert.equal(p('Buy sun cream').due_date, null);
  assert.equal(p('Monitor the wedding hall').due_date, null);
  assert.equal(p('Read chapter 5.30 notes').due_date, null);
  assert.equal(p('  ').title, '');
});

test('the next due date of a repeating task', () => {
  assert.equal(q.nextDue('2026-11-06', 'weekdays'), '2026-11-09');
  assert.equal(q.nextDue('2026-11-03', 'daily'), '2026-11-04');
  assert.equal(q.nextDue('2026-11-03', 'weekly'), '2026-11-10');
  assert.equal(q.nextDue('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(q.nextDue('2028-02-29', 'yearly'), '2029-02-28');
  assert.equal(q.nextDue(null, 'daily'), null);
  assert.equal(q.istDay(new Date('2026-11-02T19:00:00Z')), '2026-11-03', 'IST, not UTC');
});
