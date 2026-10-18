'use strict';
/* Wording of the emails the system sends. Plain text, so they read well in every mail app. */
const f = require('../lib/format');

const signature = (s) => [`${s.hotel_name}`, s.hotel_address, s.hotel_phone, s.hotel_email].filter(Boolean).join('\n');

function bookingConfirmed(s, b, manageUrl) {
  const nights = f.daysBetween(b.arrival, b.departure);
  return {
    to: b.email,
    subject: `Your booking ${b.confirmation} at ${s.hotel_name}`,
    text: [
      `Dear ${b.first_name},`, '',
      `Thank you for booking with us. Your stay is confirmed.`, '',
      `Confirmation: ${b.confirmation}`,
      `Room: ${b.type_name}${b.room_number ? ` (room ${b.room_number})` : ''}`,
      `Arrival: ${f.formatDay(b.arrival)}, from ${s.check_in_time}`,
      `Departure: ${f.formatDay(b.departure)}, by ${s.check_out_time}`,
      `Guests: ${f.guestCount(b.adults, b.children, ', ')} · ${f.plural(nights, 'night', 'nights')}`,
      `Rate: ${b.plan_name || 'Room only'}`,
      `Total: ${f.money(b.total_cents)} (pay at the hotel)`, '',
      manageUrl ? `See or cancel your booking: ${manageUrl}` : '',
      s.site_policies ? `\n${s.site_policies}` : '', '',
      'We look forward to welcoming you.', '', signature(s),
    ].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n'),
  };
}

function bookingCancelled(s, b) {
  return {
    to: b.email,
    subject: `Booking ${b.confirmation} cancelled`,
    text: [`Dear ${b.first_name},`, '', `Your booking ${b.confirmation} for ${f.formatDay(b.arrival)} → ${f.formatDay(b.departure)} has been cancelled.`,
      'If this was a mistake, reply to this email or call us and we will help.', '', signature(s)].join('\n'),
  };
}

function passwordReset(s, user, link) {
  return {
    to: user.email,
    subject: `Reset your Frontdesk password`,
    text: [`Hello ${user.name.split(' ')[0]},`, '', 'Someone (hopefully you) asked to reset your Frontdesk password.', '',
      `Choose a new password here (the link works once, for one hour):`, link, '',
      'If you did not ask for this, ignore this email; your password stays the same.', '', signature(s)].join('\n'),
  };
}

module.exports = { bookingConfirmed, bookingCancelled, passwordReset };
