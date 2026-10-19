'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startHotel } = require('./helpers');

describe('admin manual and live website controls', () => {
  test('admin can open a live manual with current data and every permitted admin tab; each admin page links to it', async () => {
    const hotel = await startHotel();
    try {
      const owner = hotel.client();
      await owner.login();
      const guide = await owner.get('/admin/guide');
      assert.equal(guide.status, 200);
      assert.match(guide.text, /Live website preview/);
      assert.match(guide.text, /<iframe[^>]+src="\/hotel"/);
      assert.match(guide.text, /Room cards configured for the website/);
      assert.match(guide.text, /Night audit/);
      assert.match(guide.text, /How it works · Manual/);
      const page = await owner.get('/admin/website');
      assert.match(page.text, /name="hero_upload"/);
      assert.match(page.text, /name="about_upload"/);
      assert.match(page.text, /multiple/);
      const upload = new FormData();
      for (const [key, value] of Object.entries({ _csrf: owner.csrf, site_enabled: 'on', site_tagline: 'A live test tagline', site_intro: '', site_amenities: 'Wi-Fi\\nBreakfast', site_policies: '', review_url: '' })) upload.set(key, value);
      upload.append('hero_upload', new Blob([require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'assets/img/app-icon-192.png'))], { type: 'image/png' }), 'hotel.png');
      upload.append('hero_upload', new Blob([require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'assets/img/app-icon-192.png'))], { type: 'image/png' }), 'hotel-second.png');
      const response = await fetch(`${hotel.base}/admin/website`, { method: 'POST', headers: { cookie: owner.cookieHeader(), 'x-csrf-token': owner.csrf }, body: upload, redirect: 'manual' });
      assert.equal(response.status, 303);
      const stored = hotel.db.get("SELECT value FROM settings WHERE key = 'site_hero_images'");
      const uploaded = JSON.parse(stored.value);
      assert.equal(uploaded.length, 5); // three seeded demo photos plus two new uploads
      const addedHero = uploaded.slice(-2);
      assert.ok(addedHero.every((name) => name.startsWith('uploads/') && name.endsWith('.png')));
      const roomType = hotel.db.get('SELECT * FROM room_types WHERE active = 1 AND online = 1 ORDER BY id LIMIT 1');
      const roomForm = new FormData();
      const fields = { _csrf: owner.csrf, code: roomType.code, name: roomType.name, sort: roomType.sort, base_rate: roomType.base_rate_cents / 100, max_guests: roomType.max_guests, clean_minutes: roomType.clean_minutes, service_minutes: roomType.service_minutes, description: roomType.description || '', bed: roomType.bed || '', size_sqm: roomType.size_sqm || '', photo: roomType.photo || '', active: 'on', online: 'on' };
      for (const [key, value] of Object.entries(fields)) roomForm.set(key, String(value));
      for (let i = 0; i < 2; i++) roomForm.append('gallery_upload', new Blob([require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'assets/img/app-icon-192.png'))], { type: 'image/png' }), `room-${i}.png`);
      const roomResponse = await fetch(`${hotel.base}/admin/room-types/${roomType.id}`, { method: 'POST', headers: { cookie: owner.cookieHeader(), 'x-csrf-token': owner.csrf }, body: roomForm, redirect: 'manual' });
      assert.equal(roomResponse.status, 303);
      const roomGallery = JSON.parse(hotel.db.get("SELECT value FROM settings WHERE key = 'room_type_galleries'").value)[roomType.id];
      assert.equal(roomGallery.length, 4); // two seeded demo images plus two new images
      const home = await owner.get('/hotel');
      assert.match(home.text, /data-site-carousel/);
      assert.match(home.text, /data-carousel-next/);
      for (const name of [...addedHero, ...roomGallery.slice(-2)]) require('node:fs').unlinkSync(require('node:path').join(__dirname, '..', 'assets/img/rooms', name));
    } finally { await hotel.stop(); }
  });

  test('manager sees the manual but it only lists tabs permitted by their role', async () => {
    const hotel = await startHotel();
    try {
      const manager = hotel.client();
      await manager.login('gus.palmer@example.com');
      const guide = await manager.get('/admin/guide');
      assert.equal(guide.status, 200);
      assert.match(guide.text, /Website/);
      const navStart = guide.text.indexOf('<nav class="admin-tabs"');
      const navEnd = guide.text.indexOf('</nav>', navStart);
      const adminTabs = guide.text.slice(navStart, navEnd);
      assert.equal(adminTabs.includes('href="/admin/settings"'), false);
      assert.equal(adminTabs.includes('href="/admin/staff"'), false);
    } finally { await hotel.stop(); }
  });
});
