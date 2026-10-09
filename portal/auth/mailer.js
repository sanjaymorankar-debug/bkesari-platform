/**
 * Sends the service's few emails: verification and password reset.
 *
 * With SMTP configured it uses nodemailer. Without it, on dev only, the
 * message (with its link) goes to the console so a developer can follow it;
 * on test and production nothing is printed, because a reset link in a log is
 * a password in a log.
 *
 * Every sent message is also kept in `outbox` (last 50) for tests.
 */
function createMailer(config, { log = console } = {}) {
  const outbox = [];
  let transport = null;
  if (config.smtp) {
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
    });
  }

  async function send({ to, subject, text }) {
    outbox.push({ to, subject, text, at: new Date().toISOString() });
    if (outbox.length > 50) outbox.shift();
    if (transport) {
      try {
        await transport.sendMail({ from: config.smtp.from, to, subject, text });
      } catch (err) {
        log.error(`auth mail to ${to} failed: ${err.message}`);
      }
      return;
    }
    if (config.tier === 'dev') log.log(`[auth mail, not sent: no SMTP] to=${to} subject=${subject}\n${text}`);
  }

  return { send, outbox };
}

module.exports = { createMailer };
