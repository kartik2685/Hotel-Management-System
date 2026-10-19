/* Frontdesk HMS · theme-init.js
 * Loaded in <head> before the stylesheets so the page never flashes in the
 * wrong colours. It marks JavaScript as available (html.js) and applies the
 * saved theme, falling back to the operating system preference.
 * Kept in ES5 on purpose: it must run everywhere, before anything else.
 */
(function () {
  var root = document.documentElement;
  var theme = null;

  root.classList.add('js');

  try {
    theme = window.localStorage.getItem('hms-theme');
  } catch (err) {
    /* Storage can be blocked (private mode, strict settings). */
  }

  if (theme !== 'light' && theme !== 'dark') {
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    theme = prefersDark ? 'dark' : 'light';
  }

  root.setAttribute('data-theme', theme);
})();
