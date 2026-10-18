'use strict';
/* Browsers that block cookies inside a preview panel: sign-in says what to do, guest forms still work,
 * and forms sent from other sites are still refused. */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startHotel } = require('./helpers');
const formtoken = require('../server/lib/formtoken');
const settingsService = require('../server/services/settings');

let hotel;
before(async () => { hotel = await startHotel(); });
after(async () => { await hotel.stop(); });

const tokenIn = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' };
const CROSS_SITE = { 'sec-fetch-site': 'cross-site' };
const ELENA = { email: 'elena.marsh@example.com', password: 'harlow-demo', shift: 'morning' };
const secret = () => settingsService.siteSecret(hotel.db);
const sessions = () => hotel.db.get('SELECT COUNT(*) AS n FROM sessions').n;

/* A visitor whose browser shows the page but never stores our cookies. */
async function withoutCookies(url) {
  const c = hotel.client();
  const page = await c.get(url);
  assert.equal(page.status, 200);
  c.cookies = {};
  return { c, page, token: tokenIn(page.text) };
}

describe('sign-in when the browser blocks cookies', () => {
  test('the sign-in page can find out whether cookies are kept', async () => {
    const c = hotel.client();
    assert.deepEqual((await c.get('/login/cookie-check')).body, { cookies: false });
    const page = await c.get('/login');
    assert.match(page.text, /data-cookie-notice role="alert" hidden>/); // the note stays hidden normally
    assert.deepEqual((await c.get('/login/cookie-check')).body, { cookies: true });
  });

  test('without the cookie, sign-in explains how to continue and opens no session', async () => {
    const { c, token } = await withoutCookies('/login?next=%2Freservations');
    const count = sessions();
    // Inside a preview panel: open the app in its own tab.
    const r = await c.request('POST', '/login', { form: { _csrf: token, ...ELENA, next: '/reservations' }, headers: { ...SAME_ORIGIN, 'sec-fetch-dest': 'iframe' } });
    assert.equal(r.status, 403);
    assert.match(r.text, /data-cookie-notice role="alert">/);
    assert.match(r.text, /data-cookie-help="frame">\s*<p class="success-box__title">Sign in from a new tab/);
    assert.match(r.text, /href="\/login\?next=%2Freservations" target="_blank" rel="noopener" data-cookie-open>Open in a new tab/);
    assert.match(r.text, /<span data-cookie-address>http:\/\/127\.0\.0\.1:\d+\/login\?next=%2Freservations<\/span>/);
    assert.match(r.text, /data-cookie-help="page" hidden>/);
    assert.match(r.text, /This browser blocked the sign-in cookie/);
    assert.ok(!r.headers.getSetCookie().some((line) => line.startsWith('hms_session=')));
    // In a normal tab: allow cookies for the site.
    c.cookies = {}; // this browser dropped the new cookie too
    const page = await c.request('POST', '/login', { form: { _csrf: token, ...ELENA }, headers: { ...SAME_ORIGIN, 'sec-fetch-dest': 'document' } });
    assert.equal(page.status, 403);
    assert.match(page.text, /data-cookie-help="frame" hidden>/);
    assert.match(page.text, /data-cookie-help="page">\s*<p class="success-box__title">Allow cookies to sign in/);
    assert.match(page.text, /Allow cookies for <span data-cookie-host>127\.0\.0\.1:\d+<\/span> in the browser settings/);
    assert.equal(sessions(), count);
  });

  test('a fresh page still signs in when another tab replaced the cookie', async () => {
    const c = hotel.client();
    const token = tokenIn((await c.get('/login')).text);
    c.cookies.hms_login = formtoken.issue(secret(), 'login'); // a newer cookie from another tab
    const r = await c.request('POST', '/login', { form: { _csrf: token, ...ELENA }, headers: SAME_ORIGIN });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), '/dashboard');
    // Older browsers send only Origin.
    const older = hotel.client();
    const oldToken = tokenIn((await older.get('/login')).text);
    older.cookies.hms_login = formtoken.issue(secret(), 'login');
    const viaOrigin = await older.request('POST', '/login', { form: { _csrf: oldToken, ...ELENA }, headers: { origin: hotel.base } });
    assert.equal(viaOrigin.status, 303);
  });

  test('tokens that are forged, old, for another form or sent from another site are refused', async () => {
    const c = hotel.client();
    const token = tokenIn((await c.get('/login')).text);
    c.cookies.hms_login = formtoken.issue(secret(), 'login');
    const attempts = [
      { _csrf: token, headers: CROSS_SITE },
      { _csrf: token, headers: { origin: 'https://evil.example' } }, // older browsers: Origin only
      { _csrf: token, headers: {} }, // neither header: the cookie has to match
      { _csrf: `${token.slice(0, -4)}AAAA`, headers: SAME_ORIGIN },
      { _csrf: formtoken.issue(secret(), 'login', Date.now() - 13 * 60 * 60 * 1000), headers: SAME_ORIGIN },
      { _csrf: formtoken.issue(secret(), 'site'), headers: SAME_ORIGIN },
      { _csrf: formtoken.issue('some-other-secret', 'login'), headers: SAME_ORIGIN },
    ];
    for (const { _csrf, headers } of attempts) {
      const r = await c.request('POST', '/login', { form: { _csrf, ...ELENA }, headers });
      assert.equal(r.status, 403, `${_csrf} ${JSON.stringify(headers)}`);
      assert.match(r.text, /The form expired/);
    }
  });

  test('password reset requests work without the cookie', async () => {
    const { c, token } = await withoutCookies('/login');
    const r = await c.request('POST', '/password/forgot', { form: { _csrf: token, email: 'jonas.reyes@example.com' }, headers: SAME_ORIGIN });
    assert.equal(r.status, 200);
    assert.match(r.text, /a link to choose a new password is on its way/);
  });
});

describe('guest website when the browser blocks cookies', () => {
  const query = new URLSearchParams({ arrival: '2026-11-09', departure: '2026-11-11', adults: '2', children: '0', type: 'DK', plan: 'BAR' });
  const guest = { arrival: '2026-11-09', departure: '2026-11-11', adults: '2', children: '0', type: 'DK', plan: 'BAR', first: 'Anika', last: 'Sen', email: 'anika.sen@example.com', phone: '+91 98300 22222', nationality: 'IN', terms: 'on' };

  test('a guest can still book and open the booking', async () => {
    const { c, token } = await withoutCookies(`/hotel/book/details?${query}`);
    const r = await c.request('POST', '/hotel/book', { form: { _csrf: token, ...guest }, headers: SAME_ORIGIN });
    assert.equal(r.status, 303);
    const page = await c.get(r.headers.get('location'));
    assert.equal(page.status, 200);
    assert.match(page.text, /Anika/);
  });

  test('the same form sent from another site is refused', async () => {
    const { c, token } = await withoutCookies(`/hotel/book/details?${query}`);
    const count = hotel.db.get('SELECT COUNT(*) AS n FROM reservations').n;
    for (const headers of [CROSS_SITE, { origin: 'https://evil.example' }, {}]) {
      const r = await c.request('POST', '/hotel/book', { form: { _csrf: token, ...guest, email: 'cross.site@example.com' }, headers });
      assert.equal(r.status, 403);
    }
    assert.equal(hotel.db.get('SELECT COUNT(*) AS n FROM reservations').n, count);
  });
});
