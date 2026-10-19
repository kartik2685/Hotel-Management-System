'use strict';
/* Invite links for new staff, and password links an admin makes for someone who forgot theirs
   (services/signin-links.js): the person chooses their own password, every link works once and for a
   limited time, and a newer link replaces the older one. */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startHotel } = require('./helpers');

const tokenOf = (page) => page.text.match(/id="made-link" value="[^"]*\?token=([\w-]+)"/)[1];
const rowOf = (page, name) => page.text.match(new RegExp(`<tr[^>]*><td><strong>${name}</strong>[\\s\\S]*?</tr>`))[0];

describe('staff invite links', () => {
  let hotel;
  let admin;
  let invite; // Nisha Roy's link, from the first test
  const idOf = (email) => hotel.db.get('SELECT id FROM users WHERE email = ?', email).id;

  before(async () => {
    hotel = await startHotel();
    admin = hotel.client();
    await admin.login();
  });
  after(() => hotel.stop());

  test('an account added without a password gets an invite link, shown once and emailed', async () => {
    await admin.get('/admin/staff');
    const r = await admin.post('/admin/staff', { name: 'Nisha Roy', email: 'nisha.roy@example.com', role: 'frontdesk', shift: 'morning', active: 'on' });
    assert.equal(r.status, 200);
    assert.match(r.text, /Invite link for Nisha Roy is ready\./);
    assert.match(r.text, /it works once, for 7 days, and they choose their own password/);
    assert.match(r.text, /href="https:\/\/wa\.me\/\?text=Hello%20Nisha%2C/);
    assert.match(r.text, /<script src="\/assets\/js\/pages\/staff\.js"><\/script>/);
    invite = tokenOf(r);
    assert.equal(hotel.db.get("SELECT must_change_password FROM users WHERE email = 'nisha.roy@example.com'").must_change_password, 0);
    const mail = hotel.db.get("SELECT subject, body FROM outbox WHERE to_address = 'nisha.roy@example.com'");
    assert.equal(mail.subject, 'Your Frontdesk account at The Harlow Hotel');
    assert.ok(mail.body.includes(`/welcome?token=${invite}`));
    assert.match(mail.body, /Elena Marsh has made you a Frontdesk account/);

    const list = await admin.get('/admin/staff');
    assert.match(rowOf(list, 'Nisha Roy'), /Invite sent<\/span><br><small class="cell-note">open until \w{3} \d{1,2} \w{3}, \d\d:\d\d</);
    assert.doesNotMatch(list.text, /made-link/); // the link is shown only once
    assert.equal((await hotel.client().login('nisha.roy@example.com', 'harlow-demo')).status, 401); // no way in without it
  });

  test('the link opens a welcome page; the password chosen there signs in, and the link is then spent', async () => {
    const c = hotel.client();
    const page = await c.get(`/welcome?token=${invite}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /Welcome to The Harlow Hotel/);
    assert.match(page.text, /The Harlow Hotel · nisha\.roy@example\.com/);
    let r = await c.request('POST', '/password/reset', { form: { token: invite, password: 'nisha-own-pass', confirm: 'nisha-other' } });
    assert.equal(r.status, 422);
    assert.match(r.text, /Welcome to The Harlow Hotel/);
    r = await c.request('POST', '/password/reset', { form: { token: invite, password: 'nisha-own-pass', confirm: 'nisha-own-pass' } });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), '/login?reset=welcome');
    assert.match((await c.get('/login?reset=welcome')).text, /You’re all set/);
    const spent = await c.get(`/welcome?token=${invite}`);
    assert.equal(spent.status, 410);
    assert.match(spent.text, /Invite links work once, for 7 days/);

    const nisha = hotel.client();
    const login = await nisha.login('nisha.roy@example.com', 'nisha-own-pass');
    assert.equal(login.status, 303);
    assert.equal(login.headers.get('location'), '/dashboard'); // no forced change: they chose it themselves
    assert.doesNotMatch(rowOf(await admin.get('/admin/staff'), 'Nisha Roy'), /Invite/);
    assert.equal(hotel.db.get("SELECT summary FROM activity_log WHERE action = 'auth.invite'").summary, 'Nisha Roy opened the invite link and chose a password');
  });

  test('an invite that ran out shows as expired, and a new link replaces the old one', async () => {
    await admin.get('/admin/staff');
    let r = await admin.post('/admin/staff', { name: 'Arun Pal', email: 'arun.pal@example.com', role: 'housekeeping', shift: 'morning', active: 'on' });
    const first = tokenOf(r);
    const id = idOf('arun.pal@example.com');
    hotel.db.run('UPDATE password_resets SET expires_at = ? WHERE user_id = ?', Date.now() - 1000, id);
    assert.match(rowOf(await admin.get('/admin/staff'), 'Arun Pal'), /Invite expired/);
    assert.equal((await hotel.client().get(`/welcome?token=${first}`)).status, 410);

    assert.match((await admin.get(`/admin/staff?edit=${id}`)).text, new RegExp(`formaction="/admin/staff/${id}/link">Send a new invite link<`));
    r = await admin.post(`/admin/staff/${id}/link`);
    assert.equal(r.status, 200);
    assert.match(r.text, /Invite link for Arun Pal is ready\./);
    const second = tokenOf(r);
    assert.equal((await hotel.client().get(`/welcome?token=${second}`)).status, 200);
    r = await admin.post(`/admin/staff/${id}/link`);
    const third = tokenOf(r);
    assert.equal((await hotel.client().get(`/welcome?token=${second}`)).status, 410, 'the newer link replaces it');
    assert.equal((await hotel.client().get(`/welcome?token=${third}`)).status, 200);
    assert.match(rowOf(await admin.get('/admin/staff'), 'Arun Pal'), /Invite sent/);
  });

  test('someone who forgot their password gets a 24-hour link; the old password works until it is used', async () => {
    const id = idOf('jonas.reyes@example.com');
    assert.match((await admin.get(`/admin/staff?edit=${id}`)).text, />Send a password link</);
    const r = await admin.post(`/admin/staff/${id}/link`);
    assert.equal(r.status, 200);
    assert.match(r.text, /Password link for Jonas Reyes is ready\.<\/strong> Send it to Jonas: it works once, for 24 hours\. Their current password keeps working/);
    const token = tokenOf(r);
    assert.match(r.text, /\/password\/reset\?token=/);
    assert.equal(hotel.db.get("SELECT subject FROM outbox WHERE to_address = 'jonas.reyes@example.com' ORDER BY id DESC").subject, 'Choose a new Frontdesk password');
    assert.equal((await hotel.client().login('jonas.reyes@example.com', 'harlow-demo')).status, 303);

    const c = hotel.client();
    const page = await c.get(`/password/reset?token=${token}`);
    assert.match(page.text, /Choose a new password/);
    assert.doesNotMatch(page.text, /Welcome to/);
    const done = await c.request('POST', '/password/reset', { form: { token, password: 'jonas-new-pass', confirm: 'jonas-new-pass' } });
    assert.equal(done.headers.get('location'), '/login?reset=done');
    assert.equal((await hotel.client().login('jonas.reyes@example.com', 'harlow-demo')).status, 401);
    assert.equal((await hotel.client().login('jonas.reyes@example.com', 'jonas-new-pass')).status, 303);
  });

  test('an invited account that may not sign in yet gets its link once it may', async () => {
    await admin.get('/admin/staff');
    let r = await admin.post('/admin/staff', { name: 'Tara Sen', email: 'tara.sen@example.com', role: 'frontdesk', shift: 'night' });
    assert.equal(r.status, 303);
    assert.equal(hotel.db.get("SELECT COUNT(*) AS n FROM outbox WHERE to_address = 'tara.sen@example.com'").n, 0);
    const id = idOf('tara.sen@example.com');
    assert.doesNotMatch((await admin.get(`/admin/staff?edit=${id}`)).text, /\/link"/);
    r = await admin.post(`/admin/staff/${id}/link`);
    assert.equal(r.status, 422);
    assert.match(r.text, /Tara Sen can’t sign in at the moment/);
    await admin.post(`/admin/staff/${id}`, { name: 'Tara Sen', email: 'tara.sen@example.com', role: 'frontdesk', shift: 'night', active: 'on' });
    r = await admin.post(`/admin/staff/${id}/link`);
    assert.match(r.text, /Invite link for Tara Sen is ready\./);
  });

  test('only admins make links, and never for themselves', async () => {
    const id = idOf('arun.pal@example.com');
    const manager = hotel.client();
    await manager.login('gus.palmer@example.com', 'harlow-demo');
    await manager.get('/dashboard');
    assert.equal((await manager.post(`/admin/staff/${id}/link`)).status, 403);
    await admin.get('/admin/staff');
    const self = await admin.post(`/admin/staff/${idOf('elena.marsh@example.com')}/link`);
    assert.equal(self.status, 422);
    assert.match(self.text, /Change your own password in My account\./);
    assert.equal((await admin.post('/admin/staff/99999/link')).status, 404);
    assert.equal((await hotel.client().get('/welcome?token=not-a-real-token-but-long-enough-0123')).status, 410);
  });
});
