'use strict';
/* Group bookings (services/groups.js): the list, a new group, and a group's page with check-in for everyone
   arriving, a shared payment and one invoice for the group. */
const express = require('express');
const { requireAbility, can } = require('../lib/security');
const shellService = require('../services/shell');
const groups = require('../services/groups');
const billing = require('../services/billing');
const reservations = require('../services/reservations');
const settingsService = require('../services/settings');

const router = express.Router();

const FLASH = {
  created: 'Group booked: every room is a booking of its own. Add the guests’ names on each booking when the rooming list comes.',
  payment: 'Payment recorded and shared out over the rooms that owed.',
};

function page(req, res, view, data, status = 200) {
  const shell = shellService.build(req.db, req, 'reservations');
  res.status(status).render(`pages/${view}`, {
    page: view, css: ['pages/admin'], scripts: [], shell, canBook: can(req.user, 'bookings'), errors: {}, values: {}, flash: FLASH[req.query.ok] || '', ...data,
  });
}

function groupPage(req, res, next, extra = {}, status = 200) {
  let d;
  try {
    d = groups.detail(req.db, req.params.id);
  } catch (error) {
    return error.status === 404 ? next() : next(error);
  }
  page(req, res, 'group', {
    title: `${d.g.name} · Group ${d.g.code} · Frontdesk Hotel Management`, description: `Group booking ${d.g.code}.`,
    d, methods: billing.METHODS, payErrors: {}, payValues: {}, invErrors: {}, invValues: {}, result: null, actionError: '', ...extra,
  }, status);
}

router.get('/groups', requireAbility('frontOffice'), (req, res) => {
  page(req, res, 'groups', { title: 'Groups · Frontdesk Hotel Management', description: 'Group bookings.', rows: groups.list(req.db) });
});

router.get('/groups/new', requireAbility('bookings'), (req, res) => {
  page(req, res, 'group-new', { title: 'New group booking · Frontdesk Hotel Management', description: 'Book several rooms together.', ...groups.formData(req.db), bd: settingsService.businessDate(req.db) });
});

router.post('/groups', requireAbility('bookings'), (req, res, next) => {
  try {
    const id = groups.create(req.db, req, req.body);
    res.redirect(303, `/groups/${id}?ok=created`);
  } catch (error) {
    if (error instanceof reservations.FormError) {
      return page(req, res, 'group-new', {
        title: 'New group booking · Frontdesk Hotel Management', description: 'Book several rooms together.', ...groups.formData(req.db),
        bd: settingsService.businessDate(req.db), errors: error.errors, values: error.values,
      }, 422);
    }
    next(error);
  }
});

router.get('/groups/:id', requireAbility('frontOffice'), (req, res, next) => groupPage(req, res, next));

router.post('/groups/:id/check-in', requireAbility('bookings'), (req, res, next) => {
  try {
    const result = groups.checkInAll(req.db, req, req.params.id);
    groupPage(req, res, next, { result });
  } catch (error) {
    if (error.status === 404) return next();
    next(error);
  }
});

router.post('/groups/:id/payment', requireAbility('bookings'), (req, res, next) => {
  try {
    groups.pay(req.db, req, req.params.id, req.body);
    res.redirect(303, `/groups/${encodeURIComponent(req.params.id)}?ok=payment`);
  } catch (error) {
    if (error instanceof reservations.FormError) return groupPage(req, res, next, { payErrors: error.errors, payValues: error.values }, 422);
    if (error.status === 404) return next();
    next(error);
  }
});

router.post('/groups/:id/invoice', requireAbility('bookings'), (req, res, next) => {
  try {
    const id = billing.createGroupInvoice(req.db, req, Number.parseInt(req.params.id, 10) || 0, req.body);
    res.redirect(303, `/invoices/${id}`);
  } catch (error) {
    if (error instanceof reservations.FormError) return groupPage(req, res, next, { invErrors: error.errors, invValues: error.values }, 422);
    if (error.status === 422) return groupPage(req, res, next, { actionError: error.message }, 422);
    if (error.status === 404) return next();
    next(error);
  }
});

module.exports = router;
