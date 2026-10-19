/* =====================================================================
 * Frontdesk HMS · pages/staff.js
 * Admin panel → Staff accounts: copy a sign-in link that was just made
 * (an invite or a password link), to paste into WhatsApp, SMS or email.
 * ===================================================================== */
(function () {
  'use strict';

  function initCopyLink() {
    const button = document.querySelector('[data-copy-link]');
    if (!button) return;
    const input = document.getElementById(button.getAttribute('aria-controls'));
    const label = button.textContent;
    input.addEventListener('focus', () => input.select());

    button.addEventListener('click', () => {
      const copied = () => {
        button.textContent = 'Copied';
        window.setTimeout(() => { button.textContent = label; }, 2000);
      };
      const byHand = () => {
        input.focus();
        input.select();
        try {
          if (document.execCommand('copy')) copied();
        } catch (e) { /* the link stays selected for Ctrl+C */ }
      };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(input.value).then(copied, byHand);
      else byHand();
    });
  }

  HMS.ready(initCopyLink);
})();
