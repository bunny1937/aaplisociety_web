import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import Bill from "@/models/Bill";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import cache from "@/lib/cache";
export async function PUT(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    const decoded = token ? verifyToken(token) : null;
    if (!decoded || !["Admin", "Secretary", "Treasurer"].includes(decoded.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const due = new Date(body.billDueDate);
    if (!body.billDueDate || Number.isNaN(due.getTime())) {
      return NextResponse.json({ error: "Valid billDueDate is required" }, { status: 400 });
    }
    const society = await Society.findByIdAndUpdate(decoded.societyId, {
      $set: { "config.billDueDate": due, "config.billDueDay": due.getDate() },
      $inc: { configVersion: 1 },
    }, { new: true, runValidators: true });
    const result = await Bill.updateMany({
      societyId: decoded.societyId,
      status: { $in: ["Scheduled", "Unpaid", "Partial", "PaymentDone"] },
      isDeleted: { $ne: true },
    }, { $set: { dueDate: due } });
    await cache.del(`society:config:${decoded.societyId}`);
    return NextResponse.json({ success: true, society, openBillsUpdated: result.modifiedCount });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    const cacheKey = `society:config:${decoded.societyId}`;
    const society = await cache.getOrSet(
      cacheKey,
      () => Society.findById(decoded.societyId).lean(),
      900, // 15 min
    );
    if (!society)
      return NextResponse.json({ error: "Society not found" }, { status: 404 });
    return NextResponse.json({ society });
  } catch (error) {
    console.error("Fetch society config error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}