'use strict';
/* GSTR-1 for one month, from the GST invoices the hotel issued (as printed on each invoice):
   - B2B: invoices billed to a GSTIN, one row per tax rate;
   - B2CL: inter-state invoices above ₹1,00,000 without a GSTIN (rare for a hotel: a stay is supplied where
     the hotel is);
   - B2CS: every other invoice, summed by place of supply and rate;
   - HSN: the SAC summary, B2B and B2C apart;
   - nil rated: lines billed without GST (extras);
   - documents issued: each invoice series with its first and last number and how many were cancelled.
   Cancelled invoices only count in the documents issued. Amounts are in paise. */
const settingsService = require('./settings');
const f = require('../lib/format');

const STATES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', 10: 'Bihar', 11: 'Sikkim', 12: 'Arunachal Pradesh', 13: 'Nagaland',
  14: 'Manipur', 15: 'Mizoram', 16: 'Tripura', 17: 'Meghalaya', 18: 'Assam', 19: 'West Bengal', 20: 'Jharkhand', 21: 'Odisha',
  22: 'Chhattisgarh', 23: 'Madhya Pradesh', 24: 'Gujarat', 26: 'Dadra and Nagar Haveli and Daman and Diu', 27: 'Maharashtra',
  28: 'Andhra Pradesh (Old)', 29: 'Karnataka', 30: 'Goa', 31: 'Lakshadweep', 32: 'Kerala', 33: 'Tamil Nadu', 34: 'Puducherry',
  35: 'Andaman and Nicobar Islands', 36: 'Telangana', 37: 'Andhra Pradesh', 38: 'Ladakh', 97: 'Other Territory',
};
const SAC_NAMES = {
  996311: 'Accommodation services', 996331: 'Food and beverage services', 999719: 'Laundry services',
  999723: 'Spa and wellness services', 996601: 'Passenger transport with operator', 999799: 'Other services',
};
const B2CL_ABOVE = 100000 * 100; // ₹1,00,000

const isMonth = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));
const lastDay = (month) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* "05-Oct-2026", the date format of the GST offline tool. */
const gstDate = (iso) => `${iso.slice(8, 10)}-${MONTHS[Number(iso.slice(5, 7)) - 1]}-${iso.slice(0, 4)}`;

/* "19-West Bengal": where a stay is supplied (the hotel's state), from its GSTIN or its state setting. */
function placeOfSupply(settings) {
  let code = /^\d{2}/.test(settings.tax_id || '') ? settings.tax_id.slice(0, 2) : '';
  if (!code && settings.hotel_state) code = Object.keys(STATES).find((k) => STATES[k].toLowerCase() === settings.hotel_state.toLowerCase()) || '';
  code = code ? String(code).padStart(2, '0') : '';
  return code && STATES[code] ? `${code}-${STATES[code]}` : '';
}

/* Tax per rate on one invoice (invoices before charges had a single rate). */
const ratesOf = (d) => (Array.isArray(d.taxes) && d.taxes.length ? d.taxes : [{ rate: d.percent, taxable: d.taxable, tax: d.tax, cgst: d.cgst, sgst: d.sgst, igst: d.igst }]);

/* Taxed lines with their rate and tax (older invoices: the room line carries the invoice's rate). */
function linesOf(d) {
  return d.lines.filter((l) => l.taxed).map((l) => {
    if (l.rate !== undefined) return l;
    const shown = / · (\d+(?:\.\d+)?)%$/.exec(l.text);
    const rate = shown ? Number(shown[1]) : d.percent;
    return { ...l, rate, tax: Math.round((l.amount * rate) / 100) };
  });
}

const split = (tax, interstate) => (interstate ? { igst: tax, cgst: 0, sgst: 0 } : { igst: 0, cgst: Math.floor(tax / 2), sgst: tax - Math.floor(tax / 2) });

