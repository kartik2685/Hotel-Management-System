'use strict';
/* Guest feedback after check-out (services/feedback.js): the thank-you message's signed link, stars and a comment,
   a Google review asked of happy guests, staff told at once about unhappy ones, and the answers in the reports.
   The test clock reads Thu 24 Sep 2026. */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startHotel } = require('./helpers');
const seed = require('../server/db/seed');
const sample = require('../server/db/sample');

const OWNER = ['owner@hotel.example.in', 'Owner-pass-2026'];
const STAFF = 'Staff-Test-2026';
const REVIEW = 'https://g.page/r/hooghly-residency/review';

describe('guest feedback', () => {
  let hotel;
  let owner;
  let desk;
  let happy; // a stay that ended, answered in the first test
  const one = (sql, ...args) => hotel.db.get(sql, ...args);
  const unanswered = (skip = '') => one(`SELECT r.confirmation, g.first_name FROM reservations r JOIN guests g ON g.id = r.guest_id
    WHERE r.status = 'checked_out' AND r.confirmation <> ? AND NOT EXISTS (SELECT 1 FROM feedback fb WHERE fb.reservation_id = r.id) ORDER BY r.id DESC LIMIT 1`, skip);
  const linkFrom = async (confirmation) => {
    const page = (await desk.get(`/reservations/${confirmation}`)).text;
    const text = decodeURIComponent(page.match(/href="https:\/\/wa\.me\/[^"]*\?text=([^"]+)"/)[1].replace(/&amp;/g, '&'));
    return text.match(/How was your stay\? Tell us in thirty seconds: (\S+)/)[1].replace(/^https?:\/\/[^/]+/, '');
  };

  before(async () => {
    hotel = await startHotel({
      load: async (db) => {
        await seed.createEmptyHotel(db, { email: OWNER[0], name: 'Hotel Owner', password: OWNER[1] });
        await sample.add(db, { password: STAFF });
      },
    });
    owner = hotel.client();
    await owner.login(...OWNER);
    desk = hotel.client();
    await desk.login('priya.das@hooghlyresidency.example.com', STAFF);
  });
  after(() => hotel.stop());

  test('the admin adds the hotel’s Google review link (a full https link)', async () => {
    await owner.get('/admin/website');
    const s = hotel.db.get("SELECT value FROM settings WHERE key = 'site_tagline'");
    const base = { site_enabled: 'on', site_tagline: JSON.parse(s.value), site_intro: '', site_amenities: '', site_policies: '' };
    let r = await owner.post('/admin/website', { ...base, review_url: 'g.page/hooghly' });
    assert.equal(r.status, 422);
    assert.match(r.text, /Paste the full link, starting with https:\/\//);
    r = await owner.post('/admin/website', { ...base, review_url: REVIEW });
    assert.equal(r.status, 303);
  });

  test('the thank-you message carries the link; five stars ask for a Google review, once', async () => {
    happy = unanswered();
    const link = await linkFrom(happy.confirmation);
    assert.match(link, new RegExp(`^/feedback/${happy.confirmation}\\?t=[\\w-]{32}$`));
    const guest = hotel.client();
    let page = await guest.get(link);
    assert.equal(page.status, 200);
    assert.match(page.text, new RegExp(`How was your stay, ${happy.first_name}\\?`));
    const t = page.text.match(/name="t" value="([^"]+)"/)[1];
    let r = await guest.request('POST', `/feedback/${happy.confirmation}`, { form: { t, rating: '5', comment: 'Lovely stay, thank you!' } });
    assert.equal(r.status, 303);
    page = await guest.get(r.headers.get('location'));
    assert.match(page.text, new RegExp(`Thank you, ${happy.first_name}`));
    assert.match(page.text, new RegExp(`href="${REVIEW}"[^>]*>.*Write a Google review`));
    r = await guest.request('POST', `/feedback/${happy.confirmation}`, { form: { t, rating: '1', comment: 'changed my mind' } });
    assert.equal(one('SELECT rating FROM feedback fb JOIN reservations r ON r.id = fb.reservation_id WHERE r.confirmation = ?', happy.confirmation).rating, 5, 'one answer per stay');
  });

  test('an unhappy guest: staff are told at once, and no Google button', async () => {
    const b = unanswered(happy.confirmation);
    const guest = hotel.client();
    const link = await linkFrom(b.confirmation);
    const t = (await guest.get(link)).text.match(/name="t" value="([^"]+)"/)[1];
    await guest.request('POST', `/feedback/${b.confirmation}`, { form: { t, rating: '2', comment: 'Hot water ran out every morning.' } });
    assert.match(one('SELECT title, detail FROM notifications ORDER BY id DESC LIMIT 1').title, new RegExp(`^2★ feedback from ${b.first_name}`));
    const page = (await guest.get(link)).text;
    assert.match(page, /We’re sorry we fell short\./);
    assert.doesNotMatch(page, /Write a Google review/);
  });

  test('the link opens for that stay only, after check-out; stars are needed; signed-in staff can send it too', async () => {
    const guest = hotel.client();
    const link = await linkFrom(happy.confirmation);
    assert.equal((await guest.get(link.replace(/t=[\w-]+/, 't=not-the-right-token-but-thirty-two'))).status, 404);
    const future = one("SELECT confirmation FROM reservations WHERE status = 'confirmed' ORDER BY id LIMIT 1").confirmation;
    const t = require('../server/services/feedback').token(hotel.db, future);
    assert.equal((await guest.get(`/feedback/${future}?t=${t}`)).status, 404);
    const b = unanswered(happy.confirmation);
    const own = await linkFrom(b.confirmation);
    const token = own.split('t=')[1];
    let r = await desk.request('POST', `/feedback/${b.confirmation}`, { form: { t: token, comment: 'no stars' } });
    assert.equal(r.status, 422);
    assert.match(r.text, /Choose from one to five stars\./);
    r = await desk.request('POST', `/feedback/${b.confirmation}`, { form: { t: token, rating: '4' } }); // a signed-in browser: no CSRF trouble
    assert.equal(r.status, 303);
  });

  test('answers show on the booking page, in the daily report and in the reports', async () => {
    const booking = (await desk.get(`/reservations/${happy.confirmation}`)).text;
    assert.match(booking, /<h2 class="card__title" id="fb-title">Guest feedback<\/h2>/);
    assert.match(booking, /★★★★★/);
    assert.match(booking, /“Lovely stay, thank you!”/);
    const manager = hotel.client();
    await manager.login('sneha.banerjee@hooghlyresidency.example.com', STAFF);
    const daily = (await manager.get('/admin/daily?day=2026-09-24')).text;
    assert.match(daily, /3 answers · average 3\.7★/);
    assert.match(daily, /Guest feedback: 3 · average 3\.7★ · 1 unhappy/);
    const reports = (await manager.get('/admin/reports?from=2026-08-01&to=2026-09-24')).text;
    assert.match(reports, /<h2 class="card__title" id="rp-fb">Guest feedback<\/h2><p class="card__subtitle">\d+ answers · average \d\.\d★<\/p>/);
  });
});
