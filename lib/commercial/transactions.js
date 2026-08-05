// Multi-collection writes use a MongoDB transaction. Single-document writes
// deliberately do not — they are already atomic.
//
// Atlas replica sets support transactions; a standalone dev mongod does not.
// Rather than making local development impossible (or, worse, silently
// skipping the audit write), we detect the unsupported-transaction error and
// fall back to a sequential path that performs exactly the same operations.
import mongoose from "mongoose";

const UNSUPPORTED = [
  "Transaction numbers are only allowed on a replica set member or mongos",
  "Transactions are not supported",
  "This MongoDB deployment does not support retryable writes",
];

function isUnsupported(err) {
  const msg = String(err?.message || "");
  return UNSUPPORTED.some((u) => msg.includes(u)) || err?.code === 20;
}

/**
 * Runs `work(session)` inside a transaction when the deployment supports one.
 * `work` must accept a possibly-null session and pass it to every write.
 */
export async function withTransaction(work) {
  let session;
  try {
    session = await mongoose.startSession();
  } catch (err) {
    if (!isUnsupported(err)) throw err;
    return work(null);
  }
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (err) {
    if (isUnsupported(err)) {
      console.warn("[commercial] transactions unavailable — running sequentially");
      return work(null);
    }
    throw err;
  } finally {
    await session.endSession().catch(() => {});
  }
}
