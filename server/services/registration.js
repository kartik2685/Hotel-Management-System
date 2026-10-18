'use strict';
/*
 * Guest registration card (GRC) and Form III for foreign guests (India).
 * Form III (formerly Form C) must reach the FRRO within 24 hours of a foreign guest's check-in
 * and again within 24 hours of check-out. Citizens of Nepal and Bhutan are exempt.
 */
const f = require('../lib/format');
const clock = require('../lib/clock');
const activity = require('../lib/activity');
const { Form } = require('../lib/forms');
const settingsService = require('./settings');
const reservations = require('./reservations');

const CODES = ('AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO '
  + 'EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HK HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KW KG LA LV LB LS LR LY LI LT LU MO MG '
  + 'MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG KP MK NO OM PK PW PS PA PG PY PE PH PL PT PR QA RO RU RW KN LC VC WS SM ST SA SN RS SC '
  + 'SL SG SK SI SB SO ZA KR SS ES LK SD SR SE CH SY TW TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VA VE VN YE ZM ZW').split(' ');
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const COUNTRIES = CODES.map((code) => ({ code, name: regionNames.of(code) })).sort((a, b) => a.name.localeCompare(b.name));
const countryName = (code) => (code ? regionNames.of(code) || code : '');
const FORM3_EXEMPT = new Set(['IN', 'NP', 'BT']);
const ID_TYPES = ['Aadhaar card', 'Passport', 'Driving licence', 'Voter ID', 'PAN card', 'Other government ID'];
const VISA_TYPES = ['Tourist visa', 'e-Visa', 'Business visa', 'Employment visa', 'Medical visa', 'Student visa', 'OCI card', 'Other'];
const PURPOSES = ['Leisure', 'Business', 'Conference or event', 'Medical', 'Visiting family or friends', 'Other'];

const isForeign = (nationality) => Boolean(nationality) && nationality !== 'IN';
const needsForm3 = (settings, nationality) => settings.country === 'IN' && Boolean(nationality) && !FORM3_EXEMPT.has(nationality);
/* "XXXX XXXX 1234" style masking for screens that do not need the full number. */
const mask = (value) => (value ? `•••• ${String(value).slice(-4)}` : '');

/* What is still missing before the registration card counts as complete. */
function missing(guest, booking) {
  const gaps = [];
  if (!guest.nationality) gaps.push('nationality');
  if (!guest.address) gaps.push('address');
  if (isForeign(guest.nationality)) {
    if (!guest.passport_number) gaps.push('passport number');
    if (!FORM3_EXEMPT.has(guest.nationality) && !guest.visa_number) gaps.push('visa or OCI number');
  } else if (!guest.id_type || !guest.id_number) gaps.push('ID proof');
  if (!booking.purpose) gaps.push('purpose of visit');
  return gaps;
}

function saveGrc(db, req, confirmation, body) {
  const settings = settingsService.all(db);
  const r = reservations.requireBooking(db, confirmation);
  const form = new Form(body);
  const v = {
    nationality: form.oneOf('nationality', CODES, { label: 'Nationality', required: false }),
    dob: form.date('date_of_birth', { label: 'Date of birth', required: false }),
    address: form.longText('address', { label: 'Address', max: 300 }),
    idType: form.oneOf('id_type', ID_TYPES, { label: 'ID type', required: false }),
    idNumber: form.text('id_number', { label: 'ID number', max: 40 }),
    passport: form.text('passport_number', { label: 'Passport number', max: 20 }),
    visaNumber: form.text('visa_number', { label: 'Visa number', max: 30 }),
    visaType: form.oneOf('visa_type', VISA_TYPES, { label: 'Visa type', required: false }),
    visaUntil: form.date('visa_valid_until', { label: 'Visa valid until', required: false }),
    arrivedIndia: form.date('arrived_in_india', { label: 'Arrived in India', required: false }),
    port: form.text('port_of_arrival', { label: 'Port of arrival', max: 60 }),
    purpose: form.oneOf('purpose', PURPOSES, { label: 'Purpose of visit', required: false }),
    from: form.text('arriving_from', { label: 'Arriving from', max: 80 }),
    to: form.text('going_to', { label: 'Going to', max: 80 }),
  };
  if (v.idType === 'Aadhaar card' && v.idNumber && !/^\d{4}\s?\d{4}\s?\d{4}$/.test(v.idNumber)) form.fail('id_number', 'An Aadhaar number has 12 digits.');
  if (v.dob && v.dob > clock.hotelNow(settings.timezone).date) form.fail('date_of_birth', 'The date of birth is in the future.');
  if (!form.ok) throw new reservations.FormError(form.errors, form.values);
  const stamp = clock.stamp(settings.timezone);
  const guest = {
    nationality: v.nationality, address: v.address, id_type: v.idType, id_number: v.idNumber, passport_number: v.passport, visa_number: v.visaNumber,
  };
  const complete = missing(guest, { purpose: v.purpose }).length === 0;
  db.tx(() => {
    db.run(`UPDATE guests SET nationality = ?, date_of_birth = ?, address = ?, id_type = ?, id_number = ?, passport_number = ?, visa_number = ?, visa_type = ?,
              visa_valid_until = ?, arrived_in_india = ?, port_of_arrival = ?, updated_at = ? WHERE id = ?`,
    v.nationality || null, v.dob || null, v.address || null, v.idType || null, v.idNumber || null, v.passport || null, v.visaNumber || null, v.visaType || null,
    v.visaUntil || null, v.arrivedIndia || null, v.port || null, stamp, r.guest_id);
    db.run('UPDATE reservations SET purpose = ?, arriving_from = ?, going_to = ?, grc_at = ?, grc_by = ?, updated_at = ? WHERE id = ?',
      v.purpose || null, v.from || null, v.to || null, complete ? r.grc_at || stamp : null, complete ? r.grc_by || req.user.id : null, stamp, r.id);
  });
  activity.log(db, req, 'grc.save', `Registration card ${complete ? 'completed' : 'updated'} for ${r.name} (${r.confirmation})`);
  return complete;
}

