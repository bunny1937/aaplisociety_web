import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import cache from "@/lib/cache";

export async function POST(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    if (decoded.role !== "Admin")
      return NextResponse.json({ error: "Admin only" }, { status: 403 });

    const { memberId, carpetAreaSqft, parkingSlots } = await request.json();
    if (!memberId) return NextResponse.json({ error: "memberId required" }, { status: 400 });

    const patch = {};
    if (carpetAreaSqft !== undefined) patch.carpetAreaSqft = Number(carpetAreaSqft);
    if (parkingSlots !== undefined) patch.parkingSlots = parkingSlots;

    const member = await Member.findOneAndUpdate(
      { _id: memberId, societyId: decoded.societyId },
      { $set: patch },
      { new: true, projection: { flatNo: 1, wing: 1, ownerName: 1, carpetAreaSqft: 1, parkingSlots: 1 } },
    );

    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    await cache.delPattern(`members:list:${decoded.societyId}:*`);
    return NextResponse.json({ member: member.toObject() });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
