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

/**
 * @param {object} p  { settings, baseCents, plan, nights, extras: [{price_cents, per}] }
 * @returns {{rate:number, nights:number, roomTotal:number, tax:number, extras:number, total:number}} cents
 */
function quote({ settings, baseCents, plan, nights, extras = [] }) {
  const rate = planRate(baseCents, plan);
  const roomTotal = rate * nights;
  const tax = Math.round((roomTotal * taxPercent(settings, rate)) / 100);
  const extrasTotal = extras.reduce((sum, x) => sum + (x.per === 'night' ? x.price_cents * nights : x.price_cents), 0);
  return { rate, nights, roomTotal, tax, extras: extrasTotal, total: roomTotal + tax + extrasTotal };
}

module.exports = { planRate, taxPercent, quote };
