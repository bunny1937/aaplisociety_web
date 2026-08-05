import CommercialBillingHead from "@/models/CommercialBillingHead";
import { logAudit } from "@/lib/audit-logger";
import { COMMERCIAL_AUDIT_ACTIONS } from "./constants";
import { notFound } from "./errors";
import { withTransaction } from "./transactions";

function toDto(doc) {
  const o = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return {
    id: String(o._id),
    headName: o.headName,
    categoryScope: o.categoryScope,
    calculationType: o.calculationType,
    rate: { Shop: o.rate?.Shop ?? null, Office: o.rate?.Office ?? null },
    isServiceCharge: !!o.isServiceCharge,
    nonOccupancyEligible: !!o.nonOccupancyEligible,
    isActive: o.isActive !== false,
    updatedReason: o.updatedReason ?? null,
    updatedAt: o.updatedAt ?? null,
  };
}

export async function listCommercialHeadsForAdmin(societyId) {
  const rows = await CommercialBillingHead.find({ societyId, isDeleted: false })
    .sort({ headName: 1 })
    .lean();
  return rows.map(toDto);
}

// Used by the billing engine — active heads only.
export async function listActiveCommercialHeads(societyId) {
  const rows = await CommercialBillingHead.find({ societyId, isDeleted: false, isActive: true })
    .sort({ headName: 1 })
    .lean();
  return rows.map(toDto);
}

export async function createCommercialHead({ societyId, userId, input }) {
  return withTransaction(async (session) => {
    const [created] = await CommercialBillingHead.create(
      [
        {
          societyId,
          headName: input.headName,
          categoryScope: input.categoryScope,
          calculationType: input.calculationType,
          rate: input.rate,
          isServiceCharge: input.isServiceCharge ?? false,
          nonOccupancyEligible: input.nonOccupancyEligible ?? false,
          createdBy: userId,
          updatedBy: userId,
          updatedReason: "Commercial Billing Head Created",
        },
      ],
      session ? { session } : {},
    );
    await logAudit(userId, societyId, COMMERCIAL_AUDIT_ACTIONS.BILLING_HEAD_CREATED, null, {
      _id: created._id,
      headName: created.headName,
      categoryScope: created.categoryScope,
    });
    return toDto(created);
  });
}

export async function updateCommercialHead({ societyId, userId, headId, input }) {
  const existing = await CommercialBillingHead.findOne({ _id: headId, societyId, isDeleted: false });
  if (!existing) throw notFound();

  const before = { headName: existing.headName, rate: existing.rate?.toObject?.() ?? existing.rate, isActive: existing.isActive };
  for (const key of ["headName", "categoryScope", "calculationType", "rate", "isServiceCharge", "nonOccupancyEligible", "isActive"]) {
    if (input[key] !== undefined) existing[key] = input[key];
  }
  existing.updatedBy = userId;
  existing.updatedReason = "Commercial Billing Head Updated";

  return withTransaction(async (session) => {
    await existing.save(session ? { session } : {});
    await logAudit(userId, societyId, COMMERCIAL_AUDIT_ACTIONS.BILLING_HEAD_UPDATED, before, {
      _id: existing._id,
      headName: existing.headName,
      rate: existing.rate,
      isActive: existing.isActive,
    });
    return toDto(existing);
  });
}
