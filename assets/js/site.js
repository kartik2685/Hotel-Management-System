/* =====================================================================
 * Frontdesk HMS · site.js
 * Guest website: keeps departure after arrival, updates the price when
 * extras are ticked, and prints the confirmation.
 * ===================================================================== */
(function () {
  'use strict';

  const { $, $$, money, DAY_MS } = HMS.util;

  function initStayForms() {
    $$('[data-stay-form]').forEach((form) => {
      const arrival = form.elements.arrival;
      const departure = form.elements.departure;
      arrival.addEventListener('change', () => {
        if (!arrival.value) return;
        const next = new Date(Date.parse(arrival.value) + DAY_MS).toISOString().slice(0, 10);
        departure.min = next;
        if (!departure.value || departure.value <= arrival.value) departure.value = next;
      });
    });
  }

  function initCheckout() {
    const form = $('[data-checkout]');
    if (!form) return;
    const nights = Number(form.dataset.nights);
    const base = Number(form.dataset.base);
    const extrasOut = $('[data-sum-extras]');
    const totalOut = $('[data-sum-total]');
    const update = () => {
      // with GST where the hotel charges it on the extra (data-tax, a percentage)
      const extras = $$('input[name="extra"]:checked', form).reduce((sum, box) => {
        const amount = Number(box.dataset.price) * (box.dataset.per === 'night' ? nights : 1);
        return sum + amount + Math.round((amount * Number(box.dataset.tax || 0)) / 100);
      }, 0);
      if (extrasOut) extrasOut.textContent = money(extras / 100);
      if (totalOut) totalOut.textContent = money((base + extras) / 100);
    };
    form.addEventListener('change', update);
    update();
  }

  HMS.ready(() => {
    initStayForms();
    initCheckout();
    $$('[data-print]').forEach((button) => button.addEventListener('click', () => window.print()));
  });
})();
