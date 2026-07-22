import mongoose from "mongoose";
import Bill from "@/models/Bill";
import AuditEvent from "@/models/AuditEvent";

// Ledger V2 §8 / §17(2): the ONLY sanctioned way to change an already-generated
// bill. Never a silent overwrite — every field change is captured before/after
// in a MANUAL_CORRECTION audit event written in the same atomic operation.
//
// A meaningful, explicit `reason` is REQUIRED for every correction. There is no
// generic default: an unexplained financial correction is not permitted.
const MONETARY = [
  "openingPrincipal", "openingInterest", "currentCharges", "currentInterest",
  "totalBillDue", "closingPrincipal", "closingInterest", "closingTotal",
  "balanceAmount", "amountPaid", "principalBalance", "interestBalance", "status",
];

export async function correctBillHistorical({ bill, corrected, reason, performedBy }) {
  const cleanReason = typeof reason === "string" ? reason.trim() : "";
  if (!cleanReason) {
    const e = new Error("A specific correction reason is required for every manual correction");
    e.code = "REASON_REQUIRED";
    throw e;
  }

  const before = {};
  for (const k of MONETARY) before[k] = bill[k];

  const auditDoc = {
    billId: bill._id,
    societyId: bill.societyId,
    memberId: bill.memberId,
    eventType: "MANUAL_CORRECTION",
    timestamp: new Date(),
    performedBy: performedBy || "System",
    calculationVersion: bill.calculationVersion || 1,
    engineVersion: "Ledger V2",
    reason: cleanReason,
    before,
    after: corrected,
  };

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Bill.updateOne({ _id: bill._id }, { $set: corrected }, { session });
      await AuditEvent.create([auditDoc], { session });
    });
  } catch (txErr) {
    if (/Transaction numbers|replica set|not supported/i.test(txErr.message || "")) {
      await Bill.updateOne({ _id: bill._id }, { $set: corrected });
      try {
        await AuditEvent.create([auditDoc]);
      } catch (auditErr) {
        await Bill.updateOne({ _id: bill._id }, { $set: before });
        session.endSession();
        throw auditErr;
      }
    } else {
      session.endSession();
      throw txErr;
    }
  }
  session.endSession();
  return { billId: bill._id, before, after: corrected };
}
