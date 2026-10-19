/* =====================================================================
 * Frontdesk HMS · pages/login.js
 * Sign-in form checks, show/hide password, the password reset panel and
 * a note when the browser blocks the sign-in cookie.
 *
 * These checks only help people fix typos: the server checks the
 * password and decides what each account may open.
 * ===================================================================== */
(function () {
  'use strict';

  const { $, $$, isEmail, setFieldError } = HMS.util;

  function initSignIn() {
    const form = $('[data-login-form]');
    if (!form) return;
    const email = form.elements.email;
    const password = form.elements.password;

    form.addEventListener('input', (event) => {
      if (event.target.classList.contains('is-invalid')) setFieldError(event.target, '');
    });

    form.addEventListener('submit', (event) => {
      const emailError = !email.value.trim() ? 'Enter your staff email.'
        : isEmail(email.value) ? '' : 'That email doesn’t look right.';
      const passwordError = !password.value ? 'Enter your password.'
        : password.value.length < 8 ? 'Passwords are at least 8 characters.' : '';
      setFieldError(email, emailError);
      setFieldError(password, passwordError);
      // Valid input goes to the server, which checks the password and opens the right page.
      if (emailError) { event.preventDefault(); email.focus(); return; }
      if (passwordError) { event.preventDefault(); password.focus(); }
    });

    const toggle = $('[data-password-toggle]');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const show = password.type === 'password';
        password.type = show ? 'text' : 'password';
        toggle.setAttribute('aria-pressed', String(show));
        toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      });
    }

    initPasswordReset(email);
    initCookieCheck();
  }

  // Some browsers block cookies when the app is shown inside another site's frame (such as a
  // preview panel). Signing in can't work there, so say so before anyone types a password.
  function initCookieCheck() {
    const notice = $('[data-cookie-notice]');
    if (!notice) return;
    // The address as this browser sees it (the server may sit behind a proxy).
    const open = $('[data-cookie-open]', notice);
    const address = $('[data-cookie-address]', notice);
    if (open && address) address.textContent = new URL(open.getAttribute('href'), window.location.href).href;
    $$('[data-cookie-host]', notice).forEach((host) => { host.textContent = window.location.host; });
    initOpenAndCopy(notice, open, address);
    if (!window.fetch) return;
    fetch('/login/cookie-check', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (!result || typeof result.cookies !== 'boolean') return;
        const framed = window.top !== window.self;
        $$('[data-cookie-help]', notice).forEach((help) => { help.hidden = help.dataset.cookieHelp !== (framed ? 'frame' : 'page'); });
        notice.hidden = result.cookies;
      })
      .catch(() => { /* unknown: leave the page as it is */ });
  }

  // "Open in a new tab" and "Copy address". Some preview panels can't open tabs: then say how.
  function initOpenAndCopy(notice, open, address) {
    if (!open || !address) return;
    const selectAddress = () => {
      const range = document.createRange();
      range.selectNodeContents(address);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    };
    open.addEventListener('click', (event) => {
      event.preventDefault();
      const tab = window.open(open.href, '_blank');
      if (tab) {
        tab.opener = null;
      } else {
        $('[data-cookie-popup-blocked]', notice).hidden = false;
        selectAddress();
      }
    });
    const copy = $('[data-cookie-copy]', notice);
    if (!copy) return;
    copy.addEventListener('click', () => {
      const copied = () => {
        copy.textContent = 'Copied';
        window.setTimeout(() => { copy.textContent = 'Copy address'; }, 2000);
      };
      const byHand = () => {
        selectAddress();
        try {
          if (document.execCommand('copy')) copied();
        } catch (e) { /* the address stays selected for Ctrl+C */ }
      };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(address.textContent.trim()).then(copied, byHand);
      else byHand();
    });
  }

  function initPasswordReset(loginEmail) {
    const toggle = $('[data-reset-toggle]');
    const panel = $('[data-reset-panel]');
    if (!toggle || !panel) return;
    const resetEmail = $('#reset-email');

    toggle.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) {
        if (!resetEmail.value && loginEmail.value) resetEmail.value = loginEmail.value;
        resetEmail.focus();
      }
    });

    // A valid email goes to the server, which emails a reset link (if the account exists).
    $('[data-reset-form]').addEventListener('submit', (event) => {
      const message = isEmail(resetEmail.value) ? '' : 'Enter the email you sign in with.';
      setFieldError(resetEmail, message);
      if (message) {
        event.preventDefault();
        $('[data-reset-done]').hidden = true;
        resetEmail.focus();
      }
    });
  }

  HMS.ready(initSignIn);
})();
