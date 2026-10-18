'use strict';
/* Test helpers: a fresh demo hotel per test file and a tiny browser-like client. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.HMS_NOW = process.env.HMS_NOW || '2026-09-24T10:42';

const { open } = require('../server/db');
const seed = require('../server/db/seed');
const settingsService = require('../server/services/settings');
const { createApp } = require('../server/app');

async function startHotel() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-test-'));
  const db = open(path.join(dir, 'test.db'));
  settingsService.reset();
  await seed.loadDemo(db, { password: 'harlow-demo' });
  const server = await new Promise((resolve) => {
    const s = createApp(db).listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db, base,
    client: () => new Client(base),
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      db.close();
      settingsService.reset();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

class Client {
  constructor(base) {
    this.base = base;
    this.cookies = {};
    this.csrf = null;
  }

  cookieHeader() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  remember(response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const at = pair.indexOf('=');
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const expired = attrs.some((a) => /expires=Thu, 01 Jan 1970/i.test(a)) || !value;
      if (expired) delete this.cookies[name];
      else this.cookies[name] = value;
    }
  }

  async request(method, url, { form, json, headers = {}, redirect = 'manual' } = {}) {
    const init = { method, redirect, headers: { cookie: this.cookieHeader(), ...headers } };
    if (form) {
      init.body = new URLSearchParams(form);
      init.headers['content-type'] = 'application/x-www-form-urlencoded';
    }
    if (json) {
      init.body = JSON.stringify(json);
      init.headers['content-type'] = 'application/json';
      init.headers.accept = 'application/json';
    }
    const response = await fetch(this.base + url, init);
    this.remember(response);
    const text = await response.text();
    const meta = text.match(/<meta name="csrf-token" content="([^"]+)"/);
    if (meta) this.csrf = meta[1];
    let body = text;
    if ((response.headers.get('content-type') || '').includes('application/json')) body = JSON.parse(text);
    return { status: response.status, headers: response.headers, body, text };
  }

  get(url) { return this.request('GET', url); }

  /* Form post with the page's CSRF token. */
  post(url, form = {}) { return this.request('POST', url, { form: { _csrf: this.csrf, ...form } }); }

  /* JSON call like the page scripts make. */
  api(url, json = {}) { return this.request('POST', url, { json, headers: { 'x-csrf-token': this.csrf || '' } }); }

  async login(email = 'elena.marsh@example.com', password = 'harlow-demo', extra = {}) {
    const page = await this.get('/login');
    const token = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
    const result = await this.request('POST', '/login', { form: { _csrf: token, email, password, shift: 'morning', ...extra } });
    if (result.status === 303) await this.get(result.headers.get('location'));
    return result;
  }
}

module.exports = { startHotel };
