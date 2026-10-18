'use strict';
/* Payments (with refunds) and invoices (GST-ready for India). */
const f = require('../lib/format');
const clock = require('../lib/clock');
const activity = require('../lib/activity');
const pricing = require('../lib/pricing');
const { Form } = require('../lib/forms');
const settingsService = require('./settings');
const reservations = require('./reservations');

const METHODS = ['Card', 'Cash', 'UPI', 'Bank transfer'];
const actor = (req) => (req.user ? { id: req.user.id, name: req.user.name } : { id: null, name: 'Website' });

function payments(db, reservationId) {
  return db.all('SELECT * FROM payments WHERE reservation_id = ? ORDER BY created_at, id', reservationId)
    .map((p) => ({ ...p, amountText: f.money(p.amount_cents), when: `${f.formatDay(p.created_at)} ${f.clock(p.created_at)}` }));
}

/* Adds one payment row and keeps reservations.paid_cents in step. */
function record(db, req, booking, amount, method, reference) {
  const who = actor(req);
  db.run('INSERT INTO payments (reservation_id, amount_cents, method, reference, taken_by, taken_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    booking.id, amount, method, reference || '', who.id, who.name, clock.stamp(req.settings && req.settings.timezone));
  db.run('UPDATE reservations SET paid_cents = paid_cents + ?, updated_at = ? WHERE id = ?', amount, clock.stamp(req.settings && req.settings.timezone), booking.id);
}

function addPayment(db, req, confirmation, body) {
  const r = reservations.requireBooking(db, confirmation);
  const form = new Form(body);
  const amount = form.money('amount', { label: 'Amount', min: 0.01, max: 10000000 });
  const method = form.oneOf('method', METHODS, { label: 'Payment method' });
  const reference = form.text('reference', { label: 'Reference', max: 60 });
  const owing = r.total_cents - r.paid_cents;
  if (amount && amount > owing) form.fail('amount', `That is more than the ${f.money(Math.max(owing, 0))} still open.`);
  if (!form.ok) throw new reservations.FormError(form.errors, form.values);
  db.tx(() => record(db, req, r, amount, method, reference));
  activity.log(db, req, 'payment.add', `Payment of ${f.money(amount)} (${method}${reference ? `, ${reference}` : ''}) on ${r.confirmation} for ${r.name}`);
  return reservations.byConfirmation(db, confirmation);
}

function refund(db, req, confirmation, body) {
  const r = reservations.requireBooking(db, confirmation);
  const form = new Form(body);
  const amount = form.money('refund_amount', { label: 'Refund', min: 0.01, max: 10000000 });
  const method = form.oneOf('refund_method', METHODS, { label: 'Refund method' });
  const reason = form.text('refund_reason', { label: 'Reason', max: 80, required: true });
  if (amount && amount > r.paid_cents) form.fail('refund_amount', `Only ${f.money(r.paid_cents)} has been paid.`);
  if (!form.ok) throw new reservations.FormError(form.errors, form.values);
  db.tx(() => record(db, req, r, -amount, method, `Refund: ${reason}`));
  activity.log(db, req, 'payment.refund', `Refund of ${f.money(amount)} (${method}) on ${r.confirmation}: ${reason}`);
  return reservations.byConfirmation(db, confirmation);
}

/* ---------------------------------------------------------------- invoices */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ''));
const three = (n) => [Math.floor(n / 100) ? `${ONES[Math.floor(n / 100)]} Hundred` : '', n % 100 ? two(n % 100) : ''].filter(Boolean).join(' ');
/* 1234567 -> "Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven" */
function indianWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 1e7);
  const lakh = Math.floor((n % 1e7) / 1e5);
  const thousand = Math.floor((n % 1e5) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (rest) parts.push(three(rest));
  return parts.join(' ');
}
/* 1234567 -> "One Million Two Hundred Thirty-Four Thousand Five Hundred Sixty-Seven" */
function internationalWords(n) {
  if (n === 0) return 'Zero';
  const units = ['', ' Thousand', ' Million', ' Billion'];
  const parts = [];
  for (let i = 0; n > 0; i++, n = Math.floor(n / 1000)) if (n % 1000) parts.unshift(three(n % 1000) + units[i]);
  return parts.join(' ');
}
function amountInWords(cents, settings) {
  const whole = Math.floor(Math.abs(cents) / 100);
  const fraction = Math.abs(cents) % 100;
  if (settings.currency_code === 'INR') return `Rupees ${indianWords(whole)}${fraction ? ` and ${two(fraction)} Paise` : ''} Only`;
  const name = { USD: 'US Dollars', EUR: 'Euros', GBP: 'Pounds Sterling', AED: 'UAE Dirhams' }[settings.currency_code] || settings.currency_code;
  return `${name} ${internationalWords(whole)} and ${String(fraction).padStart(2, '0')}/100 Only`;
}

const isGst = (settings) => settings.tax_mode === 'gst_india';
/* India's financial year runs April to March: 2026-09-24 -> "26-27". */
function fiscalYear(date, indian) {
  const y = Number(date.slice(0, 4));
  if (!indian) return String(y);
  const start = Number(date.slice(5, 7)) >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}