function build(db, month) {
  const settings = settingsService.all(db);
  const from = `${month}-01`;
  const to = lastDay(month);
  const pos = placeOfSupply(settings);
  const all = db.all('SELECT id, number, status, data FROM invoices ORDER BY id')
    .map((row) => ({ ...row, d: JSON.parse(row.data) }))
    .filter((inv) => inv.d.gst && inv.d.date >= from && inv.d.date <= to);
  const issued = all.filter((inv) => inv.status !== 'cancelled');

  const b2b = [];
  const b2cl = [];
  const b2cs = new Map();
  const hsn = new Map();
  const nil = { b2b: 0, b2c: 0 };
  const byRate = new Map();
  const totals = { b2b: { invoices: 0, value: 0, taxable: 0, tax: 0 }, b2c: { invoices: 0, value: 0, taxable: 0, tax: 0 } };

  for (const inv of issued) {
    const d = inv.d;
    const kind = d.billTo && d.billTo.gstin ? 'b2b' : 'b2c';
    const rates = ratesOf(d).filter((t) => t.taxable > 0);
    totals[kind].invoices += 1;
    totals[kind].value += d.total;
    for (const t of rates) {
      totals[kind].taxable += t.taxable;
      totals[kind].tax += t.tax;
      const r = byRate.get(t.rate) || { rate: t.rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
      r.taxable += t.taxable;
      r.igst += t.igst;
      r.cgst += t.cgst;
      r.sgst += t.sgst;
      byRate.set(t.rate, r);
      if (kind === 'b2b') {
        b2b.push({ gstin: d.billTo.gstin, name: d.billTo.name, number: d.number, date: d.date, value: d.total, pos, rate: t.rate, taxable: t.taxable, tax: t.tax });
      } else if (d.interstate && d.total > B2CL_ABOVE) {
        b2cl.push({ number: d.number, date: d.date, value: d.total, pos, rate: t.rate, taxable: t.taxable, tax: t.tax });
      } else {
        const key = `${pos}|${t.rate}`;
        const row = b2cs.get(key) || { pos, rate: t.rate, taxable: 0, tax: 0 };
        row.taxable += t.taxable;
        row.tax += t.tax;
        b2cs.set(key, row);
      }
    }
    for (const l of linesOf(d)) {
      const key = `${kind}|${l.sac || ''}|${l.rate}`;
      const row = hsn.get(key) || { section: kind === 'b2b' ? 'B2B' : 'B2C', sac: l.sac || '', description: SAC_NAMES[l.sac] || 'Services', rate: l.rate, value: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
      const parts = split(l.tax, d.interstate);
      row.value += l.amount + l.tax;
      row.taxable += l.amount;
      row.igst += parts.igst;
      row.cgst += parts.cgst;
      row.sgst += parts.sgst;
      hsn.set(key, row);
    }
    for (const l of d.lines.filter((x) => !x.taxed)) nil[kind] += l.amount;
  }

  // Documents issued: one row per series ("INV/26-27/"), first and last number, how many, how many cancelled.
  const series = new Map();
  for (const inv of all) {
    const m = /^(.*?)(\d+)$/.exec(inv.number);
    const prefix = m ? m[1] : inv.number;
    const n = m ? Number(m[2]) : 0;
    const s = series.get(prefix) || { prefix, first: inv.number, last: inv.number, low: n, high: n, total: 0, cancelled: 0 };
    if (n < s.low) { s.low = n; s.first = inv.number; }
    if (n > s.high) { s.high = n; s.last = inv.number; }
    s.total += 1;
    if (inv.status === 'cancelled') s.cancelled += 1;
    series.set(prefix, s);
  }

  return {
    month, from, to, pos, hotelGstin: settings.tax_id || '', label: `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`,
    b2b, b2cl, b2cs: [...b2cs.values()].sort((a, b) => a.rate - b.rate), hsn: [...hsn.values()].sort((a, b) => a.section.localeCompare(b.section) || a.sac.localeCompare(b.sac) || a.rate - b.rate),
    nil, docs: [...series.values()], byRate: [...byRate.values()].sort((a, b) => a.rate - b.rate), totals, invoices: all.length, issued: issued.length,
  };
}

const rupees = (paise) => (paise / 100).toFixed(2);

/* The CSV files, with the GST offline tool's column names. */
function csv(r, part) {
  if (part === 'b2b') {
    return ['b2b', ['GSTIN/UIN of Recipient', 'Receiver Name', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Reverse Charge', 'Applicable % of Tax Rate', 'Invoice Type', 'E-Commerce GSTIN', 'Rate', 'Taxable Value', 'Cess Amount'],
      r.b2b.map((x) => [x.gstin, x.name, x.number, gstDate(x.date), rupees(x.value), x.pos, 'N', '', 'Regular B2B', '', x.rate, rupees(x.taxable), '0.00'])];
  }
  if (part === 'b2cl') {
    return ['b2cl', ['Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'],
      r.b2cl.map((x) => [x.number, gstDate(x.date), rupees(x.value), x.pos, '', x.rate, rupees(x.taxable), '0.00', ''])];
  }
  if (part === 'b2cs') {
    return ['b2cs', ['Type', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'],
      r.b2cs.map((x) => ['OE', x.pos, '', x.rate, rupees(x.taxable), '0.00', ''])];
  }
  if (part === 'hsn') {
    return ['hsn', ['Section', 'HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Rate', 'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount', 'State/UT Tax Amount', 'Cess Amount'],
      r.hsn.map((x) => [x.section, x.sac, x.description, 'NA', '0', rupees(x.value), x.rate, rupees(x.taxable), rupees(x.igst), rupees(x.cgst), rupees(x.sgst), '0.00'])];
  }
  if (part === 'exemp') {
    return ['exemp', ['Description', 'Nil Rated Supplies', 'Exempted(other than nil rated/non GST supply)', 'Non-GST Supplies'],
      [['Intra-State supplies to registered persons', rupees(r.nil.b2b), '0.00', '0.00'], ['Intra-State supplies to unregistered persons', rupees(r.nil.b2c), '0.00', '0.00']]];
  }
  if (part === 'docs') {
    return ['docs', ['Nature of Document', 'Sr. No. From', 'Sr. No. To', 'Total Number', 'Cancelled'],
      r.docs.map((x) => ['Invoices for outward supply', x.first, x.last, x.total, x.cancelled])];
  }
  return null;
}

const PARTS = ['b2b', 'b2cl', 'b2cs', 'hsn', 'exemp', 'docs'];

/* The month a return is usually being made for: the one before the business date. */
function defaultMonth(db) {
  const bd = settingsService.businessDate(db);
  const [y, m] = bd.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

module.exports = { build, csv, PARTS, isMonth, defaultMonth, gstDate, placeOfSupply, money: f.money };
