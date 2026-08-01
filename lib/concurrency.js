// Runs `fn` over `items` with at most `limit` in flight at once, calling
// `onSettled(result, item, index)` as each one finishes (success or error) —
// used to both cap concurrency (avoid overwhelming the DB connection pool)
// and to emit live progress as items complete, in completion order rather
// than input order.
export async function mapLimit(items, limit, fn, onSettled) {
  const results = new Array(items.length);
  let next = 0;
  let doneCount = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        const value = await fn(items[i], i);
        results[i] = { status: "fulfilled", value };
        if (onSettled) await onSettled(results[i], items[i], ++doneCount, items.length);
      } catch (error) {
        results[i] = { status: "rejected", reason: error };
        if (onSettled) await onSettled(results[i], items[i], ++doneCount, items.length);
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}
