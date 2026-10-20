'use strict';
/* Reads and validates submitted form fields; collects one friendly message per field. */
const f = require('./format');

class Form {
  constructor(body) {
    this.body = body || {};
    this.errors = {};
    this.values = {};
  }

  get ok() {
    return Object.keys(this.errors).length === 0;
  }

  raw(name) {
    const value = this.body[name];
    return Array.isArray(value) ? value[value.length - 1] : value;
  }

  fail(name, message) {
    if (!this.errors[name]) this.errors[name] = message;
    return null;
  }

  keep(name, value) {
    this.values[name] = value;
    return value;
  }

  text(name, { label = 'This field', max = 200, required = false, pattern = null, message = null } = {}) {
    const value = String(this.raw(name) ?? '').replace(/\s+/g, ' ').trim();
    this.keep(name, value);
    if (!value) return required ? this.fail(name, `${label} is required.`) : '';
    if (value.length > max) return this.fail(name, `${label} can be at most ${max} characters.`);
    if (pattern && !pattern.test(value)) return this.fail(name, message || `${label} doesn’t look right.`);
    return value;
  }

  /* Multi-line text; keeps line breaks. */
  longText(name, { label = 'This field', max = 1000, required = false } = {}) {
    const value = String(this.raw(name) ?? '').replace(/\r\n/g, '\n').trim();
    this.keep(name, value);
    if (!value) return required ? this.fail(name, `${label} is required.`) : '';
    if (value.length > max) return this.fail(name, `${label} can be at most ${max} characters.`);
    return value;
  }

  int(name, { label = 'This number', min = 0, max = 1e9, required = true } = {}) {
    const text = String(this.raw(name) ?? '').trim();
    this.keep(name, text);
    if (!text) return required ? this.fail(name, `${label} is required.`) : null;
    if (!/^-?\d+$/.test(text)) return this.fail(name, `${label} must be a whole number.`);
    const value = Number(text);
    if (value < min || value > max) return this.fail(name, `${label} must be between ${min} and ${max}.`);
    return value;
  }

  /* "1,234.50" or "1.234,50" -> 123450 (cents): the locale's decimal mark is read as one */
  money(name, { label = 'The amount', min = 0, max = 1e8, required = true } = {}) {
    const raw = String(this.raw(name) ?? '').trim();
    this.keep(name, raw);
    if (!raw) return required ? this.fail(name, `${label} is required.`) : null;
    const cents = f.parseMoney(raw);
    if (cents === null) return this.fail(name, `${label} must be a number like 120 or 120.50.`);
    if (cents < Math.round(min * 100) || cents > Math.round(max * 100)) return this.fail(name, `${label} must be between ${min} and ${max}.`);
    return cents;
  }

  /* "12.5" -> 12.5 */
  decimal(name, { label = 'This number', min = 0, max = 100, required = true } = {}) {
    const text = String(this.raw(name) ?? '').trim();
    this.keep(name, text);
    if (!text) return required ? this.fail(name, `${label} is required.`) : null;
    if (!/^\d+(\.\d{1,3})?$/.test(text)) return this.fail(name, `${label} must be a number like 5 or 17.49.`);
    const value = Number(text);
    if (value < min || value > max) return this.fail(name, `${label} must be between ${min} and ${max}.`);
    return value;
  }

  date(name, { label = 'The date', required = true } = {}) {
    const value = String(this.raw(name) ?? '').trim();
    this.keep(name, value);
    if (!value) return required ? this.fail(name, `${label} is required.`) : null;
    if (!f.isDate(value)) return this.fail(name, `${label} must be a date.`);
    return value;
  }

  time(name, { label = 'The time', required = true } = {}) {
    const value = String(this.raw(name) ?? '').trim();
    this.keep(name, value);
    if (!value) return required ? this.fail(name, `${label} is required.`) : null;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return this.fail(name, `${label} must be a time like 15:00.`);
    return value;
  }

  email(name, { label = 'Email', required = true } = {}) {
    return this.text(name, { label, max: 120, required, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'That email doesn’t look right.' })?.toLowerCase() ?? null;
  }

  bool(name) {
    const value = this.raw(name);
    const on = value === 'on' || value === '1' || value === 'true' || value === true;
    this.keep(name, on);
    return on;
  }

  oneOf(name, options, { label = 'This field', required = true } = {}) {
    const value = String(this.raw(name) ?? '').trim();
    this.keep(name, value);
    if (!value) return required ? this.fail(name, `Choose ${label.toLowerCase()}.`) : null;
    if (!options.includes(value)) return this.fail(name, `Choose ${label.toLowerCase()} from the list.`);
    return value;
  }

  /* One item per line (or comma separated): ["High floor", "King bed"] */
  list(name, { max = 12, maxLength = 60 } = {}) {
    const text = String(this.raw(name) ?? '');
    this.keep(name, text);
    const items = [...new Set(text.split(/[\n,]/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean))];
    if (items.length > max) return this.fail(name, `Keep it to ${max} items.`) || [];
    if (items.some((x) => x.length > maxLength)) return this.fail(name, `Each item can be at most ${maxLength} characters.`) || [];
    return items;
  }
}

module.exports = { Form };
