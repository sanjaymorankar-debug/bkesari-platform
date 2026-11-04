'use strict';

/* ============================================================
   How the projects send a one-time code or a link by email, or a code by SMS.

   Each is off until configured, and each project decides for itself what
   to do without one (project-auth.js: only the dev tier shows the code on
   screen; test and production say delivery is unavailable and never show it).

   Email   SMTP, the default (Hostinger email, decision D-029). The same names
           every bkesari app reads, Education's Laravel included:
             MAIL_HOST          smtp.hostinger.com
             MAIL_PORT          465 (TLS from the start) or 587 (STARTTLS)
             MAIL_USERNAME      the mailbox, e.g. no-reply@bkesari.com
             MAIL_PASSWORD      its password
             MAIL_FROM_ADDRESS  the sender address (default: MAIL_USERNAME)
             MAIL_FROM_NAME     the sender name (default: the project's)
           Or RESEND_API_KEY + MAIL_FROM (https://api.resend.com/emails), or
           MAIL_WEBHOOK_URL (+ MAIL_WEBHOOK_TOKEN): POST {"to","subject","text"}.
   SMS     On hold (D-029). SMS_WEBHOOK_URL (+ SMS_WEBHOOK_TOKEN):
           POST {"to":"+91XXXXXXXXXX","text":"..."} with "Authorization: Bearer <token>".

   A project may use its own: TASKLIST_MAIL_FROM_NAME beats MAIL_FROM_NAME for
   TaskList, HUB_MAIL_HOST beats MAIL_HOST for the hub, and so on.
   ============================================================ */

const nodemailer = require('nodemailer');

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

/** The SMTP settings for one project, or null when MAIL_HOST is not set. */
function smtpSettings(env, prefix, defaultName) {
  const host = pick(env, prefix, 'MAIL_HOST');
  if (!host) return null;
  const port = Number(pick(env, prefix, 'MAIL_PORT') || 465);
  const user = pick(env, prefix, 'MAIL_USERNAME');
  const address = pick(env, prefix, 'MAIL_FROM_ADDRESS') || user;
  const fromName = pick(env, prefix, 'MAIL_FROM_NAME') || defaultName;
  const scheme = pick(env, prefix, 'MAIL_SCHEME').toLowerCase();
  return {
    transport: {
      host,
      port,
      // 465 is TLS from the first byte; 587 upgrades with STARTTLS, which is then required.
      secure: scheme ? scheme === 'smtps' : port === 465,
      requireTLS: port !== 465,
      auth: user ? { user, pass: pick(env, prefix, 'MAIL_PASSWORD') } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    },
    from: { name: fromName, address },
  };
}

/**
 * { sms?, mail? } for one project; a missing provider is left out.
 * `options.fromName` is the sender name when MAIL_FROM_NAME is not set;
 * `options.transport` replaces the SMTP transport (tests).
 */
function createNotifier(prefix, env = process.env, options = {}) {
  const out = {};
  const smsUrl = pick(env, prefix, 'SMS_WEBHOOK_URL');
  if (smsUrl) out.sms = (to, text) => post(smsUrl, pick(env, prefix, 'SMS_WEBHOOK_TOKEN'), { to: `+91${to}`, text });

  const smtp = smtpSettings(env, prefix, options.fromName || 'bkesari');
  const resend = pick(env, prefix, 'RESEND_API_KEY');
  const from = pick(env, prefix, 'MAIL_FROM');
  const mailUrl = pick(env, prefix, 'MAIL_WEBHOOK_URL');
  if (smtp && smtp.from.address) {
    let transporter = null;
    out.mail = async (to, subject, text) => {
      transporter = transporter || options.transport || nodemailer.createTransport(smtp.transport);
      await transporter.sendMail({ from: smtp.from, to, subject, text });
      return true;
    };
  } else if (resend && from) out.mail = (to, subject, text) => post('https://api.resend.com/emails', resend, { from, to: [to], subject, text });
  else if (mailUrl) out.mail = (to, subject, text) => post(mailUrl, pick(env, prefix, 'MAIL_WEBHOOK_TOKEN'), { to, subject, text });
  return out;
}

module.exports = { createNotifier, smtpSettings };
