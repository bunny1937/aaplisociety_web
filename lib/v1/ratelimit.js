// In-memory rate limiting for /v1 routes. Ported in spirit from
// mobile-backend src/middleware/rateLimit.ts.
//
// NOTE: on Vercel this is per-serverless-instance and resets on cold start,
// so under concurrency the effective limit is (limit * warmInstances). It
// still meaningfully throttles brute-force from a single client hitting a
// warm instance. For hard multi-instance guarantees, back this with a shared
// store (e.g. Upstash Redis) later. See V1_MIGRATION.md.
import { ApiError } from "./http";
import { clientIp } from "./auth";

const buckets = new Map();

// options: { windowMs, limit, key, skipSuccessfulRequests }
// Returns a commit() fn; call commit(success) after handling to (optionally)
// only count failed attempts, matching express-rate-limit's
// skipSuccessfulRequests behavior.
export function enforceRateLimit(req, name, options) {
  const { windowMs, limit, key } = options;
  const id = `${name}:${key ?? clientIp(req)}`;
  const now = Date.now();
  let entry = buckets.get(id);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    buckets.set(id, entry);
  }
  if (entry.count >= limit) {
    throw new ApiError(429, options.message ?? "Too many requests, try again later");
  }
  // Provisionally count this attempt; a caller using skipSuccessfulRequests
  // can decrement on success via the returned commit().
  entry.count += 1;
  return function commit(success) {
    if (options.skipSuccessfulRequests && success) {
      entry.count = Math.max(0, entry.count - 1);
    }
  };
}

// Occasional cleanup so the Map doesn't grow unbounded on a long-lived instance.
export function sweepBuckets() {
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (now > v.resetAt) buckets.delete(k);
  }
}
