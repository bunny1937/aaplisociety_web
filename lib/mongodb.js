import mongoose from "mongoose";
import { configureMongoDns } from "./mongodb-dns";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Please define MONGODB_URI in .env.local");
}

let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) {
    return cached.conn;
  }
  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      // Give a flaky Wi-Fi/mobile network time instead of failing instantly.
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      retryWrites: true,
    };
    configureMongoDns(MONGODB_URI);

    // Retry transient DNS/handshake blips instead of throwing a 500 on the
    // first miss. Most "random" failures resolve on attempt 2.
    const connectWithRetry = async (attempts = 4) => {
      let lastErr;
      for (let i = 1; i <= attempts; i++) {
        try {
          return await mongoose.connect(MONGODB_URI, opts);
        } catch (e) {
          lastErr = e;
          console.warn(
            `MongoDB connect attempt ${i}/${attempts} failed: ${e.code || e.message}`,
          );
          if (i < attempts) {
            await new Promise((r) => setTimeout(r, 500 * i));
          }
        }
      }
      throw lastErr;
    };

    cached.promise = connectWithRetry()
      .then((mongoose) => {
        console.log("MongoDB Connected");
        return mongoose;
      })
      .catch((e) => {
        // Reset so the NEXT request can try again from scratch instead of
        // reusing a rejected promise forever.
        cached.promise = null;
        throw e;
      });
  }
  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }
  return cached.conn;
}

export default connectDB;