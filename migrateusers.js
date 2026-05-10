/**
 * scripts/migrate-users-to-profiles.js
 *
 * ONE-TIME migration script.
 * Converts existing Member users from flat schema to profiles[] schema.
 *
 * Run ONCE on staging first, verify, then run on production.
 *
 * Usage (from project root):
 *   node --experimental-vm-modules scripts/migrate-users-to-profiles.js
 * OR with ts-node / Next.js script runner depending on your setup.
 *
 * ⚠ BACK UP your users collection before running.
 */

import mongoose from "mongoose";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

// ── Inline schema (avoid circular Next.js imports in script context) ──────────
const ProfileSchema = new mongoose.Schema(
  {
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      default: () => new mongoose.Types.ObjectId(),
    },
    societyId: { type: mongoose.Schema.Types.ObjectId },
    memberId: { type: mongoose.Schema.Types.ObjectId },
    role: { type: String, default: "Member" },
    flatNo: { type: String, default: "" },
    wing: { type: String, default: "" },
    societyName: { type: String, default: "" },
    isPrimary: { type: Boolean, default: false },
    status: { type: String, default: "Active" },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const UserSchema = new mongoose.Schema(
  {
    name: String,
    username: String,
    email: String,
    phone: String,
    password: String,
    role: String,
    societyId: mongoose.Schema.Types.ObjectId,
    memberId: mongoose.Schema.Types.ObjectId,
    societyCode: String,
    profiles: [ProfileSchema],
    activeProfileId: mongoose.Schema.Types.ObjectId,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const MemberSchema = new mongoose.Schema(
  {
    flatNo: String,
    wing: String,
    societyId: mongoose.Schema.Types.ObjectId,
    userId: mongoose.Schema.Types.ObjectId,
  },
  { strict: false },
);

const SocietySchema = new mongoose.Schema({ name: String }, { strict: false });

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set in .env.local");

  await mongoose.connect(uri);
  console.log("✅ Connected to MongoDB");

  const User = mongoose.models.User || mongoose.model("User", UserSchema);
  const Member =
    mongoose.models.Member || mongoose.model("Member", MemberSchema);
  const Society =
    mongoose.models.Society || mongoose.model("Society", SocietySchema);

  // Build a society name lookup map
  const societies = await Society.find({}).select("_id name").lean();
  const societyMap = Object.fromEntries(
    societies.map((s) => [String(s._id), s.name]),
  );

  // Find all Member-role users that haven't been migrated yet
  const users = await User.find({
    role: "Member",
    societyId: { $exists: true, $ne: null },
    memberId: { $exists: true, $ne: null },
    $or: [{ profiles: { $exists: false } }, { profiles: { $size: 0 } }],
  }).lean();

  console.log(`Found ${users.length} Member users to migrate`);

  let migrated = 0;
  let failed = 0;

  for (const user of users) {
    try {
      // Fetch member doc for flatNo / wing
      const member = await Member.findById(user.memberId)
        .select("flatNo wing societyId")
        .lean();

      const profileId = new mongoose.Types.ObjectId();
      const profile = {
        profileId,
        societyId: user.societyId,
        memberId: user.memberId,
        role: "Member",
        flatNo: member?.flatNo ?? "",
        wing: member?.wing ?? "",
        societyName: societyMap[String(user.societyId)] ?? "",
        isPrimary: true,
        status: "Active",
        joinedAt: user.createdAt ?? new Date(),
      };

      // Update user: set profiles[], activeProfileId, remove root fields
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            profiles: [profile],
            activeProfileId: profileId,
          },
          $unset: {
            // Remove root-level fields for Member accounts
            memberId: "",
            // Do NOT unset societyId or role yet — remove after confirming
            // migration is stable. Uncomment when ready:
            // societyId: "",
            // role: "",        // ← keep "Member" for now as fallback
          },
        },
      );

      // Backlink member → user
      if (member) {
        await Member.updateOne({ _id: user.memberId }, { userId: user._id });
      }

      migrated++;
      if (migrated % 50 === 0) {
        process.stdout.write(`  migrated ${migrated}/${users.length}\r`);
      }
    } catch (err) {
      failed++;
      console.error(
        `  ❌ Failed for user ${user._id} (${user.email}): ${err.message}`,
      );
    }
  }

  console.log(
    `\n✅ Migration complete. migrated=${migrated}  failed=${failed}`,
  );

  // ── Summary ───────────────────────────────────────────────────────────────
  const remaining = await User.countDocuments({
    role: "Member",
    $or: [{ profiles: { $exists: false } }, { profiles: { $size: 0 } }],
  });
  console.log(`Remaining un-migrated Member users: ${remaining}`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
