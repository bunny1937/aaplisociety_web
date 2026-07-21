import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
export async function GET(request) {
  await connectDB();
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const decoded = verifyToken(token);
  if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const periodId = searchParams.get("periodId");
  if (!periodId) return NextResponse.json({ error: "Missing periodId" }, { status: 400 });
  const uploaded = await Bill.exists({
    societyId: decoded.societyId,
    billPeriodId: periodId,
    paymentUploadedAt: { $exists: true, $ne: null },
    isDeleted: { $ne: true },
  });
  return NextResponse.json({ uploaded: !!uploaded });
}
