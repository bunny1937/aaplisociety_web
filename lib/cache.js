// lib/cache.js
//
// Thin JSON layer over lib/redis.js. Same public surface as before
// (get / set / del / delPattern / getOrSet) so no caller changes.
//
// Two real bugs fixed here, beyond the transport swap:
//
// 1. delPattern was a silent no-op. It referenced `this.client`, which was
//    never assigned anywhere in this module - the module imports a redis
//    singleton instead. `this.client?.isOpen` was therefore always undefined,
//    the guard returned early every single time, and every cache invalidation
//    that used a wildcard silently did nothing. Stale member lists and stale
//    billing snapshots were being served indefinitely and looked like
//    "caching bugs". It now uses SCAN + DEL for real.
//
// 2. Errors were logged on every call. With Upstash down that produced four
//    identical lines per render. Logging now happens once per cooldown inside
//    lib/redis.js, and this layer is silent.

import redis from "./redis";

/** JSON.parse that returns null instead of throwing on a poisoned entry. */
function safeParse(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") return raw; // Upstash may already decode
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// De-duplicates concurrent getOrSet calls for the same key *within one
// instance*. Two requests landing on the same warm Lambda at the same time
// used to both miss and both hit Mongo. This collapses them into one promise.
// It is not a distributed lock and deliberately so - a cross-instance lock
// costs 2 extra Redis writes per miss, which is the trade you already
// rejected in the previous version of this file.
const inflight = new Map();

const cache = {
  async get(key) {
    return safeParse(await redis.get(key));
  },

  async set(key, data, ttlSeconds = 300) {
    await redis.setex(key, ttlSeconds, JSON.stringify(data));
  },

  async del(...keys) {
    const flat = keys.flat().filter(Boolean);
    if (flat.length) await redis.del(...flat);
  },

  /**
   * Delete every key matching a glob, e.g. "members:list:abc123:*".
   * Previously a no-op. See the note at the top of this file.
   */
  async delPattern(pattern) {
    if (!pattern || !pattern.includes("*")) {
      // Not actually a pattern - a plain DEL is one round trip instead of a
      // full SCAN.
      if (pattern) await redis.del(pattern);
      return 0;
    }
    const keys = await redis.scanKeys(pattern);
    if (!keys.length) return 0;

    // Chunk the DEL. A single command with thousands of arguments can exceed
    // the REST body limit.
    let deleted = 0;
    for (let i = 0; i < keys.length; i += 256) {
      deleted += (await redis.del(...keys.slice(i, i + 256))) || 0;
    }
    return deleted;
  },

  /**
   * Read-through cache. On miss, runs fetchFn, stores the result, returns it.
   * Never throws because of the cache: if Redis is unavailable this degrades
   * to a direct fetchFn call.
   */
  async getOrSet(key, fetchFn, ttlSeconds = 300) {
    const cached = safeParse(await redis.get(key));
    if (cached !== null) return cached;

    // Collapse concurrent misses on this instance.
    if (inflight.has(key)) return inflight.get(key);

    const promise = (async () => {
      try {
        const data = await fetchFn();
        if (data !== undefined && data !== null) {
          await redis.setex(key, ttlSeconds, JSON.stringify(data));
        }
        return data;
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, promise);
    return promise;
  },

  /** Exposed for /api/health. */
  ping: () => redis.ping(),
};

export default cache;
