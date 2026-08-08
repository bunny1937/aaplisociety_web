// lib/commercial/commercialSettingsService.js
//
// NEW 2026-08-07. Reads and writes the society's commercial policy settings
// (models/CommercialSettings.js).
//
// Every value here was previously a constant buried in code: 21% interest, the
// 10% non-occupancy cap, the Rs 7,500 GST threshold, "a business profile is
// required". That is why the Rate Card could not answer "what will this shop be
// charged" — half the answer was not on the page and could not be edited.

import CommercialSettings from "@/models/CommercialSettings";
import { logAudit } from "@/lib/audit-logger";
import { CommercialError } from "./errors";

export const SETTINGS_AUDIT = { UPDATED: "COMMERCIAL_SETTINGS_UPDATED" };

/** Never fails just because a society has not opened the rate card yet. */
export async function getSettings({ societyId }) {
  const doc = await CommercialSettings.getOrDefaults(societyId);
  return normalise(doc);
}

function normalise(doc) {
  return {
    gst: {
      mode: doc.gst?.mode ?? "None",
      ratePercent: doc.gst?.ratePercent ?? 18,
      thresholdPerUnitPerMonth: doc.gst?.thresholdPerUnitPerMonth ?? 7500,
      thresholdBasis: doc.gst?.thresholdBasis ?? "ServiceChargesOnly",
      societyGstin: doc.gst?.societyGstin ?? null,
    },
    interest: {
      enabled: doc.interest?.enabled !== false,
      annualRatePercent: doc.interest?.annualRatePercent ?? 21,
      method: doc.interest?.method ?? "SIMPLE",
      graceDays: doc.interest?.graceDays ?? 0,
    },
    nonOccupancy: {
      enabled: doc.nonOccupancy?.enabled === true,
      appliesTo: doc.nonOccupancy?.appliesTo ?? "Both",
      commercial: {
        method: doc.nonOccupancy?.commercial?.method ?? "Percent",
        value: doc.nonOccupancy?.commercial?.value ?? 10,
        capPercentOfServiceCharges:
          doc.nonOccupancy?.commercial?.capPercentOfServiceCharges ?? 10,
      },
    },
    electricity: {
      societyManagedEnabled: doc.electricity?.societyManagedEnabled === true,
      ratePerUnit: doc.electricity?.ratePerUnit ?? 0,
      fixedMonthlyCharge: doc.electricity?.fixedMonthlyCharge ?? 0,
      requireMeterReading: doc.electricity?.requireMeterReading !== false,
    },
    funds: {
      sinking: {
        enabled: doc.funds?.sinking?.enabled !== false,
        method: doc.funds?.sinking?.method ?? "PerSqFt",
        value: doc.funds?.sinking?.value ?? 0.25,
      },
      repair: {
        enabled: doc.funds?.repair?.enabled !== false,
        method: doc.funds?.repair?.method ?? "PerSqFt",
        value: doc.funds?.repair?.value ?? 0.75,
      },
    },
    requireBusinessProfileBeforeBilling:
      doc.requireBusinessProfileBeforeBilling === true,
    billNumberPrefix: doc.billNumberPrefix ?? "C",
  };
}

/**
 * Validation returns per-field messages, because "invalid input" tells a
 * society secretary nothing about which box to fix.
 */
function validate(input) {
  const issues = [];
  const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));

  const gstMode = input?.gst?.mode;
  if (gstMode && !["None", "Always", "AboveThreshold"].includes(gstMode)) {
    issues.push({ field: "gst.mode", message: "Choose None, Always, or Above a threshold." });
  }
  if (gstMode && gstMode !== "None") {
    const rate = num(input?.gst?.ratePercent);
    if (rate === null || !(rate >= 0 && rate <= 50)) {
      issues.push({ field: "gst.ratePercent", message: "Enter a GST rate between 0 and 50." });
    }
    const gstin = String(input?.gst?.societyGstin ?? "").trim();
    if (!gstin) {
      issues.push({
        field: "gst.societyGstin",
        message: "A GST number is needed on the bill once GST is charged.",
      });
    }
  }

  const ir = num(input?.interest?.annualRatePercent);
  if (input?.interest?.enabled && (ir === null || !(ir >= 0 && ir <= 100))) {
    issues.push({
      field: "interest.annualRatePercent",
      message: "Enter an interest rate between 0 and 100% per year. Most societies use 21%.",
    });
  }

  if (input?.nonOccupancy?.enabled) {
    const v = num(input?.nonOccupancy?.commercial?.value);
    if (v === null || v < 0) {
      issues.push({
        field: "nonOccupancy.commercial.value",
        message: "Enter the non-occupancy amount, either a percentage or a rupee value.",
      });
    }
    if (input?.nonOccupancy?.commercial?.method === "Percent" && v > 100) {
      issues.push({
        field: "nonOccupancy.commercial.value",
        message: "A percentage cannot be more than 100.",
      });
    }
  }

  if (input?.electricity?.societyManagedEnabled) {
    const r = num(input?.electricity?.ratePerUnit);
    const f = num(input?.electricity?.fixedMonthlyCharge);
    if ((r === null || r <= 0) && (f === null || f <= 0)) {
      issues.push({
        field: "electricity.ratePerUnit",
        message:
          "Set a rate per unit or a fixed monthly charge, otherwise society-managed electricity would bill nothing.",
      });
    }
  }

  return issues;
}

export async function updateSettings({ societyId, userId, input }) {
  const issues = validate(input);
  if (issues.length) {
    throw new CommercialError(
      400,
      {
        error: "Some settings could not be saved — see the fields marked below.",
        code: "VALIDATION_ERROR",
        issues,
      },
      "VALIDATION_ERROR",
    );
  }

  const before = await CommercialSettings.findOne({ societyId }).lean();

  const doc = await CommercialSettings.findOneAndUpdate(
    { societyId },
    { $set: { ...input, societyId, updatedBy: userId ?? null } },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
  ).lean();

  await logAudit(userId, societyId, SETTINGS_AUDIT.UPDATED, before ?? null, doc);

  return normalise(doc);
}

/**
 * GST for one commercial bill, using the society's own policy.
 * Returns { applicable, amount, reason } — `reason` is shown on screen so the
 * admin can see WHY GST was or was not added.
 */
export function computeGst({ settings, subtotal, serviceChargeTotal }) {
  const gst = settings?.gst ?? { mode: "None" };
  if (gst.mode === "None") {
    return { applicable: false, amount: 0, reason: "This society is not charging GST." };
  }

  const rate = Number(gst.ratePercent) || 0;

  if (gst.mode === "AboveThreshold") {
    const basis =
      gst.thresholdBasis === "WholeBill" ? Number(subtotal) || 0 : Number(serviceChargeTotal) || 0;
    const threshold = Number(gst.thresholdPerUnitPerMonth) || 0;
    if (basis <= threshold) {
      return {
        applicable: false,
        amount: 0,
        reason: `Below the Rs ${threshold} monthly limit (this bill: Rs ${basis.toFixed(2)}), so no GST is charged.`,
      };
    }
    return {
      applicable: true,
      amount: Math.round(basis * (rate / 100) * 100) / 100,
      reason: `Above the Rs ${threshold} monthly limit, so GST at ${rate}% applies.`,
    };
  }

  const base = Number(subtotal) || 0;
  return {
    applicable: true,
    amount: Math.round(base * (rate / 100) * 100) / 100,
    reason: `GST at ${rate}% is charged on every commercial bill.`,
  };
}
