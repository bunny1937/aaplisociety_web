import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Member from "@/models/Member";
import Society from "@/models/Society";

export async function GET(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded || !decoded.memberId)
      return NextResponse.json({ error: "Not a member" }, { status: 403 });

    const [member, society] = await Promise.all([
      Member.findOne({
        _id: decoded.memberId,
        societyId: decoded.societyId,
      }).lean(),
      Society.findById(decoded.societyId)
        .select("name address config bankDetails")
        .lean(),
    ]);

    if (!member)
      return NextResponse.json({ error: "Member not found" }, { status: 404 });

    return NextResponse.json({ success: true, member, society });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error", details: error.message },
      { status: 500 },
    );
  }
}

export async function PUT(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded || !decoded.memberId)
      return NextResponse.json({ error: "Not a member" }, { status: 403 });

    const body = await request.json();
    // Members can only update safe fields
    const allowedFields = [
      "whatsappNumber",
      "alternateContact",
      "emailSecondary",
      "permanentAddress",
      "emergencyContact",
      "billingPreferences",
    ];
    const updates = {};
    allowedFields.forEach((f) => {
      if (body[f] !== undefined) updates[f] = body[f];
    });

    const member = await Member.findByIdAndUpdate(
      decoded.memberId,
      { $set: updates },
      { new: true },
    ).lean();
    return NextResponse.json({ success: true, member });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error", details: error.message },
      { status: 500 },
    );
  }
}
