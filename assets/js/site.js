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

  function initCarousels() {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const desktopHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    $$('[data-site-carousel]').forEach((carousel) => {
      const slides = $$('.site-carousel__slide', carousel);
      if (slides.length < 2) return;
      const counter = $('.site-carousel__count', carousel);
      let active = Math.max(0, slides.findIndex((slide) => slide.classList.contains('is-active')));
      let timer = null;
      const show = (next) => {
        slides[active].classList.remove('is-active');
        active = (next + slides.length) % slides.length;
        slides[active].classList.add('is-active');
        if (counter) counter.textContent = `${active + 1} / ${slides.length}`;
      };
      const stop = () => { if (timer) window.clearInterval(timer); timer = null; };
      const start = () => {
        stop();
        if (!reducedMotion) timer = window.setInterval(() => show(active + 1), 4000);
      };
      carousel.querySelector('[data-carousel-next]')?.addEventListener('click', () => { show(active + 1); if (!desktopHover) start(); });
      carousel.querySelector('[data-carousel-prev]')?.addEventListener('click', () => { show(active - 1); if (!desktopHover) start(); });
      if (desktopHover) {
        carousel.addEventListener('mouseenter', start);
        carousel.addEventListener('mouseleave', stop);
        carousel.addEventListener('focusin', start);
        carousel.addEventListener('focusout', (event) => { if (!carousel.contains(event.relatedTarget)) stop(); });
      } else {
        start();
      }
      // Swipe support for touch screens.
      let touchX = null;
      carousel.addEventListener('touchstart', (event) => { touchX = event.changedTouches[0]?.clientX ?? null; }, { passive: true });
      carousel.addEventListener('touchend', (event) => {
        if (touchX === null) return;
        const delta = event.changedTouches[0].clientX - touchX;
        if (Math.abs(delta) > 45) show(active + (delta < 0 ? 1 : -1));
        touchX = null;
      }, { passive: true });
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
    initCarousels();
    $$('[data-print]').forEach((button) => button.addEventListener('click', () => window.print()));
  });
})();
