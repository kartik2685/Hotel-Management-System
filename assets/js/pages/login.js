/* =====================================================================
 * Frontdesk HMS · pages/login.js
 * Sign-in form checks, show/hide password and the password reset panel.
 *
 * This is a front-end demo: any well-formed email with a password of at
 * least 8 characters opens the dashboard. Real authentication must
 * happen on a server; never trust checks made in the browser.
 * ===================================================================== */
(function () {
  'use strict';

  const { $, isEmail, setFieldError } = HMS.util;

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

    $('[data-reset-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      const message = isEmail(resetEmail.value) ? '' : 'Enter the email you sign in with.';
      setFieldError(resetEmail, message);
      $('[data-reset-done]').hidden = Boolean(message);
      if (message) resetEmail.focus();
    });
  }

  HMS.ready(initSignIn);
})();
