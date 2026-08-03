import mongoose from 'mongoose';
import { configureMongoDns } from './mongodb-dns';

let adminConnection = null;
let adminConnectionPromise = null;

/**
 * ISOLATED admin database connection
 * NO society users can access this
 */
async function connectAdminDB() {
  // SECURITY: Only allow in server-side (never client)
  if (typeof window !== 'undefined') {
    throw new Error('Admin DB access forbidden from client');
  }
  // SECURITY: Require admin secret key
  if (!process.env.ADMIN_SECRET_KEY) {
    throw new Error('Admin secret key not configured');
  }
  if (adminConnection && adminConnection.readyState === 1) {
    return adminConnection;
  }
  if (adminConnectionPromise) {
    return adminConnectionPromise;
  }
  try {
    const ADMIN_URI = process.env.MONGODB_ADMIN_URI;
    if (!ADMIN_URI) {
      throw new Error('Admin DB URI not configured');
    }
    configureMongoDns(ADMIN_URI);
    const connection = mongoose.createConnection(ADMIN_URI, {
      dbName: 'aapli_society_admin',
      bufferCommands: false,
      // ## Why minPoolSize went 1 -> 0 (this was the connection leak)
      //
      // minPoolSize: 1 tells the driver to *always keep one socket open*, for
      // the life of the process. On serverless that means every instance that
      // ever touched an admin route held a permanent Atlas connection, even
      // though the vast majority of requests never touch the admin DB at all.
      // Combined with the 10-socket main pool that was 15 sockets per warm
      // instance and is the direct explanation for the 20-40 connections in
      // the Atlas graph against ~1 query/sec of real traffic.
      //
      // With 0, the pool opens on demand and releases when idle.
      maxPoolSize: 3,
      minPoolSize: 0,
      maxIdleTimeMS: 30000,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      // 45s was long enough that a hung admin export could pin an instance.
      socketTimeoutMS: 20000,
      retryWrites: true,
    });
    adminConnectionPromise = connection.asPromise().then(() => {
      adminConnection = connection;
      console.log('Admin Database Connected (Secure)');
      return adminConnection;
    }).catch((err) => {
      // Reset so the next request retries instead of awaiting a rejected
      // promise forever (same bug class that lib/mongodb.js already guards).
      adminConnection = null;
      adminConnectionPromise = null;
      throw err;
    });
    return await adminConnectionPromise;
  } catch (error) {
    adminConnection = null;
    adminConnectionPromise = null;
    console.error('Admin DB connection failed:', error);
    throw error;
  }
}

export default connectAdminDB;

// NOTE / follow-up (not changed here because it needs your env values):
// If MONGODB_ADMIN_URI points at the SAME cluster as MONGODB_URI, this whole
// second pool is unnecessary. Replace it with
//   mongoose.connection.useDb('aapli_society_admin', { useCache: true })
// which reuses the existing sockets and removes another 3 connections per
// instance. Check with:
//   node -e "const a=new URL(process.env.MONGODB_URI.replace('mongodb+srv','https')),b=new URL(process.env.MONGODB_ADMIN_URI.replace('mongodb+srv','https'));console.log(a.host===b.host?'SAME CLUSTER - consolidate':'different clusters - keep two pools')"