/* Form III state for one booking, or null when it does not apply. */
function form3(settings, booking, guest, now) {
  if (!needsForm3(settings, guest.nationality)) return null;
  const due = (stamp) => (stamp ? addHours(stamp, 24) : null);
  const item = (base, ref, at) => ({ due: due(base), done: Boolean(ref), ref, at, overdue: Boolean(base) && !ref && due(base) < now });
  return {
    arrival: booking.checked_in_at ? item(booking.checked_in_at, booking.form3_arrival_ref, booking.form3_arrival_at) : null,
    departure: booking.checked_out_at ? item(booking.checked_out_at, booking.form3_departure_ref, booking.form3_departure_at) : null,
  };
}
function addHours(stamp, hours) {
  const t = new Date(stamp.replace(' ', 'T') + ':00Z').getTime() + hours * 3600000;
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
}

function recordForm3(db, req, confirmation, body) {
  const settings = settingsService.all(db);
  const r = reservations.requireBooking(db, confirmation);
  const form = new Form(body);
  const which = form.oneOf('report', ['arrival', 'departure'], { label: 'Report' });
  const ref = form.text('reference', { label: 'Acknowledgement number', max: 40, required: true });
  if (which === 'arrival' && !r.checked_in_at) form.fail('reference', 'The arrival report is filed after check-in.');
  if (which === 'departure' && !r.checked_out_at) form.fail('reference', 'The departure report is filed after check-out.');
  if (!form.ok) throw new reservations.FormError(form.errors, form.values);
  const stamp = clock.stamp(settings.timezone);
  db.run(`UPDATE reservations SET form3_${which}_ref = ?, form3_${which}_at = ?, updated_at = ? WHERE id = ?`, ref, stamp, stamp, r.id);
  activity.log(db, req, 'form3.record', `Form III ${which} report for ${r.name} (${r.confirmation}) filed: ${ref}`);
}

/* Reports still to file, for the night audit and dashboard reminders. */
function pendingForm3(db) {
  const settings = settingsService.all(db);
  if (settings.country !== 'IN') return [];
  const now = clock.stamp(settings.timezone);
  const since = addHours(now, -24 * 7); // reports are due within 24 hours; older stays are not chased
  return db.all(
    `SELECT r.*, g.first_name || ' ' || g.last_name AS name, g.nationality, rm.number AS room_number FROM reservations r
       JOIN guests g ON g.id = r.guest_id LEFT JOIN rooms rm ON rm.id = r.room_id
      WHERE g.nationality IS NOT NULL AND g.nationality NOT IN ('IN', 'NP', 'BT')
        AND (r.status = 'checked_in' OR r.checked_in_at >= ? OR r.checked_out_at >= ?)
        AND ((r.checked_in_at IS NOT NULL AND r.form3_arrival_ref IS NULL) OR (r.checked_out_at IS NOT NULL AND r.form3_departure_ref IS NULL))
      ORDER BY r.checked_in_at`, since, since,
  ).map((r) => {
    const state = form3(settings, r, r, now);
    const open = state.arrival && !state.arrival.done ? { kind: 'arrival', ...state.arrival } : { kind: 'departure', ...state.departure };
    return { confirmation: r.confirmation, name: r.name, room: r.room_number, country: countryName(r.nationality), kind: open.kind, due: open.due, overdue: open.overdue };
  });
}

function view(db, booking) {
  const settings = settingsService.all(db);
  const guest = db.get('SELECT * FROM guests WHERE id = ?', booking.guest_id);
  const now = clock.stamp(settings.timezone);
  return {
    guest, gaps: missing(guest, booking), complete: Boolean(booking.grc_at), required: Boolean(settings.require_grc),
    foreign: isForeign(guest.nationality), country: countryName(guest.nationality), idMasked: mask(guest.id_number), form3: form3(settings, booking, guest, now),
    when: (stamp) => (stamp ? `${f.formatDay(stamp)} ${f.clock(stamp)}` : ''),
  };
}

module.exports = { COUNTRIES, ID_TYPES, VISA_TYPES, PURPOSES, countryName, needsForm3, isForeign, missing, saveGrc, form3, recordForm3, pendingForm3, view, mask };
