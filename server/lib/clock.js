'use strict';
/* The hotel's wall clock (in the hotel's time zone), optionally fixed for demos and tests. */
const config = require('../config');

function hotelNow(timeZone) {
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

module.exports = { hotelNow, stamp };
