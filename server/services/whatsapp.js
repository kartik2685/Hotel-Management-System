'use strict';
/* Messages to a guest on WhatsApp. Staff press a button and WhatsApp (the app, or WhatsApp Web) opens with
   the guest's number and the text filled in, to check and send. These are wa.me links: no WhatsApp
   Business account is needed and the server sends nothing. */
const f = require('../lib/format');

/* Country codes for numbers typed without one, for hotels where ten-digit numbers are the norm. */
const NATIONAL = { IN: '91', US: '1', CA: '1' };

/* The number as wa.me wants it: country code and digits only. '' when the country can't be known, and
   WhatsApp then asks whom to send the message to. */
function phoneDigits(phone, country = 'IN') {
  const raw = String(phone || '').trim();
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.startsWith('+')) return digits.length >= 8 ? digits : '';
  if (digits.startsWith('00')) return digits.length >= 10 ? digits.slice(2) : '';
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1); // 098300… dialled with a trunk 0
  if (digits.length === 10 && NATIONAL[country]) return NATIONAL[country] + digits;
  return '';
}

const link = (digits, text) => `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;

/* Lines into one message, without empty lines at the ends or two in a row. */
const join = (lines) => lines.filter((line, i, all) => line !== null && line !== undefined && !(line === '' && (i === 0 || all[i - 1] === ''))).join('\n').trim();

/* What to tell the guest about this booking now; '' when there is nothing to send (a no-show). */
function bookingText(s, b, { manageUrl = '', invoice = null, feedbackUrl = '' } = {}) {
  const room = `${b.type_name}${b.room_number ? `, room ${b.room_number}` : ''}`;
  const stay = `${f.formatDay(b.arrival)} → ${f.formatDay(b.departure)} · ${f.plural(b.nights, 'night', 'nights')} · ${f.guestCount(b.adults, b.children, ', ')}`;
  const call = s.hotel_phone ? `call us on ${s.hotel_phone}` : 'reply here';
  if (b.status === 'confirmed' || b.status === 'tentative') {
    return join([
      b.status === 'confirmed' ? `Hello ${b.first_name}, your booking at ${s.hotel_name} is confirmed.` : `Hello ${b.first_name}, here are the details of your booking at ${s.hotel_name} (not confirmed yet).`,
      '',
      `Booking: ${b.confirmation}`,
      room,
      stay,
      `Total: ${f.money(b.total_cents)}${b.paid_cents > 0 ? ` (paid ${f.money(b.paid_cents)})` : ''}`,
      `Check-in from ${s.check_in_time} · check-out by ${s.check_out_time}`,
      manageUrl ? `See or cancel your booking: ${manageUrl}` : '',
      '',
      [s.hotel_address, s.hotel_phone].filter(Boolean).join(' · '),
    ]);
  }
  if (b.status === 'checked_in') {
    return join([
      `Welcome to ${s.hotel_name}, ${b.first_name}! Your room is ${b.room_number || 'ready'} (${b.type_name}).`,
      `Check-out is by ${s.check_out_time} on ${f.formatDay(b.departure)}.`,
      `For anything you need, ${s.hotel_phone ? `call reception on ${s.hotel_phone}` : 'reply here'}.`,
    ]);
  }
  if (b.status === 'checked_out') {
    return join([
      `Thank you for staying at ${s.hotel_name}, ${b.first_name}. We hope to welcome you again.`,
      invoice ? `Your invoice ${invoice.number} (${f.money(invoice.total_cents)}): ${invoice.url}` : '',
      feedbackUrl ? `How was your stay? Tell us in thirty seconds: ${feedbackUrl}` : '',
    ]);
  }
  if (b.status === 'cancelled') {
    return join([
      `Hello ${b.first_name}, your booking ${b.confirmation} at ${s.hotel_name} (${f.formatDay(b.arrival)} → ${f.formatDay(b.departure)}) has been cancelled.`,
      `If this is a mistake, ${call}.`,
    ]);
  }
  return '';
}

/* The guest's copy of an invoice. */
function invoiceText(s, firstName, inv, url) {
  return join([
    `Hello ${firstName}, here is your invoice ${inv.number} from ${s.hotel_name} for ${f.money(inv.total_cents)}.`,
    `See it, print it or save it as a PDF: ${url}`,
  ]);
}

module.exports = { phoneDigits, link, bookingText, invoiceText };
