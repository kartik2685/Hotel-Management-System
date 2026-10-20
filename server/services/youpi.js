'use strict';
const crypto = require('node:crypto');

const required = ['YOUPI_API_URL', 'YOUPI_MERCHANT_ID', 'YOUPI_WEBHOOK_SECRET'];

function config(env = process.env) {
  const missing = required.filter((key) => !String(env[key] || '').trim());
  if (missing.length) throw Object.assign(new Error(`YOUPI is not configured: ${missing.join(', ')}.`), { status: 503, code: 'YOUPI_NOT_CONFIGURED' });
  let api;
  try { api = new URL(env.YOUPI_API_URL); } catch { throw Object.assign(new Error('YOUPI_API_URL must be a valid URL.'), { status: 503 }); }
  const localHttp = api.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(api.hostname);
  if (api.protocol !== 'https:' && !(localHttp && env.YOUPI_ALLOW_INSECURE_HTTP === '1')) {
    throw Object.assign(new Error('YOUPI_API_URL must use HTTPS (HTTP is allowed only for explicit localhost testing).'), { status: 503 });
  }
  if (api.username || api.password || api.search || api.hash) throw Object.assign(new Error('YOUPI_API_URL must not contain credentials, query parameters or a fragment.'), { status: 503 });
  return { api, merchantId: String(env.YOUPI_MERCHANT_ID).trim(), webhookSecret: String(env.YOUPI_WEBHOOK_SECRET) };
}

function checkoutOrigin(env, api) {
  const configured = env.YOUPI_CHECKOUT_ORIGIN;
  const value = configured ? new URL(configured) : api;
  const localHttp = value.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(value.hostname);
  if (value.protocol !== 'https:' && !(localHttp && env.YOUPI_ALLOW_INSECURE_HTTP === '1')) {
    throw Object.assign(new Error('YOUPI_CHECKOUT_ORIGIN must use HTTPS outside localhost testing.'), { status: 503 });
  }
  return value.origin;
}

function isConfigured(env = process.env) {
  try { config(env); return true; } catch { return false; }
}

async function createCheckout(details, env = process.env) {
  const { api, merchantId } = config(env);
  const key = String(details.idempotencyKey || '').trim();
  if (!key) throw new TypeError('Checkout requires a stable idempotency key.');
  const body = {
    orderId: details.orderId,
    amount: (details.amountCents / 100).toFixed(2),
    currency: 'INR',
    returnUrl: details.returnUrl,
    description: `Hotel reservation ${details.confirmation}`,
    metadata: { reservationId: String(details.reservationId), confirmation: details.confirmation },
  };
  let response;
  try {
    response = await fetch(new URL('/api/v1/payments', api), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-merchant-id': merchantId, 'idempotency-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(env.YOUPI_REQUEST_TIMEOUT_MS) || 10000),
    });
  } catch {
    throw Object.assign(new Error('Could not reach the YOUPI payment API. The checkout can be retried safely.'), { status: 502, code: 'YOUPI_NETWORK_ERROR', retryable: true });
  }
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw Object.assign(new Error(`YOUPI rejected checkout creation (HTTP ${response.status}).`), { status: retryable ? 502 : 422, code: 'YOUPI_API_ERROR', retryable });
  }
  let result;
  try { result = await response.json(); } catch { throw Object.assign(new Error('YOUPI returned an unreadable checkout response.'), { status: 502 }); }
  let checkoutUrl;
  try {
    checkoutUrl = new URL(String(result.checkoutUrl || ''));
  } catch {
    throw Object.assign(new Error('YOUPI returned an unreadable checkout URL.'), { status: 502, code: 'YOUPI_BAD_CHECKOUT_URL' });
  }
  const allowedOrigin = checkoutOrigin(env, api);
  if (checkoutUrl.origin !== allowedOrigin || !['https:', 'http:'].includes(checkoutUrl.protocol)) {
    throw Object.assign(new Error('YOUPI returned a checkout URL outside the configured checkout origin.'), { status: 502, code: 'YOUPI_UNTRUSTED_CHECKOUT_URL' });
  }
  if (!result.paymentId || String(result.orderId) !== String(details.orderId)) {
    throw Object.assign(new Error('YOUPI response did not match the requested order.'), { status: 502, code: 'YOUPI_ORDER_MISMATCH' });
  }
  if (result.amountPaise !== undefined && Number(result.amountPaise) !== details.amountCents) {
    throw Object.assign(new Error('YOUPI returned an amount that does not match the hotel balance.'), { status: 502, code: 'YOUPI_AMOUNT_MISMATCH' });
  }
  return { paymentId: String(result.paymentId), checkoutUrl: checkoutUrl.toString(), status: String(result.status || 'ACTIVE').toLowerCase() };
}

function verifyWebhook(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  const suppliedHex = String(signature).replace(/^sha256=/i, '');
  if (!/^[a-f0-9]{64}$/i.test(suppliedHex)) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const supplied = Buffer.from(suppliedHex, 'hex');
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

module.exports = { config, isConfigured, createCheckout, verifyWebhook };
