'use strict';
/* What a new database starts with when the server starts, and what a live server never shows. */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startHotel, freshDatabase } = require('./helpers');
const seed = require('../server/db/seed');
const settingsService = require('../server/services/settings');
const { verifyPassword } = require('../server/lib/auth');
const config = require('../server/config');

/* A fresh, empty database for one call of firstRun. */
async function firstRun(env) {
  const { db, drop } = freshDatabase();
  settingsService.reset();
  try {
    const start = await seed.firstRun(db, env);
    const users = db.all('SELECT email, role, password_hash, must_change_password FROM users ORDER BY id');
    const hotel = JSON.parse(db.get("SELECT value FROM settings WHERE key = 'hotel_name'").value);
    return { start, users, hotel };
  } finally {
    drop();
    settingsService.reset();
  }
}

describe('first start of a new database', () => {
  test('on a live server the demo never uses the public password', async () => {
    const { start, users } = await firstRun({ NODE_ENV: 'production' });
    assert.equal(start.kind, 'demo');
    assert.equal(start.email, 'elena.marsh@example.com');
    assert.ok(start.password && start.password !== 'harlow-demo' && start.password.length >= 12);
    assert.ok(await verifyPassword(start.password, users[0].password_hash));
    assert.equal(await verifyPassword('harlow-demo', users[0].password_hash), false);
  });

  test('DEMO_PASSWORD chooses the demo password and is not printed', async () => {
    const { start, users } = await firstRun({ NODE_ENV: 'production', DEMO_PASSWORD: 'Rasgulla-2026' });
    assert.equal(start.password, null);
    assert.ok(await verifyPassword('Rasgulla-2026', users[0].password_hash));
  });

  test('without production the demo keeps its documented password', async () => {
    const { start } = await firstRun({});
    assert.deepEqual(start, { kind: 'demo', email: 'elena.marsh@example.com', password: 'harlow-demo' });
  });

  test('ADMIN_EMAIL starts an empty hotel with one admin', async () => {
    const { start, users, hotel } = await firstRun({
      NODE_ENV: 'production', ADMIN_EMAIL: ' Owner@MyHotel.in ', ADMIN_PASSWORD: 'Sandesh-Kolkata-7', HOTEL_NAME: 'Hotel Ganga View',
    });
    assert.deepEqual(start, { kind: 'empty', email: 'owner@myhotel.in', password: null });
    assert.equal(users.length, 1);
    assert.equal(users[0].role, 'admin');
    assert.equal(users[0].must_change_password, 0); // the owner chose it
    assert.ok(await verifyPassword('Sandesh-Kolkata-7', users[0].password_hash));
    assert.equal(hotel, 'Hotel Ganga View');
  });

  test('without ADMIN_PASSWORD a one-time password is printed and must be changed', async () => {
    const { start, users } = await firstRun({ ADMIN_EMAIL: 'owner@myhotel.in' });
    assert.equal(start.kind, 'empty');
    assert.ok(start.password.length >= 12);
    assert.equal(users[0].must_change_password, 1);
    assert.ok(await verifyPassword(start.password, users[0].password_hash));
  });

  test('passwords that could never sign in, and bad emails, stop the start', async () => {
    await assert.rejects(firstRun({ DEMO_PASSWORD: 'short' }), /DEMO_PASSWORD must be 8 to 200 characters/);
    await assert.rejects(firstRun({ ADMIN_EMAIL: 'owner@myhotel.in', ADMIN_PASSWORD: '1234' }), /ADMIN_PASSWORD must be 8 to 200 characters/);
    await assert.rejects(firstRun({ ADMIN_EMAIL: 'owner-at-hotel' }), /ADMIN_EMAIL is not an email address/);
  });
});

describe('demo sign-in hint', () => {
  let hotel;
  before(async () => { hotel = await startHotel(); });
  after(async () => {
    config.production = false;
    await hotel.stop();
  });

  test('is shown in development but never on a live server', async () => {
    const dev = await hotel.client().get('/login');
    assert.match(dev.text, /Demo: sign in as elena\.marsh@example\.com with the password harlow-demo/);
    config.production = true;
    try {
      const live = await hotel.client().get('/login');
      assert.equal(live.status, 200);
      assert.doesNotMatch(live.text, /Demo: sign in|harlow-demo/);
    } finally {
      config.production = false;
    }
  });
});