function nextNumber(db, settings, date) {
  const indian = settings.country === 'IN' || isGst(settings);
  const fy = fiscalYear(date, indian);
  const prefix = String(settings.invoice_prefix || settings.confirmation_prefix || 'INV').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6) || 'INV';
  const counters = { ...(settings.invoice_counters || {}) };
  let n = counters[fy] || 0;
  let number;
  do {
    n += 1;
    number = `${prefix}/${fy}/${String(n).padStart(4, '0')}`;
  } while (db.get('SELECT 1 FROM invoices WHERE number = ?', number));
  counters[fy] = n;
  settingsService.save(db, { invoice_counters: counters });
  return number;
}

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function createInvoice(db, req, confirmation, body) {
  const settings = settingsService.all(db);
  const r = reservations.requireBooking(db, confirmation);
  if (!['checked_in', 'checked_out'].includes(r.status)) throw new reservations.BookingError('An invoice can be made once the guest has checked in.');
  const form = new Form(body);
  const billTo = form.text('bill_to', { label: 'Bill to', max: 100 }) || r.name;
  const gstin = (form.text('gstin', { label: 'GSTIN', max: 15 }) || '').toUpperCase();
  if (gstin && !GSTIN.test(gstin)) form.fail('gstin', 'A GSTIN has 15 characters, e.g. 19ABCDE1234F1Z5.');
  const interstate = form.bool('interstate');
  if (!form.ok) throw new reservations.FormError(form.errors, form.values);

  const guest = db.get('SELECT * FROM guests WHERE id = ?', r.guest_id);
  const extras = db.all('SELECT x.name, x.per, re.amount_cents FROM reservation_extras re JOIN extras x ON x.id = re.extra_id WHERE re.reservation_id = ?', r.id);
  const gst = isGst(settings);
  const percent = pricing.taxPercent(settings, r.nightly_rate_cents);
  const tax = r.tax_cents;
  const cgst = gst && !interstate ? Math.floor(tax / 2) : 0;
  const bd = settingsService.businessDate(db);
  const stamp = clock.stamp(settings.timezone);

  return db.tx(() => {
    const number = nextNumber(db, settings, bd);
    const data = {
      number, date: bd, gst, interstate, percent, taxLabel: gst ? 'GST' : settings.tax_label,
      currency: { code: settings.currency_code, symbol: settings.currency_symbol, locale: settings.currency_locale },
      hotel: { name: settings.hotel_name, address: settings.hotel_address, city: settings.hotel_city, phone: settings.hotel_phone, email: settings.hotel_email, taxId: settings.tax_id, state: settings.hotel_state || '' },
      billTo: { name: billTo, gstin, address: guest.address || '', company: guest.company || '' },
      guest: { name: r.name, email: r.email || '', phone: r.phone || '' },
      stay: { confirmation: r.confirmation, room: r.room_number || '', type: r.type_name, arrival: r.arrival, departure: r.departure, nights: r.nights, guests: f.guestCount(r.adults, r.children, ', '), plan: r.plan_name || '' },
      lines: [
        { text: `Room ${r.room_number || ''} · ${r.type_name} · ${f.plural(r.nights, 'night', 'nights')} × ${f.money(r.nightly_rate_cents)}`.replace('Room  · ', 'Room · '), sac: gst ? '996311' : '', amount: r.room_total_cents, taxed: true },
        ...extras.map((x) => ({ text: x.name + (x.per === 'night' ? ` · ${f.plural(r.nights, 'night', 'nights')}` : ''), sac: '', amount: x.amount_cents, taxed: false })),
      ],
      taxable: r.room_total_cents, tax, cgst, sgst: gst && !interstate ? tax - cgst : 0, igst: gst && interstate ? tax : 0,
      total: r.total_cents, paid: r.paid_cents, balance: r.total_cents - r.paid_cents,
      payments: payments(db, r.id).map((p) => ({ when: p.when, method: p.method, reference: p.reference, amount: p.amount_cents })),
      words: amountInWords(r.total_cents, settings),
    };
    db.run("UPDATE invoices SET status = 'cancelled', cancelled_at = ? WHERE reservation_id = ? AND status = 'issued'", stamp, r.id);
    const { id } = db.get('INSERT INTO invoices (number, reservation_id, issued_at, issued_by, data, total_cents) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
      number, r.id, stamp, req.user.id, JSON.stringify(data), r.total_cents);
    activity.log(db, req, 'invoice.issue', `Invoice ${number} for ${r.confirmation} (${f.money(r.total_cents)})`);
    return id;
  });
}

function invoice(db, id) {
  const row = db.get('SELECT i.*, u.name AS issued_by_name FROM invoices i LEFT JOIN users u ON u.id = i.issued_by WHERE i.id = ?', id);
  return row ? { ...row, data: JSON.parse(row.data) } : null;
}

function forReservation(db, reservationId) {
  return db.all('SELECT id, number, status, issued_at, total_cents FROM invoices WHERE reservation_id = ? ORDER BY id DESC', reservationId);
}

module.exports = { METHODS, payments, record, addPayment, refund, createInvoice, invoice, forReservation, amountInWords, fiscalYear, indianWords, internationalWords };
