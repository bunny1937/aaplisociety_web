import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import Member from "@/models/Member";
import Society from "@/models/Society";
import { validateAdminRequest } from "@/lib/admin-middleware";
import bcrypt from "bcryptjs";
import { generateUniqueUsername } from "@/lib/username-generator";

function generatePassword() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$!";
  let pwd = "";
  for (let i = 0; i < 10; i++)
    pwd += chars[Math.floor(Math.random() * chars.length)];
  return pwd;
}

// POST /api/superadmin/reset-member-passwords
// Body: { societyId }
// Resets passwords for all member Users in the society, returns plain credentials
export async function POST(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;

  try {
    await connectDB();

    const { societyId } = await request.json();
    if (!societyId) return NextResponse.json({ error: "societyId required" }, { status: 400 });

    const society = await Society.findById(societyId).select("name").lean();
    const societyName = society?.name || "Society";

    const members = await Member.find({
      societyId,
      isDeleted: { $ne: true },
    }).select("_id flatNo wing ownerName emailPrimary").lean();

    const credentials = [];

    for (const member of members) {
      if (!member.emailPrimary) continue;

      const newPwd = generatePassword();
      const newHash = await bcrypt.hash(newPwd, 10);

      // Generate username if user doesn't have one yet
      const existingUser = await User.findOne({ email: member.emailPrimary, societyId }).lean();
      const username = existingUser?.username || await generateUniqueUsername(societyName, member.ownerName, member.flatNo);

      const user = await User.findOneAndUpdate(
        { email: member.emailPrimary, societyId },
        { $set: { password: newHash, isActive: true, username } },
        { new: true },
      );

      if (user) {
        credentials.push({
          flatNo: member.flatNo,
          wing: member.wing,
          ownerName: member.ownerName,
          username,
          email: member.emailPrimary,
          password: newPwd,
          isNewUser: false,
        });
      }
    }

    return NextResponse.json({ success: true, credentials });
  } catch (err) {
    console.error("reset-member-passwords error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
