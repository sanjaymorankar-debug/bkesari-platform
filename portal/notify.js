'use strict';

/* ============================================================
   How the projects send a one-time code by SMS or a link by email.

   Each is off until configured, and each project decides for itself what
   to do without one (project-auth.js: dev and test tiers show the code on
   screen; production says delivery is unavailable and never shows it).

   SMS     SMS_WEBHOOK_URL (+ SMS_WEBHOOK_TOKEN): POST {"to":"+91XXXXXXXXXX","text":"..."}
           with "Authorization: Bearer <token>". Point it at the SMS gateway
           (MSG91, Twilio, Gupshup...) or a small relay in front of one.
   Email   RESEND_API_KEY + MAIL_FROM: https://api.resend.com/emails
           or MAIL_WEBHOOK_URL (+ MAIL_WEBHOOK_TOKEN): POST {"to","subject","text"}.

   A project may use its own: TASKLIST_SMS_WEBHOOK_URL beats SMS_WEBHOOK_URL
   for TaskList, HUB_MAIL_FROM beats MAIL_FROM for the hub, and so on.
   ============================================================ */

function pick(env, prefix, name) {
  return env[`${prefix}_${name}`] || env[name] || '';
}

async function post(url, token, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`provider answered ${r.status}`);
  return true;
}

/** { sms?, mail? } for one project; a missing provider is left out. */
function createNotifier(prefix, env = process.env) {
  const out = {};
  const smsUrl = pick(env, prefix, 'SMS_WEBHOOK_URL');
  if (smsUrl) out.sms = (to, text) => post(smsUrl, pick(env, prefix, 'SMS_WEBHOOK_TOKEN'), { to: `+91${to}`, text });
  const resend = pick(env, prefix, 'RESEND_API_KEY');
  const from = pick(env, prefix, 'MAIL_FROM');
  const mailUrl = pick(env, prefix, 'MAIL_WEBHOOK_URL');
  if (resend && from) out.mail = (to, subject, text) => post('https://api.resend.com/emails', resend, { from, to: [to], subject, text });
  else if (mailUrl) out.mail = (to, subject, text) => post(mailUrl, pick(env, prefix, 'MAIL_WEBHOOK_TOKEN'), { to, subject, text });
  return out;
}

module.exports = { createNotifier };
