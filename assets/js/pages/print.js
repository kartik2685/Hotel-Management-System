/* Print button on invoices and registration cards. */
(function () {
  'use strict';
  document.querySelectorAll('[data-print]').forEach((button) => button.addEventListener('click', () => window.print()));
})();
