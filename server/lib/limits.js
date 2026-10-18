'use strict';
/* Small in-memory rate limiter (one server process). hit() returns false once `max` hits fall in the window. */
const buckets = new Map();

function hit(key, max, windowMs) {
  const now = Date.now();
  const list = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    buckets.set(key, list);
    return false;
  }
  list.push(now);
  buckets.set(key, list);
  if (buckets.size > 10000) for (const [k, v] of buckets) if (!v.some((t) => now - t < 3600000)) buckets.delete(k);
  return true;
}

const reset = () => buckets.clear();

module.exports = { hit, reset };
