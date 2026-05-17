import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { validateAdminRequest } from "@/lib/admin-middleware";
import Member from "@/models/Member";
import User from "@/models/User";

// GET /api/superadmin/member-credentials?societyId=xxx
// Returns member emails + usernames (read-only, no password reset)
export async function GET(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;

  const { searchParams } = new URL(request.url);
  const societyId = searchParams.get("societyId");
  if (!societyId) return NextResponse.json({ error: "societyId required" }, { status: 400 });

  try {
    await connectDB();

    const members = await Member.find({
      societyId,
      isDeleted: { $ne: true },
    }).select("_id flatNo wing ownerName emailPrimary").lean();

    const credentials = await Promise.all(
      members
        .filter((m) => m.emailPrimary)
        .map(async (m) => {
          const user = await User.findOne({ email: m.emailPrimary, societyId })
            .select("username isActive")
            .lean();
          return {
            flatNo: m.flatNo,
            wing: m.wing || "",
            ownerName: m.ownerName,
            email: m.emailPrimary,
            username: user?.username || null,
            isActive: user?.isActive ?? false,
            hasAccount: !!user,
          };
        })
    );

    return NextResponse.json({ credentials });
  } catch (err) {
    console.error("member-credentials error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
