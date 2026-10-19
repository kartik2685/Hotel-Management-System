'use strict';
/* Every table of the app, parents before children: the order data can be copied in (copy.js).
   test/postgres.test.js checks this list against both schemas. */
module.exports = [
  'settings', 'users', 'sessions', 'login_attempts', 'room_types', 'rooms', 'room_blocks', 'rate_plans', 'rate_seasons', 'extras', 'sources',
  'booking_groups', 'guests', 'guest_notes', 'reservations', 'reservation_extras', 'folio_charges', 'housekeeping_tasks', 'handover_notes', 'notifications',
  'notification_reads', 'daily_stats', 'revenue', 'activity_log', 'payments', 'invoices', 'outbox', 'password_resets',
];
