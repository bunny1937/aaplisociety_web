import Redis from "ioredis";
const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 3) return null; // stop retrying, let it fail gracefully
    return Math.min(times * 100, 3000);
  },
  lazyConnect: true,
});
redis.on("error", (err) => {
  console.warn("Redis connection error:", err.message);
});
export default redis;
