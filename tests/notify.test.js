'use strict';
/* portal/notify.js: which provider sends a project's email, with which settings. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotifier, smtpSettings } = require('../portal/notify.js');

const HOSTINGER = {
  MAIL_HOST: 'smtp.hostinger.com', MAIL_PORT: '465',
  MAIL_USERNAME: 'no-reply@bkesari.com', MAIL_PASSWORD: 'mailbox-secret',
};

test('Hostinger SMTP on 465: TLS from the start, the mailbox as sender, the project name shown', () => {
  const s = smtpSettings(HOSTINGER, 'TASKLIST', 'TaskList · bkesari');
  assert.equal(s.transport.host, 'smtp.hostinger.com');
  assert.equal(s.transport.port, 465);
  assert.equal(s.transport.secure, true);
  assert.deepEqual(s.transport.auth, { user: 'no-reply@bkesari.com', pass: 'mailbox-secret' });
  assert.deepEqual(s.from, { name: 'TaskList · bkesari', address: 'no-reply@bkesari.com' });
});

test('587 upgrades with STARTTLS and requires it; sender and name can be set, per project too', () => {
  const env = { ...HOSTINGER, MAIL_PORT: '587', MAIL_FROM_ADDRESS: 'hello@bkesari.com', MAIL_FROM_NAME: 'bkesari', TASKLIST_MAIL_FROM_NAME: 'TaskList' };
  const tl = smtpSettings(env, 'TASKLIST', 'x');
  assert.equal(tl.transport.secure, false);
  assert.equal(tl.transport.requireTLS, true);
  assert.deepEqual(tl.from, { name: 'TaskList', address: 'hello@bkesari.com' });
  assert.equal(smtpSettings(env, 'HUB', 'x').from.name, 'bkesari');
  assert.equal(smtpSettings({}, 'HUB', 'x'), null, 'no MAIL_HOST, no SMTP');
});

test('SMTP is used when MAIL_HOST is set, ahead of Resend and the webhook; the message carries the code as sent', async () => {
  const sentMail = [];
  const transport = { sendMail: async (m) => { sentMail.push(m); return { messageId: '1' }; } };
  const n = createNotifier('TASKLIST', { ...HOSTINGER, RESEND_API_KEY: 'x', MAIL_FROM: 'a@b.co', MAIL_WEBHOOK_URL: 'https://example.invalid' }, { fromName: 'TaskList · bkesari', transport });
  assert.equal(typeof n.mail, 'function');
  assert.equal(n.sms, undefined, 'SMS is on hold: no provider, no sms()');
  assert.equal(await n.mail('kavya@example.com', '123456 is your TaskList code', 'Your TaskList code is 123456'), true);
  assert.deepEqual(sentMail, [{
    from: { name: 'TaskList · bkesari', address: 'no-reply@bkesari.com' },
    to: 'kavya@example.com', subject: '123456 is your TaskList code', text: 'Your TaskList code is 123456',
  }]);
});

test('a failed send rejects, so the caller can say it could not be sent', async () => {
  const transport = { sendMail: async () => { throw new Error('535 authentication failed'); } };
  const n = createNotifier('HUB', HOSTINGER, { transport });
  await assert.rejects(n.mail('a@b.co', 's', 't'), /535/);
});

test('nothing configured: no mail() and no sms()', () => {
  assert.deepEqual(createNotifier('HUB', {}), {});
});

test('the names set on the servers work too: SMTP_USER and SMTP_PASSWORD alone mean Hostinger on 465 (D-034)', () => {
  const s = smtpSettings({ SMTP_USER: 'code@agtci.com', SMTP_PASSWORD: 'mailbox-secret' }, 'TASKLIST', 'TaskList · bkesari');
  assert.equal(s.transport.host, 'smtp.hostinger.com');
  assert.equal(s.transport.port, 465);
  assert.equal(s.transport.secure, true);
  assert.deepEqual(s.transport.auth, { user: 'code@agtci.com', pass: 'mailbox-secret' });
  assert.deepEqual(s.from, { name: 'TaskList · bkesari', address: 'code@agtci.com' });
  // MAIL_* wins when both are set; SMTP_HOST / SMTP_PORT are read as well.
  const both = smtpSettings({ MAIL_USERNAME: 'a@b.co', MAIL_PASSWORD: 'p1', SMTP_USER: 'c@d.co', SMTP_PASSWORD: 'p2', SMTP_HOST: 'mail.example.com', SMTP_PORT: '587' }, 'HUB', 'bkesari');
  assert.deepEqual([both.transport.host, both.transport.port, both.transport.auth.user, both.transport.auth.pass], ['mail.example.com', 587, 'a@b.co', 'p1']);
  assert.equal(typeof createNotifier('HUB', { SMTP_USER: 'code@agtci.com', SMTP_PASSWORD: 'x' }).mail, 'function');
});
