'use strict';
/* Admin → Website: one page that shows everything the guest site shows, with the photos in place,
   uploads for every gallery, and a map of where each other part is edited. */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { startHotel } = require('./helpers');
const settingsService = require('../server/services/settings');

const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'assets/img/app-icon-192.png');
const uploadPath = (name) => path.join(ROOT, 'assets/img/rooms', name);
/* Where a photo name lives on disk: the same paths the website serves them from. */
const diskPath = (name) => (name.startsWith('uploads/') ? uploadPath(name)
  : name.startsWith('rooms/') ? path.join(ROOT, 'assets/img', name) : path.join(ROOT, 'assets/img', name));
const png = () => new Blob([fs.readFileSync(ICON)], { type: 'image/png' });
const settingsRow = (hotel, key) => JSON.parse(hotel.db.get('SELECT value FROM settings WHERE key = ?', key).value);

async function postMultipart(base, cookie, csrf, url, build) {
  const form = new FormData();
  form.set('_csrf', csrf);
  build(form);
  return fetch(base + url, { method: 'POST', headers: { cookie, 'x-csrf-token': csrf }, body: form, redirect: 'manual' });
}

describe('admin website page', () => {
  test('one page lists every part of the guest site, with its photos and upload boxes', async () => {
    const hotel = await startHotel();
    try {
      const owner = hotel.client();
      await owner.login();
      const page = await owner.get('/admin/website');
      assert.equal(page.status, 200);
      for (const heading of ['Everything on the website', 'Photos on the website', 'Room photos and galleries', 'Live preview of the guest website']) {
        assert.match(page.text, new RegExp(heading));
      }
      // the two text/photo uploads and one per room type
      assert.match(page.text, /action="\/admin\/website\/photos\/hero"/);
      assert.match(page.text, /action="\/admin\/website\/photos\/about"/);
      const type = hotel.db.get('SELECT * FROM room_types WHERE active = 1 ORDER BY sort, id LIMIT 1');
      assert.match(page.text, new RegExp(`action="/admin/website/room/${type.id}/photo"`));
      // thumbnails, not just file names: three seeded hero photos and their actions
      const hero = settingsRow(hotel, 'site_hero_images');
      assert.equal(hero.length, 3);
      assert.match(page.text, /class="site-photo-tile"/);
      assert.match(page.text, /Main photo/);
      assert.match(page.text, /Make first/);
      assert.match(page.text, /Remove/);
      // where everything else comes from
      assert.match(page.text, /Hotel settings/);
      assert.match(page.text, /Room types/);
      assert.match(page.text, /Rates &amp; extras/);
      assert.match(page.text, new RegExp(`<h3>${type.name}`));
      // the checklist has one row per part of the site and links to where it is edited
      const checklist = page.text.slice(page.text.indexOf('Everything on the website'), page.text.indexOf('Photos on the website'));
      assert.equal((checklist.match(/<tr/g) || []).length, 15); // one heading row + 14 parts of the site
      assert.match(checklist, /Hotel name/);
      assert.match(checklist, /href="\/admin\/settings"/);
      assert.match(checklist, /href="\/admin\/room-types"/);
      assert.match(checklist, /href="\/admin\/rates"/);
      assert.match(checklist, /href="#site-text"/);
      assert.match(checklist, /href="\/admin\/payments"/);
      // rows only turn orange when something is really empty
      assert.doesNotMatch(checklist, /<tr class="is-missing">/);
      settingsService.save(hotel.db, { site_policies: '' });
      const emptied = await owner.get('/admin/website');
      const rows = emptied.text.slice(emptied.text.indexOf('Everything on the website'), emptied.text.indexOf('Photos on the website'));
      assert.equal((rows.match(/<tr class="is-missing">/g) || []).length, 1);
      assert.match(rows, /<tr class="is-missing">\s*<td><strong>Policies<\/strong>/);
    } finally { await hotel.stop(); }
  });

  test('hero photos can be brought forward, removed and uploaded without touching the text', async () => {
    const hotel = await startHotel();
    try {
      const owner = hotel.client();
      await owner.login();
      await owner.get('/admin/website');
      await owner.post('/admin/website', {
        site_enabled: 'on', site_tagline: 'Keep this tagline', site_intro: 'Intro', site_amenities: 'Wi-Fi', site_policies: 'Policies', review_url: '',
      });
      assert.equal(settingsService.all(hotel.db).site_tagline, 'Keep this tagline');

      const [first, second] = settingsRow(hotel, 'site_hero_images');
      let r = await owner.post('/admin/website/photos/hero/first', { name: second });
      assert.equal(r.status, 303);
      assert.equal(settingsRow(hotel, 'site_hero_images')[0], second);

      const removed = settingsRow(hotel, 'site_hero_images')[1];
      r = await owner.post('/admin/website/photos/hero/remove', { name: removed });
      assert.equal(r.status, 303);
      assert.equal(settingsRow(hotel, 'site_hero_images').includes(removed), false);
      // a photo that comes with the app is not deleted from disk, only taken off the site
      assert.equal(fs.existsSync(diskPath(removed)), true);

      // an upload added on its own keeps the texts and appends to the gallery
      const response = await postMultipart(hotel.base, owner.cookieHeader(), owner.csrf, '/admin/website/photos/hero',
        (form) => form.append('photo_upload', png(), 'hero.png'));
      assert.equal(response.status, 303);
      const afterUpload = settingsRow(hotel, 'site_hero_images');
      const added = afterUpload[afterUpload.length - 1];
      assert.match(added, /^uploads\/[a-f0-9]{32}\.png$/);
      assert.equal(fs.existsSync(uploadPath(added)), true);
      assert.equal(settingsService.all(hotel.db).site_tagline, 'Keep this tagline');

      // removing an uploaded photo takes the file with it
      await owner.post('/admin/website/photos/hero/remove', { name: added });
      assert.equal(fs.existsSync(uploadPath(added)), false);
    } finally { await hotel.stop(); }
  });

  test('a room cover and gallery are uploaded and removed from the website page', async () => {
    const hotel = await startHotel();
    try {
      const owner = hotel.client();
      await owner.login();
      await owner.get('/admin/website');
      const type = hotel.db.get('SELECT * FROM room_types WHERE active = 1 ORDER BY sort, id LIMIT 1');
      const response = await postMultipart(hotel.base, owner.cookieHeader(), owner.csrf, `/admin/website/room/${type.id}/photo`, (form) => {
        form.append('photo_upload', png(), 'cover.png');
        form.append('gallery_upload', png(), 'gallery-1.png');
        form.append('gallery_upload', png(), 'gallery-2.png');
      });
      assert.equal(response.status, 303);
      const cover = hotel.db.get('SELECT photo FROM room_types WHERE id = ?', type.id).photo;
      assert.match(cover, /^uploads\/[a-f0-9]{32}\.png$/);
      const galleries = settingsRow(hotel, 'room_type_galleries');
      const gallery = galleries[type.id] || galleries[type.code];
      assert.equal(gallery.length, 4); // the two seeded photos plus two uploads
      const added = gallery.slice(-2);
      assert.ok(added.every((name) => /^uploads\//.test(name)));

      // the page shows them as thumbnails
      const page = await owner.get('/admin/website');
      assert.match(page.text, /<img src="\/assets\/img\/rooms\/uploads\/[a-f0-9]{32}\.png"/);

      let r = await owner.post(`/admin/website/room/${type.id}/photo/remove`, { where: 'gallery', name: added[0] });
      assert.equal(r.status, 303);
      assert.equal(fs.existsSync(uploadPath(added[0])), false);
      assert.equal((settingsRow(hotel, 'room_type_galleries')[type.id] || galleries[type.code]).includes(added[0]), false);

      r = await owner.post(`/admin/website/room/${type.id}/photo/remove`, { where: 'cover', name: cover });
      assert.equal(r.status, 303);
      assert.equal(hotel.db.get('SELECT photo FROM room_types WHERE id = ?', type.id).photo, '');
      assert.equal(fs.existsSync(uploadPath(cover)), false);
      fs.rmSync(uploadPath(added[1]), { force: true });
    } finally { await hotel.stop(); }
  });

  test('the sign-in page offers the guest website only while the website is on', async () => {
    const hotel = await startHotel();
    try {
      const guest = hotel.client();
      let page = await guest.get('/login');
      assert.match(page.text, /Looking for the hotel website\?/);
      assert.match(page.text, /href="\/hotel"/);
      settingsService.save(hotel.db, { site_enabled: false });
      page = await guest.get('/login');
      assert.doesNotMatch(page.text, /Looking for the hotel website\?/);
      settingsService.save(hotel.db, { site_enabled: true });
    } finally { await hotel.stop(); }
  });

  test('the admin tab bar wraps onto several rows instead of scrolling sideways', async () => {
    const css = fs.readFileSync(path.join(ROOT, 'assets/css/pages/admin.css'), 'utf8');
    const block = css.slice(css.indexOf('.admin-tabs {'), css.indexOf('}', css.indexOf('.admin-tabs {')));
    assert.match(block, /flex-wrap:\s*wrap/);
    assert.doesNotMatch(block, /overflow-x:\s*auto/);
    const hotel = await startHotel();
    try {
      const owner = hotel.client();
      await owner.login();
      const page = await owner.get('/admin');
      const nav = page.text.slice(page.text.indexOf('<nav class="admin-tabs"'), page.text.indexOf('</nav>', page.text.indexOf('<nav class="admin-tabs"')));
      assert.equal((nav.match(/<a /g) || []).length >= 18, true, 'every admin section is a tab');
    } finally { await hotel.stop(); }
  });
});
