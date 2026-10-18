'use strict';
/* Audit trail: who changed what, and when. */
const clock = require('./clock');

function log(db, req, action, summary) {
  const user = req && req.user;
  db.run(
    'INSERT INTO activity_log (user_id, user_name, action, summary, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    user ? user.id : null, user ? user.name : 'System', action, String(summary).slice(0, 500), (req && req.ip) || null, clock.stamp(req && req.settings && req.settings.timezone),
  );
}

module.exports = { log };
