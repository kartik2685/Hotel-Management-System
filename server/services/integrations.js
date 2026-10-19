'use strict';
/*
 * Optional integration boundaries. Vendor credentials stay in environment variables, not hotel settings.
 * Register a vendor adapter here when its merchant account and API contract are available.
 */
const crypto = require('node:crypto');

const paymentAdapters = new Map();
const messageAdapters = new Map();
const channelAdapters = new Map();

function integrationStatus(env = process.env) {
  const paymentProvider = String(env.PAYMENT_PROVIDER || '').trim().toLowerCase();
  const messageProvider = String(env.MESSAGE_PROVIDER || 'manual').trim().toLowerCase();
  const channelProvider = String(env.CHANNEL_MANAGER_PROVIDER || '').trim().toLowerCase();
  const paymentAdapter = paymentAdapters.get(paymentProvider);
  const paymentConfigured = Boolean(paymentProvider && paymentAdapter?.isConfigured?.(env));
  const paymentStatus = !paymentProvider ? 'disabled' : paymentProvider === 'youpi' && env.PAYMENT_MODE !== 'test' ? 'test mode required' : paymentConfigured ? 'configured' : paymentAdapter ? 'configuration missing' : 'adapter required';
  return [
    {
      key: 'payments', label: 'Online payments', provider: paymentProvider || 'Not selected',
      status: paymentStatus,
      detail: paymentProvider === 'youpi' ? 'YOUPI is experimental and test-only. Set PAYMENT_MODE=test, configure authorized test credentials, then separately enable guest checkout in Admin → Payments. Not for production.' : paymentProvider ? 'A provider must be configured, registered and verified in an authorized test environment before use.' : 'No provider is selected; guests continue to pay at the hotel.',
    },
    {
      key: 'messaging', label: 'SMS and WhatsApp', provider: messageProvider,
      status: messageProvider === 'manual' ? 'manual links' : messageAdapters.has(messageProvider) ? 'ready' : 'adapter required',
      detail: messageProvider === 'manual' ? 'Staff send messages using the existing WhatsApp links. No automated messages are sent.' : 'Provider credentials and an approved sender are required.',
    },
    {
      key: 'channel-manager', label: 'Channel manager', provider: channelProvider || 'Not selected',
      status: channelProvider && channelAdapters.has(channelProvider) ? 'adapter ready' : env.CHANNEL_MANAGER_WEBHOOK_SECRET ? 'signed inbox ready' : 'not configured',
      detail: 'A signed generic inbox can deduplicate partner events; inventory and booking changes need a partner-specific adapter.',
    },
    {
      key: 'properties', label: 'Multiple properties', provider: 'Single property mode', status: 'not enabled',
      detail: 'Tenant isolation is not implemented. Do not point multiple hotels at the same database.',
    },
  ];
}

function registerPaymentAdapter(name, adapter) {
  if (!adapter || typeof adapter.createCheckout !== 'function' || typeof adapter.verifyWebhook !== 'function') {
    throw new TypeError('A payment adapter needs createCheckout() and verifyWebhook().');
  }
  paymentAdapters.set(String(name).toLowerCase(), adapter);
}
function registerMessageAdapter(name, adapter) {
  if (!adapter || typeof adapter.send !== 'function') throw new TypeError('A message adapter needs send().');
  messageAdapters.set(String(name).toLowerCase(), adapter);
}
function registerChannelAdapter(name, adapter) {
  if (!adapter || typeof adapter.processEvent !== 'function') throw new TypeError('A channel adapter needs processEvent().');
  channelAdapters.set(String(name).toLowerCase(), adapter);
}

async function createCheckout(details, env = process.env) {
  const provider = String(env.PAYMENT_PROVIDER || '').toLowerCase();
  const adapter = paymentAdapters.get(provider);
  if (!adapter) throw Object.assign(new Error('Online checkout is not enabled. Configure a payment provider adapter first.'), { status: 503, code: 'PAYMENT_ADAPTER_MISSING' });
  return adapter.createCheckout(details, env);
}

async function sendMessage(message, env = process.env) {
  const provider = String(env.MESSAGE_PROVIDER || 'manual').toLowerCase();
  const adapter = messageAdapters.get(provider);
  if (!adapter) throw Object.assign(new Error('Automated messaging is not enabled. Use the current manual links or configure a provider adapter.'), { status: 503, code: 'MESSAGE_ADAPTER_MISSING' });
  return adapter.send(message, env);
}

function validChannelSignature({ rawBody, signature, timestamp, secret, now = Date.now() }) {
  if (!secret || !rawBody || !signature || !timestamp) return false;
  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds) || Math.abs(Math.floor(now / 1000) - seconds) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  const receivedHex = String(signature).replace(/^sha256=/i, '');
  if (!/^[a-f0-9]{64}$/i.test(receivedHex)) return false;
  const received = Buffer.from(receivedHex, 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

async function acceptChannelEvent(db, provider, body, receivedAt) {
  const eventId = String(body.event_id || body.id || '').trim().slice(0, 160);
  const eventType = String(body.event_type || body.type || '').trim().slice(0, 120);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(eventId) || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(eventType)) {
    throw Object.assign(new Error('Webhook body needs a valid event_id and event_type.'), { status: 400 });
  }

  const name = String(provider || 'generic').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,59}$/.test(name)) throw Object.assign(new Error('Invalid channel-manager provider name.'), { status: 400 });
  const existing = db.get('SELECT id FROM integration_events WHERE provider = ? AND external_event_id = ? AND direction = ?', name, eventId, 'inbound');
  db.run(
    `INSERT INTO integration_events (provider, external_event_id, event_type, direction, status, received_at)
     VALUES (?, ?, ?, 'inbound', 'pending_adapter', ?) ON CONFLICT (provider, external_event_id, direction) DO NOTHING`,
    name, eventId, eventType, receivedAt,
  );
  const event = db.get('SELECT id, status FROM integration_events WHERE provider = ? AND external_event_id = ? AND direction = ?', name, eventId, 'inbound');
  const adapter = channelAdapters.get(name);
  if (adapter && (!existing || event.status === 'failed')) {
    try {
      await adapter.processEvent({ db, eventId, eventType, body });
      db.run("UPDATE integration_events SET status = 'processed', processed_at = ? WHERE id = ?", receivedAt, event.id);
      return { id: event.id, duplicate: false, status: 'processed' };
    } catch (error) {
      db.run("UPDATE integration_events SET status = 'failed' WHERE id = ?", event.id);
      throw error;
    }
  }
  return { id: event.id, duplicate: Boolean(existing), status: existing ? event.status : 'pending_adapter' };
}

module.exports = {
  integrationStatus, registerPaymentAdapter, registerMessageAdapter, registerChannelAdapter,
  createCheckout, sendMessage, validChannelSignature, acceptChannelEvent,
};
