/* =====================================================================
 * Frontdesk HMS · pages/account.js
 * "Frontdesk as an app": an Install button where the browser offers one
 * (Chrome, Edge), and a note when Frontdesk already runs as the app.
 * Safari users follow the steps on the card (Share → Add to Home Screen).
 * ===================================================================== */
(function () {
  'use strict';

  let offer = null; // the browser's install prompt, kept for the button
  const INSTALLED = 'Installed. Open Frontdesk from your home screen or desktop.';

  // Listen at once: the browser may announce the offer before the page has finished loading.
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    offer = event;
    show();
  });

  function show() {
    const card = document.querySelector('[data-install-card]');
    if (card && offer) card.querySelector('[data-install-offer]').hidden = false;
  }

  function done(card, text) {
    card.querySelector('[data-install-offer]').hidden = true;
    const note = card.querySelector('[data-install-done]');
    if (text) note.textContent = text;
    note.hidden = false;
  }

  function initInstall() {
    const card = document.querySelector('[data-install-card]');
    if (!card) return;
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
      done(card);
      return;
    }
    show();
    card.querySelector('[data-install]').addEventListener('click', async () => {
      if (!offer) return;
      offer.prompt();
      const choice = await offer.userChoice;
      offer = null;
      if (choice.outcome === 'accepted') done(card, INSTALLED);
      else card.querySelector('[data-install-offer]').hidden = true;
    });
    window.addEventListener('appinstalled', () => done(card, INSTALLED));
  }

  HMS.ready(initInstall);
})();
