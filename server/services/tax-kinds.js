'use strict';
/* Kinds of service and their tax for an Indian hotel on GST: charges during the stay (services/folio.js) and
   extras (Admin → Rates & extras). Each kind has its SAC code and usual GST rate; outside GST, charges use the
   hotel's flat tax rate and extras stay untaxed as before. */
const pricing = require('../lib/pricing');

/* Restaurant food at a hotel where any room sells above ₹7,500 a night ("specified premises") is 18%, else 5%.
   Laundry, spa and other services 18%; a taxi or transfer 5%. */
const KINDS = [
  { value: 'fnb', label: 'Food & beverage', hint: 'Room service, restaurant, bar', sac: '996331', gst: (premium) => (premium ? 18 : 5) },
  { value: 'minibar', label: 'Minibar', hint: 'Drinks and snacks from the room', sac: '996331', gst: (premium) => (premium ? 18 : 5) },
  { value: 'laundry', label: 'Laundry', hint: 'Washing, pressing, dry cleaning', sac: '999719', gst: () => 18 },
  { value: 'spa', label: 'Spa & wellness', hint: 'Massage, salon, gym', sac: '999723', gst: () => 18 },
  { value: 'transport', label: 'Transport', hint: 'Taxi, airport transfer', sac: '996601', gst: () => 5 },
  { value: 'other', label: 'Other', hint: 'Anything else', sac: '999799', gst: () => 18 },
];
/* Extras can also be part of the stay itself (extra bed, late check-out: the room's rate) or have no GST. */
const ROOM = { value: 'room', label: 'Same as the room', hint: 'Extra bed, late check-out', sac: '996311' };
const NONE = { value: 'none', label: 'No GST', hint: 'Billed without tax', sac: '' };
const EXTRA_KINDS = [ROOM, ...KINDS.filter((k) => k.value !== 'minibar'), NONE];
const GST_RATES = [0, 5, 12, 18, 28];

const isGst = (settings) => settings.tax_mode === 'gst_india';

/* "Specified premises": any room sold above ₹7,500 a night. */
const premium = (db) => Boolean(db.get('SELECT 1 FROM room_types WHERE active = 1 AND base_rate_cents > 750000'));

/* Tax on an extra: { rate (percent), sac }. `roomRate` is the nightly room rate, for extras that follow the room. */
function extraTax(settings, kind, roomRate, high) {
  if (!isGst(settings) || !kind || kind === 'none') return { rate: 0, sac: '' };
  if (kind === 'room') return { rate: pricing.taxPercent(settings, roomRate), sac: ROOM.sac };
  const k = KINDS.find((x) => x.value === kind);
  return k ? { rate: k.gst(high), sac: k.sac } : { rate: 0, sac: '' };
}

/* The extra kinds with the usual rate at this hotel, for forms ("Transport · 5%"). */
function extraKinds(db, settings) {
  const high = premium(db);
  return EXTRA_KINDS.map((k) => ({ ...k, rate: k.value === 'room' || k.value === 'none' ? null : k.gst(high) }));
}

const sacOf = (kind) => (kind === 'room' ? ROOM.sac : (KINDS.find((k) => k.value === kind) || NONE).sac);

module.exports = { KINDS, EXTRA_KINDS, GST_RATES, isGst, premium, extraTax, extraKinds, sacOf };
