/**
 * scripts/cleanup-orphaned-roles.js
 *
 * ONE-TIME cleanup script.
 *
 * Removes documents from the `roles` collection whose `key` isn't one of
 * User.role's current valid enum values — meaning no real user can ever be
 * assigned that role today (see models/User.js's ProfileSchema.role /
 * root-level role enum). Found via apps/mobile-backend/mongo_export/roles.json:
 * one such document exists ("manager"), written by something that bypassed
 * Mongoose validation (a raw import), never referenced by any app code, and
 * structurally unassignable under the schema as it stands. Confirmed with
 * the user this is dead data to be deleted, not a feature to build out.
 *
 * Usage (from project root):
 *   node scripts/cleanup-orphaned-roles.js            # dry run — lists what would be deleted
 *   node scripts/cleanup-orphaned-roles.js --confirm   # actually deletes
 *
 * Back up the `roles` collection first if you want a rollback path —
 * this script only deletes, it doesn't snapshot.
 */

import mongoose from "mongoose";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const VALID_ROLES = ["SuperAdmin", "Admin", "Secretary", "Accountant", "Member", "Security"];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not configured (check .env.local)");
  await mongoose.connect(uri);

  const roles = mongoose.connection.db.collection("roles");
  const orphaned = await roles.find({ key: { $nin: VALID_ROLES } }).toArray();

  if (orphaned.length === 0) {
    console.log("No orphaned role documents found. Nothing to do.");
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${orphaned.length} orphaned role document(s):`);
  for (const doc of orphaned) {
    console.log(`  _id=${doc._id} key=${JSON.stringify(doc.key)} societyId=${doc.societyId} name=${JSON.stringify(doc.name)}`);
  }

  const confirmed = process.argv.includes("--confirm");
  if (!confirmed) {
    console.log("\nDry run only — re-run with --confirm to actually delete these documents.");
    await mongoose.disconnect();
    return;
  }

  const result = await roles.deleteMany({ key: { $nin: VALID_ROLES } });
  console.log(`Deleted ${result.deletedCount} document(s).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("cleanup-orphaned-roles failed:", err);
  process.exit(1);
});
