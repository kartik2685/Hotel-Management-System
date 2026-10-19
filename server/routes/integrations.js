'use strict';
const express = require('express');
const integrations = require('../services/integrations');
const clock = require('../lib/clock');
const onlinePayments = require('../services/online-payments');

const router = express.Router();

/* YOUPI webhook: signature is checked against the exact raw JSON bytes before parsing or recording. */
router.post('/youpi/webhook', (req, res, next) => {
  try {
    const signature = req.get('x-gateway-signature');
    const result = onlinePayments.processWebhook(req.db, req, req.rawBody, signature);
    return res.status(['unmatched', 'review'].includes(result.status) ? 202 : 200).json({ accepted: true, ...result });
  } catch (error) {
    if (error.status === 400 || error.status === 401 || error.status === 503) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
});

/* Generic partner webhook contract: timestamp + raw JSON body, signed with HMAC-SHA256. */
router.post('/channel-manager/events', async (req, res, next) => {
  try {
    const secret = process.env.CHANNEL_MANAGER_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ error: 'Channel-manager webhooks are not configured.' });
    const timestamp = req.get('x-channel-timestamp');
    const signature = req.get('x-channel-signature');
    if (!integrations.validChannelSignature({ rawBody: req.rawBody, signature, timestamp, secret })) {
      return res.status(401).json({ error: 'Invalid or expired webhook signature.' });
    }
    const provider = req.get('x-channel-manager-provider') || process.env.CHANNEL_MANAGER_PROVIDER || 'generic';
    const result = await integrations.acceptChannelEvent(req.db, provider, req.body || {}, clock.stamp(req.settings.timezone));
    return res.status(result.duplicate ? 200 : 202).json({ accepted: true, ...result });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
