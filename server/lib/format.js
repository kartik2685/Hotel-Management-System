'use strict';
/* Text formatting shared by all pages. Output matches the browser code in assets/js/core.js. */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_MS = 864e5;
const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];

const parse = (iso) => new Date(iso.slice(0, 10) + 'T00:00:00Z');
const addDays = (iso, days) => new Date(parse(iso).getTime() + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((parse(to) - parse(from)) / DAY_MS);
const weekday = (iso) => parse(iso).getUTCDay();
/** A real calendar date in "YYYY-MM-DD" form: 2026-02-31 is not one (Date would roll it into March). */
const isDate = (value) => {
  const text = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text + 'T00:00:00Z'))) return false;
  return parse(text).toISOString().slice(0, 10) === text;
};

/** "2026-09-24" -> "Thu 24 Sep" */
const formatDay = (iso) => {
  const d = parse(iso);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
/** "2026-09-24" -> "24 Sep" (adds the year when it differs from `thisYear`) */
const dayMonth = (iso, thisYear) => {
  const d = parse(iso);
  const text = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return thisYear && String(d.getUTCFullYear()) !== String(thisYear).slice(0, 4) ? `${text} ${d.getUTCFullYear()}` : text;
};
/** "2026-09-24" -> "Thursday 24 September" */
const longDate = (iso) => {
  const d = parse(iso);
  return `${WEEKDAYS_LONG[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]}`;
};
const monthName = (iso) => MONTHS[parse(iso).getUTCMonth()];
/** Stay dates: "12–15 Jun" or "30 Sep – 3 Oct" */
const dateRange = (from, to) => {
  const a = parse(from);
  const b = parse(to);
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) {
    return `${a.getUTCDate()}–${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`;
  }
  return `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} – ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`;
};
/** "2026-09-24 09:15" -> "09:15" */
const clock = (stamp) => (stamp ? stamp.slice(11, 16) : '');

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const numberWord = (count) => (count < NUMBER_WORDS.length ? NUMBER_WORDS[count] : String(count));
const initials = (name) => name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
/** "T. Achterberg" */
const shortName = (first, last) => `${first.charAt(0)}. ${last}`;
/** "Marisol V." */
const firstAndInitial = (name) => {
  const [first, ...rest] = name.split(/\s+/);
  return rest.length ? `${first} ${rest[rest.length - 1].charAt(0)}.` : first;
};

let currency = { symbol: '$', locale: 'en-US' };
const setCurrency = (symbol, locale) => { currency = { symbol: symbol || '$', locale: locale || 'en-US' }; };
const grouped = (value, digits) => value.toLocaleString(currency.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
/** 103391 -> "$1,033.91" */
const money = (cents) => (cents < 0 ? '-' : '') + currency.symbol + grouped(Math.abs(cents) / 100, 2);
/** 846000 -> "$8,460" */
const moneyWhole = (cents) => (cents < 0 ? '-' : '') + currency.symbol + grouped(Math.round(Math.abs(cents) / 100), 0);
/** The locale's decimal mark: "." in en-US, "," in de-DE. */
let decimalMark = { locale: null, mark: '.' };
const decimalSeparator = () => {
  if (decimalMark.locale !== currency.locale) {
    const part = new Intl.NumberFormat(currency.locale).formatToParts(1.5).find((x) => x.type === 'decimal');
    decimalMark = { locale: currency.locale, mark: part ? part.value : '.' };
  }
  return decimalMark.mark;
};
/** Whole units and the decimal part separately: 24860 -> ["$248", ".60"], €1.234,56 -> ["€1.234", ",56"] */
const moneyParts = (cents) => {
  const text = money(cents);
  const at = text.lastIndexOf(decimalSeparator());
  return [text.slice(0, at), text.slice(at)];
};
const symbol = () => currency.symbol;

/** Money typed by staff or guests -> cents, or null when it is not an amount with at most two decimals.
    Reads "1,234.56" as well as the locale's own "1.234,56" and "1234,56": a comma decimal must not be taken
    for a thousands separator, which would make the amount 100 times too large. */
const parseMoney = (raw) => {
  let text = String(raw ?? '').trim();
  if (!text) return null;
  const negative = text.startsWith('-');
  text = text.replace(/[^\d.,]/g, '');
  if (!text) return null;
  const mark = decimalSeparator();
  const other = mark === '.' ? ',' : '.';
  // grouped thousands: 1,234,567 (international) or the Indian 1,23,456 (2,2,3)
  const grouped = (value) => {
    const parts = value.split(/[.,]/);
    if (parts.length < 2 || !/^\d{1,3}$/.test(parts[0])) return false;
    const rest = parts.slice(1);
    if (rest.every((p) => p.length === 3)) return true;
    return rest.length >= 2 && rest[rest.length - 1].length === 3 && rest.slice(0, -1).every((p) => p.length === 2) && /^\d{1,2}$/.test(parts[0]);
  };
  let whole = text;
  let fraction = '';
  if (text.includes('.') && text.includes(',')) {
    // both separators: the last one is the decimal point ("1.234,56" and "1,234.56" both work)
    const at = Math.max(text.lastIndexOf('.'), text.lastIndexOf(','));
    whole = text.slice(0, at);
    fraction = text.slice(at + 1);
    if (!grouped(whole)) return null;
  } else if (text.includes(mark)) {
    // the hotel's own decimal mark always means a decimal point: "1.234" is not 1,234 in en-US
    const parts = text.split(mark);
    if (parts.length > 2) {
      if (!grouped(text)) return null; // "1.234.567" (de) / "1,234,567" (en)
    } else {
      whole = parts[0];
      fraction = parts[1];
    }
  } else if (text.includes(other)) {
    const parts = text.split(other);
    if (parts.length > 2) {
      if (!grouped(text)) return null;
    } else if (grouped(text)) {
      whole = text;
    } else {
      // the other convention typed by a guest ("12,5" in a dot hotel) still means 12.50
      whole = parts[0];
      fraction = parts[1];
    }
  }
  whole = whole.replace(/[.,]/g, '');
  if (!/^\d{1,12}$/.test(whole) || (fraction && !/^\d{1,2}$/.test(fraction))) return null;
  const cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return negative && cents ? -cents : cents;
};

/** Percentage with at most one decimal: 87.5, 14.3, 50 */
const pct1 = (part, whole) => (whole ? String(Math.round((part / whole) * 1000) / 10) : '0');

/** "2 adults + 1 child" */
const guestCount = (adults, children, joiner = ' + ') =>
  plural(adults, 'adult', 'adults') + (children ? joiner + plural(children, 'child', 'children') : '');

/** Minutes between two "YYYY-MM-DD HH:MM" stamps -> "12m", "3h", "2d" */
const timeAgo = (then, now) => {
  const minutes = Math.max(0, Math.round((Date.parse(now.replace(' ', 'T') + ':00Z') - Date.parse(then.replace(' ', 'T') + ':00Z')) / 60000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / (60 * 24))}d`;
};

module.exports = {
  WEEKDAYS, MONTHS, DAY_MS, parse, addDays, daysBetween, weekday, isDate, formatDay, dayMonth, longDate, monthName, dateRange, clock,
  plural, numberWord, initials, shortName, firstAndInitial, setCurrency, money, moneyWhole, moneyParts, parseMoney, symbol, pct1, guestCount, timeAgo,
};
