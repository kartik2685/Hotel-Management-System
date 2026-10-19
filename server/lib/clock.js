'use strict';
/* The hotel's wall clock (in the hotel's time zone), optionally fixed for demos and tests. */
const config = require('../config');

// Set only while db/sample.js writes the sample hotel's history: every booking, payment and log line it
// creates through the normal services is stamped with the moment it happened, not with today.
let travel = null;

function hotelNow(timeZone) {
  if (travel) return { ...travel };
  if (config.fixedNow) {
    const [date, time = '00:00'] = config.fixedNow.split('T');
    return { date, time: time.slice(0, 5) };
  }
  const parts = {};
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  for (const part of formatter.formatToParts(new Date())) parts[part.type] = part.value;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/* "YYYY-MM-DD HH:MM" in hotel time. */
const stamp = (timeZone) => {
  const now = hotelNow(timeZone);
  return `${now.date} ${now.time}`;
};

/* Runs fn as if the hotel clock showed `when` ("YYYY-MM-DD HH:MM"). fn must be synchronous, so no other
   request can run (and see the borrowed time) before the clock is back. */
function at(when, fn) {
  const before = travel;
  travel = { date: when.slice(0, 10), time: when.slice(11, 16) };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') throw new TypeError('clock.at() needs a synchronous function.');
    return result;
  } finally {
    travel = before;
  }
}

module.exports = { hotelNow, stamp, at };
