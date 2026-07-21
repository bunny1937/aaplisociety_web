import redis from "./redis";
const cache = {
  async get(key) {
    try {
      const val = await redis.get(key);
      return val ? JSON.parse(val) : null;
    } catch (e) {
      console.warn("Cache GET error:", e.message);
      return null;
    }
  },
  async set(key, data, ttlSeconds) {
    try {
      await redis.setex(key, ttlSeconds, JSON.stringify(data));
    } catch (e) {
      console.warn("Cache SET error:", e.message);
    }
  },
  async del(...keys) {
    try {
      if (keys.length) await redis.del(...keys);
    } catch (e) {
      console.warn("Cache DEL error:", e.message);
    }
  },
  async delPattern(pattern) {
    try {
      if (!this.client?.isOpen) return;
      const keys = await this.client.keys(pattern);
      if (keys.length > 0)
        await Promise.all(keys.map((k) => this.client.del(k)));
    } catch (e) {
      console.warn("Cache DELPATTERN error:", e.message);
    }
  },
  // Stampede-safe fetch
  async getOrSet(key, fetchFn, ttlSeconds) {
    try {
      const cached = await redis.get(key);
      if (cached) return JSON.parse(cached);
      // No distributed lock: the anti-stampede lock added 2 extra Redis writes
      // (SET NX + DEL) on every miss, ~tripling write commands. At this app's
      // scale, a rare duplicate DB read on concurrent misses is far cheaper than
      // the Redis quota. Miss cost is now 1 read + 1 write.
      const data = await fetchFn();
      await redis.setex(key, ttlSeconds, JSON.stringify(data));
      return data;
    } catch (e) {
      console.warn("Cache getOrSet error:", e.message);
      return await fetchFn(); // fallback to DB directly
    }
  },
};
export default cache;
