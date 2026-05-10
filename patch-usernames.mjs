/**
 * patch-usernames.mjs
 *
 * ONE-TIME patch: assign usernames to all Member users that have none.
 * Username format: <SOCIETY_INITIALS>_<NAMEINITIALS>_<FLATNO>_<2_RANDOM_DIGITS>
 * e.g. GH_TANVIB_1001_27
 *
 * Usage:
 *   node patch-usernames.mjs
 */

import mongoose from "mongoose";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

// ── Inline schema ─────────────────────────────────────────────────────────────
const ProfileSchema = new mongoose.Schema(
  {
    profileId: { type: mongoose.Schema.Types.ObjectId },
    societyId: { type: mongoose.Schema.Types.ObjectId },
    memberId: { type: mongoose.Schema.Types.ObjectId },
    role: { type: String },
    flatNo: { type: String },
    wing: { type: String },
    societyName: { type: String },
    isPrimary: { type: Boolean },
    status: { type: String },
  },
  { _id: false },
);

const UserSchema = new mongoose.Schema(
  {
    name: String,
    username: { type: String, sparse: true },
    email: String,
    phone: String,
    password: String,
    role: String,
    profiles: [ProfileSchema],
    isActive: { type: Boolean },
  },
  { timestamps: true },
);

UserSchema.index({ username: 1 }, { unique: true, sparse: true });

// ── Username builder (mirrors lib/username-generator.js) ──────────────────────
function buildUsernameBase(societyName, ownerName, flatNo) {
  const societyInitials = societyName
    .trim()
    .split(/\s+/)
    .map((w) => (w[0] ?? "").toUpperCase())
    .join("");

  const nameParts = ownerName.trim().split(/\s+/).filter(Boolean);
  let nameInitials;
  if (nameParts.length >= 2) {
    nameInitials =
      nameParts[0].toUpperCase() + nameParts[nameParts.length - 1][0].toUpperCase();
  } else {
    nameInitials = nameParts[0]?.toUpperCase() ?? "X";
  }

  return `${societyInitials}_${nameInitials}_${flatNo}`.toLowerCase();
}

async function generateUniqueUsername(User, societyName, ownerName, flatNo) {
  const base = buildUsernameBase(societyName, ownerName, flatNo);
  for (let i = 0; i < 20; i++) {
    const suffix = String(Math.floor(Math.random() * 90) + 10);
    const candidate = `${base}_${suffix}`;
    const exists = await User.findOne({ username: candidate }).lean();
    if (!exists) return candidate;
  }
  return `${base}_${Date.now() % 10000}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set in .env.local");

  await mongoose.connect(uri);
  console.log("Connected to MongoDB");

  const User = mongoose.models.User || mongoose.model("User", UserSchema);

  // Members with no username (or empty string)
  const users = await User.find({
    role: "Member",
    $or: [{ username: { $exists: false } }, { username: null }, { username: "" }],
  }).lean();

  console.log(`Found ${users.length} Member users without username`);

  let patched = 0;
  let failed = 0;

  for (const user of users) {
    try {
      // Use primary profile for society/flat info; fall back to first profile
      const profile =
        user.profiles?.find((p) => p.isPrimary) ?? user.profiles?.[0];

      if (!profile) {
        console.warn(`  SKIP ${user._id} (${user.name}) — no profiles`);
        failed++;
        continue;
      }

      const societyName = profile.societyName || "Society";
      const flatNo = profile.flatNo || "000";
      const ownerName = user.name || "Member";

      const username = await generateUniqueUsername(User, societyName, ownerName, flatNo);

      await User.updateOne({ _id: user._id }, { $set: { username } });

      console.log(`  ✓ ${user.name.padEnd(25)} → ${username.toUpperCase()}`);
      patched++;
    } catch (err) {
      failed++;
      console.error(`  ✗ ${user._id} (${user.name}): ${err.message}`);
    }
  }

  console.log(`\nDone. patched=${patched}  failed=${failed}`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
