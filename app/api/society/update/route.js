import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import Bill from "@/models/Bill";
import AuditLog from "@/models/AuditLog";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { safeConfigDate } from "@/utils/dateUtils";
import cache from "@/lib/cache";
const DAY_FIELDS = ["billGenerationDay", "paymentUploadDay", "billDueDay"];
function normalizeSocietyUpdatePayload(payload) {
  const normalized = { ...payload };
  if (Object.prototype.hasOwnProperty.call(normalized, "config.charges")) {
    normalized.config = normalized.config || {}; normalized.config.charges = normalized["config.charges"]; delete normalized["config.charges"];
  }
  return normalized;
}
function scheduleErrors(config = {}) {
  return DAY_FIELDS.flatMap((key) => {
    const value = Number(config[key]);
    return Number.isInteger(value) && value >= 1 && value <= 31 ? [] : [`${key} must be a whole number from 1 to 31`];
  });
}
async function updateOpenDueDates(societyId, billDueDay) {
  const bills = await Bill.find({ societyId, status: { $in: ["Scheduled", "Unpaid", "Partial", "PaymentDone"] }, isDeleted: { $ne: true } })
    .select("_id billYear billMonth").lean();
  if (!bills.length) return 0;
  const result = await Bill.bulkWrite(bills.map((bill) => ({ updateOne: { filter: { _id: bill._id }, update: { $set: {
    dueDate: safeConfigDate(bill.billYear, Number(bill.billMonth) + 1, billDueDay),
  } } } })));
  return result.modifiedCount || 0;
}
export async function PUT(request) {
  try {
    await connectDB(); const token = getTokenFromRequest(request); const decoded = token ? verifyToken(token) : null;
    if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!['Admin','Secretary','Treasurer'].includes(decoded.role)) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    const normalizedBody = normalizeSocietyUpdatePayload(await request.json().catch(() => ({})));
    const oldSociety = await Society.findById(decoded.societyId); if (!oldSociety) return NextResponse.json({ error: "Society not found" }, { status: 404 });
    const oldConfig = oldSociety.config?.toObject ? oldSociety.config.toObject() : { ...(oldSociety.config || {}) };
    normalizedBody.config = { ...oldConfig, ...(normalizedBody.config || {}) };
    const errors = scheduleErrors(normalizedBody.config); if (errors.length) return NextResponse.json({ error: "Invalid monthly billing schedule", errors }, { status: 400 });
    const oldDueDay = Number(oldConfig.billDueDay || 30); const newDueDay = Number(normalizedBody.config.billDueDay);
    const updatedSociety = await Society.findByIdAndUpdate(decoded.societyId, { $set: normalizedBody }, { new: true, runValidators: true });
    const openBillsUpdated = oldDueDay !== newDueDay ? await updateOpenDueDates(decoded.societyId, newDueDay) : 0;
    await AuditLog.create({ userId: decoded.userId, societyId: decoded.societyId, action: "UPDATE_SOCIETY_CONFIG", oldData: oldSociety, newData: updatedSociety, timestamp: new Date() });
    await cache.del(`society:config:${decoded.societyId}`);
    return NextResponse.json({ success: true, message: "Society configuration updated successfully", society: updatedSociety, openBillsUpdated });
  } catch (error) { return NextResponse.json({ error: "Internal server error", details: error.message }, { status: 500 }); }
}
