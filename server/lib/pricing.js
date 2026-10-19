'use strict';
/* Room pricing. The browser shows the same quote while typing; the server's figure is the one saved. */

/** Nightly rate after the rate plan: "+32" per night or "-12%". */
function planRate(baseCents, plan) {
  if (!plan) return baseCents;
  if (plan.adjust_type === 'percent') return Math.round(baseCents * (1 + plan.adjust_value / 100));
  return baseCents + plan.adjust_value;
}

/** Tax percentage for one night at `rateCents`. */
function taxPercent(settings, rateCents) {
  if (settings.tax_mode === 'none') return 0;
  if (settings.tax_mode === 'gst_india') {
    // GST on hotel rooms from 22 Sep 2025: below ₹1,000 exempt, up to ₹7,500 5%, above 18%.
    if (rateCents < 100000) return 0;
    return rateCents <= 750000 ? 5 : 18;
  }
  return Number(settings.tax_rate) || 0;
}

/** Tax on the room for these nightly rates: the nights at one rate together (GST bands go by the night's rate). */
function roomTax(settings, rates) {
  const nightsAt = new Map();
  for (const rate of rates) nightsAt.set(rate, (nightsAt.get(rate) || 0) + 1);
  let tax = 0;
  for (const [rate, n] of nightsAt) tax += Math.round((rate * n * taxPercent(settings, rate)) / 100);
  return tax;
}

/**
 * @param {object} p  { settings, baseCents, plan, nights, extras: [{price_cents, per}], nightRates? }
 *   nightRates: each night's rate when they differ (seasons and weekends, services/seasons.js).
 * @returns {{rate:number, nights:number, roomTotal:number, tax:number, extras:number, total:number, nightRates:number[]}}
 *   cents; rate is the average when the nights differ.
 */
function quote({ settings, baseCents, plan, nights, extras = [], nightRates = null }) {
  const rates = nightRates || Array.from({ length: nights }, () => planRate(baseCents, plan));
  const roomTotal = rates.reduce((sum, r) => sum + r, 0);
  const rate = nights ? Math.round(roomTotal / nights) : planRate(baseCents, plan);
  const tax = roomTax(settings, rates);
  const extrasTotal = extras.reduce((sum, x) => sum + (x.per === 'night' ? x.price_cents * nights : x.price_cents), 0);
  return { rate, nights, roomTotal, tax, extras: extrasTotal, total: roomTotal + tax + extrasTotal, nightRates: rates };
}

module.exports = { planRate, taxPercent, roomTax, quote };
