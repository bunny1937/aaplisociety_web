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
      maxPoolSize: 5,
      minPoolSize: 1,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    adminConnectionPromise = connection.asPromise().then(() => {
      adminConnection = connection;
      console.log('Admin Database Connected (Secure)');
      return adminConnection;
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
