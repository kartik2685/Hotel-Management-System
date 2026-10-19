'use strict';
/* Multipart forms need the same session CSRF token as ordinary admin posts. */
document.addEventListener('submit', async (event) => {
  const form = event.target.closest('form.js-admin-upload');
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  if (button) { button.disabled = true; button.dataset.originalText = button.textContent; button.textContent = 'Uploading…'; }
  try {
    const token = document.querySelector('meta[name="csrf-token"]')?.content || '';
    const response = await fetch(form.action, {
      method: form.method || 'POST',
      body: new FormData(form),
      headers: { 'x-csrf-token': token },
      credentials: 'same-origin',
      redirect: 'follow',
    });
    if (response.redirected) { window.location.assign(response.url); return; }
    const html = await response.text();
    if (html) { document.open(); document.write(html); document.close(); }
  } catch (_) {
    window.alert('Upload failed. Check your connection and try again.');
    if (button) { button.disabled = false; button.textContent = button.dataset.originalText || 'Save'; }
  }
});
