import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import Bill from "@/models/Bill";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { safeConfigDate } from "@/utils/dateUtils";
import cache from "@/lib/cache";
const DAY_FIELDS = ["billGenerationDay", "paymentUploadDay", "billDueDay"];
const validateDays = (body) => DAY_FIELDS.flatMap((key) => {
  if (body[key] == null) return [];
  const value = Number(body[key]);
  return Number.isInteger(value) && value >= 1 && value <= 31 ? [] : [`${key} must be a whole number from 1 to 31`];
});
async function propagateOpenBillDueDates(societyId, billDueDay) {
  const bills = await Bill.find({ societyId, status: { $in: ["Scheduled", "Unpaid", "Partial", "PaymentDone"] }, isDeleted: { $ne: true } })
    .select("_id billYear billMonth").lean();
  if (!bills.length) return 0;
  const result = await Bill.bulkWrite(bills.map((bill) => ({ updateOne: {
    filter: { _id: bill._id },
    update: { $set: { dueDate: safeConfigDate(bill.billYear, Number(bill.billMonth) + 1, billDueDay) } },
  }})));
  return result.modifiedCount || 0;
}
export async function PUT(request) {
  try {
    await connectDB(); const token = getTokenFromRequest(request); const decoded = token ? verifyToken(token) : null;
    if (!decoded || !["Admin", "Secretary", "Treasurer"].includes(decoded.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json(); const errors = validateDays(body);
    if (errors.length) return NextResponse.json({ error: "Invalid monthly schedule", errors }, { status: 400 });
    const $set = {}; for (const key of DAY_FIELDS) if (body[key] != null) $set[`config.${key}`] = Number(body[key]);
    if (!Object.keys($set).length) return NextResponse.json({ error: "No schedule fields supplied" }, { status: 400 });
    const society = await Society.findByIdAndUpdate(decoded.societyId, { $set, $inc: { configVersion: 1 } }, { new: true, runValidators: true });
    const openBillsUpdated = body.billDueDay != null ? await propagateOpenBillDueDates(decoded.societyId, Number(body.billDueDay)) : 0;
    await cache.del(`society:config:${decoded.societyId}`);
    return NextResponse.json({ success: true, society, openBillsUpdated });
  } catch (error) { return NextResponse.json({ error: error.message }, { status: 500 }); }
}
export async function GET(request) {
  try {
    await connectDB(); const token = getTokenFromRequest(request); if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token); if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const cacheKey = `society:config:${decoded.societyId}`;
    const society = await cache.getOrSet(cacheKey, () => Society.findById(decoded.societyId).lean(), 900);
    if (!society) return NextResponse.json({ error: "Society not found" }, { status: 404 });
    return NextResponse.json({ society });
  } catch { return NextResponse.json({ error: "Internal server error" }, { status: 500 }); }
}
