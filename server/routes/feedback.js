'use strict';
/* The guest's feedback page (services/feedback.js): opened from the signed link in the thank-you message, with no
   sign-in, and working even when the website is switched off. */
const express = require('express');
const feedback = require('../services/feedback');

const router = express.Router();

function page(req, res, b, extra = {}, status = 200) {
  res.status(status).render('pages/feedback', {
    hotel: req.settings, b, t: feedback.token(req.db, b.confirmation), answer: b.answer, reviewUrl: req.settings.review_url || '',
    errors: {}, values: {}, stars: feedback.stars, ...extra,
  });
}

router.get('/feedback/:confirmation', (req, res, next) => {
  const b = feedback.find(req.db, req.params.confirmation, req.query.t);
  if (!b) return next();
  page(req, res, b);
});

router.post('/feedback/:confirmation', (req, res, next) => {
  const b = feedback.find(req.db, req.params.confirmation, req.body.t);
  if (!b) return next();
  const result = feedback.save(req.db, b, req.body);
  if (result.errors) return page(req, res, b, { errors: result.errors, values: result.values }, 422);
  res.redirect(303, feedback.pathOf(req.db, b.confirmation));
});

module.exports = router;
