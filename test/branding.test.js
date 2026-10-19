'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startHotel } = require('./helpers');

describe('hotel branding', () => {
  test('public website, sign-in page, and staff app use Frontdesk/hotel branding without template credits', async () => {
    const hotel = await startHotel();
    try {
      const guest = hotel.client();
      const home = await guest.get('/hotel');
      assert.equal(home.status, 200);
      const login = await guest.get('/login');
      assert.equal(login.status, 200);
      const staff = hotel.client();
      await staff.login();
      const dashboard = await staff.get('/dashboard');
      assert.equal(dashboard.status, 200);
      for (const page of [home, login, dashboard]) {
        assert.doesNotMatch(page.text, /uiCookies|Template by|Free Hotel Management System Template/i);
      }
      assert.match(home.text, /Powered by Frontdesk/);
      assert.match(dashboard.text, /Hotel operations, all in one place/);
    } finally { await hotel.stop(); }
  });
});
