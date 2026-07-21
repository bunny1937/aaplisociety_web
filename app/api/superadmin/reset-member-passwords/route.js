import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import Member from "@/models/Member";
import Society from "@/models/Society";
import { validateAdminRequest } from "@/lib/admin-middleware";
import bcrypt from "bcryptjs";
import { generatePassword } from "@/lib/password-generator";
import { generateSimpleUsername, buildUsernameBloomFilter } from "@/lib/username-generator";
import { ensureSocietyCode } from "@/lib/society-code";
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
    const society = await Society.findById(societyId).select("societyCode");
    if (!society) return NextResponse.json({ error: "Society not found" }, { status: 404 });
    const societyCode = await ensureSocietyCode(society);
    const members = await Member.find({
      societyId,
      isDeleted: { $ne: true },
    }).select("_id flatNo wing ownerName emailPrimary").lean();
    const bloom = await buildUsernameBloomFilter();
    const credentials = [];
    for (const member of members) {
      if (!member.emailPrimary) continue;
      const newPwd = generatePassword();
      const newHash = await bcrypt.hash(newPwd, 10);
      // Generate username if user doesn't have one yet
      const existingUser = await User.findOne({ email: member.emailPrimary, societyId }).lean();
      const username = existingUser?.username || await generateSimpleUsername(societyCode, member.flatNo, bloom);
      const user = await User.findOneAndUpdate(
        { email: member.emailPrimary, societyId },
        { $set: { password: newHash, isActive: true, username, mustChangePassword: true } },
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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
