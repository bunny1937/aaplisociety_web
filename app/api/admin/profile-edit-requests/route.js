// GET /api/admin/profile-edit-requests?status=Pending — list profile edit
// requests for the admin's society. `status` defaults to "Pending"; pass
// status=all for every status. Each item is enriched with a `member`
// summary (flatNo/wing/ownerName) so the admin UI doesn't need a second
// round trip per row.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import ProfileEditRequest from "@/models/ProfileEditRequest";
import Member from "@/models/Member";
import { requireRoles } from "@/lib/authz";
export async function GET(request) {
  const auth = requireRoles(request, ["Admin", "Secretary"]);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "Pending";
    const query = { societyId: auth.user.societyId };
    if (status !== "all") query.status = status;
    const items = await ProfileEditRequest.find(query).sort({ createdAt: -1 }).limit(200).lean();
    const memberIds = [...new Set(items.map((i) => String(i.memberId)))];
    const members = await Member.find({ _id: { $in: memberIds } })
      .select("flatNo wing ownerName")
      .lean();
    const memberById = new Map(members.map((m) => [String(m._id), m]));
    return NextResponse.json({
      success: true,
      items: items.map((item) => ({ ...item, member: memberById.get(String(item.memberId)) || null })),
    });
  } catch (err) {
    console.error("Profile edit requests list error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
