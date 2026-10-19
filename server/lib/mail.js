'use strict';
/*
 * Outgoing email. Every message is written to the outbox table (Admin panel → Emails).
 * It is sent when SMTP is configured (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM);
 * otherwise it stays in the outbox marked "not sent" so nothing is lost.
 */
const clock = require('./clock');

let transport;
function getTransport() {
  if (transport !== undefined) return transport;
  transport = null;
  if (process.env.SMTP_HOST) {
    const nodemailer = require('nodemailer');
    const port = Number(process.env.SMTP_PORT || 587);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: process.env.SMTP_SECURE ? /^(1|true)$/i.test(process.env.SMTP_SECURE) : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
    });
  }
  return transport;
}

const configured = () => Boolean(getTransport());

/* Queues one plain-text email. Returns the outbox id. */
function send(db, settings, { to, subject, text }) {
  const t = getTransport();
  const stamp = clock.stamp(settings.timezone);
  const { id } = db.get('INSERT INTO outbox (to_address, subject, body, status, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
    String(to).slice(0, 200), String(subject).slice(0, 200), String(text), t ? 'queued' : 'logged', stamp);
  if (t) {
    const from = process.env.MAIL_FROM || (settings.hotel_email ? `${settings.hotel_name} <${settings.hotel_email}>` : `no-reply@${require('node:os').hostname()}`);
    t.sendMail({ from, to, subject, text })
      .then(() => db.run("UPDATE outbox SET status = 'sent', sent_at = ? WHERE id = ?", clock.stamp(settings.timezone), id))
      .catch((error) => db.run("UPDATE outbox SET status = 'failed', error = ? WHERE id = ?", String(error.message).slice(0, 300), id));
  }
  return id;
}

module.exports = { send, configured };
