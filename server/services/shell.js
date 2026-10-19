'use strict';
/* Data for the page frame: sidebar, top bar, account menu. */
const f = require('../lib/format');
const clock = require('../lib/clock');
const { can } = require('../lib/security');
const { signOutToken } = require('../lib/auth');
const settingsService = require('./settings');
const stats = require('./stats');
const rooms = require('./rooms');
const reservations = require('./reservations');

const SHIFT_LABEL = { morning: 'Morning shift', evening: 'Evening shift', night: 'Night audit' };

function shiftInfo(settings, shift) {
  const hours = (settings.shifts && settings.shifts[shift]) || ['', ''];
  return { label: SHIFT_LABEL[shift] || 'Morning shift', hours: `${hours[0]}–${hours[1]}` };
}

function build(db, req, active) {
  const settings = settingsService.all(db);
  const bd = settingsService.businessDate(db);
  const now = clock.hotelNow(settings.timezone);
  const user = req.user;
  const states = rooms.roomStates(db, bd);
  const roomCounts = rooms.summarize(states);
  const tonight = stats.night(db, bd);
  const tasks = db.get('SELECT COUNT(*) AS total, COUNT(done_at) AS done FROM housekeeping_tasks WHERE task_date = ?', bd);
  const frontOffice = can(user, 'frontOffice');

  const nav = [];
  if (frontOffice) {
    const listed = reservations.listCount(db, bd);
    nav.push({
      label: 'Front office',
      items: [
        { key: 'dashboard', href: '/dashboard', icon: 'dashboard', label: 'Dashboard' },
        { key: 'reservations', href: '/reservations', icon: 'calendar-check', label: 'Reservations', badge: listed || '' },
        { key: 'tape-chart', href: '/tape-chart', icon: 'tape-chart', label: 'Tape chart' },
        { key: 'guests', href: '/guests', icon: 'users', label: 'Guests' },
      ],
    });
  }
  nav.push({
    label: 'Operations',
    items: [
      { key: 'rooms', href: '/rooms', icon: 'bed', label: 'Rooms', badge: roomCounts.dirty ? `${roomCounts.dirty} dirty` : '', warn: true },
      { key: 'housekeeping', href: '/housekeeping', icon: 'sparkles', label: 'Housekeeping', badge: tasks.total ? `${Math.round((tasks.done / tasks.total) * 100)}%` : '' },
    ],
  });
  // Managers and admins: the admin panel in plain sight, not only in the account menu.
  if (can(user, 'manage')) {
    const items = [{ key: 'admin', href: '/admin', icon: 'wrench', label: 'Admin panel' }];
    if (can(user, 'administer')) items.push({ key: 'admin-staff', href: '/admin/staff', icon: 'key', label: 'Staff accounts' });
    nav.push({ label: 'Admin', items });
  }

  const notifications = db.all(
    `SELECT n.*, (SELECT 1 FROM notification_reads nr WHERE nr.notification_id = n.id AND nr.user_id = ?) AS seen
       FROM notifications n ORDER BY n.created_at DESC, n.id DESC LIMIT 6`, user.id,
  ).map((n) => ({ ...n, unread: !n.seen, ago: f.timeAgo(n.created_at, `${now.date} ${now.time}`) }));

  const shift = shiftInfo(settings, req.session.shift || user.user_shift);
  const signOut = `/logout?t=${signOutToken(req.session)}`;
  const accountLinks = [{ href: '/housekeeping', label: 'Shift task sheet' }];
  if (frontOffice) accountLinks.push({ href: '/handover', label: 'Add a handover note' });
  if (can(user, 'manage')) accountLinks.push({ href: '/admin', label: 'Admin panel' });
  accountLinks.push({ href: '/account', label: 'Change password' }, { href: signOut, label: 'Sign out' });

  return {
    active,
    home: frontOffice ? '/dashboard' : '/housekeeping',
    csrf: req.session.csrf_token,
    signOut,
    hotel: { name: settings.hotel_name, meta: [settings.hotel_city, f.plural(roomCounts.total, 'room', 'rooms')].filter(Boolean).join(' · ') },
    businessDate: f.formatDay(bd),
    nav,
    tonight: { pct: f.pct1(tonight.sold, tonight.rooms), sold: tonight.sold, total: tonight.rooms, available: Math.max(0, tonight.rooms - tonight.sold) },
    user: { name: user.name, title: user.title, initials: f.initials(user.name), tone: user.avatar_tone, shiftLabel: shift.label, shiftHours: shift.hours },
    notifications,
    unread: notifications.filter((n) => n.unread).length,
    accountLinks,
    currency: { symbol: settings.currency_symbol, locale: settings.currency_locale || 'en-US' },
    tax: { mode: settings.tax_mode, rate: settings.tax_rate },
    // shared with page builders
    settings, bd, now, states, roomCounts, night: tonight, tasks,
  };
}

module.exports = { build, shiftInfo, SHIFT_LABEL };
