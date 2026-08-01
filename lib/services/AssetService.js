import mongoose from "mongoose";
import Asset from "@/models/Asset";
import FinancialYear from "@/models/FinancialYear";
import { EVENT_TYPES, createAccountingEvent } from "@/lib/accounting/events.js";
import { process as engineProcess } from "@/lib/accounting/AccountingEngine.js";
import "@/lib/accounting/bootstrap";

// Phase 2.11 of the accounting-system revamp (docs/accounting-system-ARD.md
// §3, §8): Asset Register — purchase, depreciation, transfer, disposal. Every
// ledger-affecting action goes through AccountingEngine.process() inside the
// same session as the Asset document write, so the register and the General
// Ledger can never drift (§6.10, §9.2). Transfers are metadata-only (custody/
// location change) — they don't touch any account, so they never emit an
// AccountingEvent; the compatibility table in the ARD scopes "transfer" as an
// Asset Register concern, not a ledger one.

export class AssetServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "AssetServiceError";
    this.status = status;
  }
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

async function resolveFinancialYear(societyId, date, session) {
  const fy = await FinancialYear.findOne({
    societyId,
    isDeleted: false,
    startDate: { $lte: date },
    endDate: { $gte: date },
  }).session(session);
  if (!fy) {
    throw new AssetServiceError(
      409,
      "No Financial Year covers this date — create one before posting asset transactions.",
    );
  }
  return fy;
}

/**
 * Registers a new asset and posts its purchase (Dr Fixed Asset, Cr funding
 * account) as one transaction. The linked accounts are resolved once here,
 * at purchase time — later account remaps in the Chart of Accounts don't
 * retroactively change where this asset's depreciation/disposal posts.
 */
export async function registerAsset(societyId, input, actorUserId) {
  const {
    assetCode,
    name,
    category,
    description,
    purchaseDate,
    purchaseCost,
    vendor,
    billRef,
    usefulLifeYears,
    salvageValue,
    depreciationMethod,
    wdvRatePercent,
    linkedAssetAccountId,
    linkedDepreciationExpenseAccountId,
    linkedAccumulatedDepreciationAccountId,
    fundingAccountId,
    location,
    custodian,
  } = input;

  if (!assetCode || !name) throw new AssetServiceError(400, "assetCode and name are required");
  if (!(Number(purchaseCost) > 0)) throw new AssetServiceError(400, "purchaseCost must be greater than zero");
  if (!(Number(usefulLifeYears) > 0)) throw new AssetServiceError(400, "usefulLifeYears must be greater than zero");
  if (!Asset.DEPRECIATION_METHODS.includes(depreciationMethod)) {
    throw new AssetServiceError(400, `depreciationMethod must be one of ${Asset.DEPRECIATION_METHODS.join(", ")}`);
  }
  if (depreciationMethod === "WDV" && !(Number(wdvRatePercent) > 0)) {
    throw new AssetServiceError(400, "wdvRatePercent is required and must be greater than zero for the WDV method");
  }
  if (!linkedAssetAccountId || !linkedDepreciationExpenseAccountId || !linkedAccumulatedDepreciationAccountId || !fundingAccountId) {
    throw new AssetServiceError(
      400,
      "linkedAssetAccountId, linkedDepreciationExpenseAccountId, linkedAccumulatedDepreciationAccountId, and fundingAccountId are all required",
    );
  }

  const date = purchaseDate ? new Date(purchaseDate) : new Date();
  const cost = round2(purchaseCost);

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const financialYear = await resolveFinancialYear(societyId, date, session);

      const [asset] = await Asset.create(
        [
          {
            societyId,
            assetCode,
            name,
            category: category || "Other",
            description,
            purchaseDate: date,
            purchaseCost: cost,
            vendor,
            billRef,
            usefulLifeYears,
            salvageValue: round2(salvageValue || 0),
            depreciationMethod,
            wdvRatePercent: depreciationMethod === "WDV" ? wdvRatePercent : null,
            linkedAssetAccountId,
            linkedDepreciationExpenseAccountId,
            linkedAccumulatedDepreciationAccountId,
            fundingAccountId,
            financialYearId: financialYear._id,
            location,
            custodian,
            createdBy: actorUserId,
          },
        ],
        { session },
      );

      const event = createAccountingEvent({
        type: EVENT_TYPES.ASSET_PURCHASED,
        societyId,
        financialYearId: financialYear._id,
        sourceModule: "Assets",
        sourceRef: String(asset._id),
        actorUserId,
        idempotencyKey: `asset-purchase:${asset._id}`,
        payload: {
          narration: `Asset purchased: ${name} (${assetCode})`,
          date,
          lines: [
            { accountId: String(linkedAssetAccountId), side: "Debit", amount: cost, narration: `Fixed asset: ${name}` },
            { accountId: String(fundingAccountId), side: "Credit", amount: cost, narration: `Payment for asset: ${name}` },
          ],
        },
      });

      const posted = await engineProcess(event, { session });
      asset.purchaseVoucherId = posted.voucher._id;
      await asset.save({ session });

      result = asset;
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export async function listAssets(societyId, { status, category } = {}) {
  const query = { societyId, isDeleted: false };
  if (status) query.status = status;
  if (category) query.category = category;
  return Asset.find(query).sort({ purchaseDate: -1 }).lean();
}

export async function getAssetById(societyId, id) {
  const asset = await Asset.findOne({ _id: id, societyId, isDeleted: false });
  if (!asset) throw new AssetServiceError(404, "Asset not found");
  return asset;
}

/** Computes the depreciation amount for a period without posting it. */
export function computeDepreciationAmount(asset, periodMonths = 12) {
  const depreciableBase = round2(asset.purchaseCost - asset.salvageValue);
  const remaining = round2(depreciableBase - asset.accumulatedDepreciation);
  if (remaining <= 0.005) return 0;

  let amount;
  if (asset.depreciationMethod === "WDV") {
    const bookValue = round2(asset.purchaseCost - asset.accumulatedDepreciation);
    amount = round2((bookValue * asset.wdvRatePercent) / 100 * (periodMonths / 12));
  } else {
    amount = round2((depreciableBase / asset.usefulLifeYears) * (periodMonths / 12));
  }
  return Math.min(amount, remaining);
}

/**
 * Runs one depreciation charge for an asset and posts it (Dr Depreciation
 * Expense, Cr Accumulated Depreciation). `periodMonths` lets the caller run
 * monthly, quarterly, or annual depreciation; idempotency is keyed on
 * asset+date so re-submitting the same run is a no-op via the engine's
 * idempotency check, not a duplicate posting.
 */
export async function runDepreciation(societyId, assetId, { date, periodMonths = 12 } = {}, actorUserId) {
  const runDate = date ? new Date(date) : new Date();

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const asset = await Asset.findOne({ _id: assetId, societyId, isDeleted: false }).session(session);
      if (!asset) throw new AssetServiceError(404, "Asset not found");
      if (asset.status !== "Active") {
        throw new AssetServiceError(409, `Cannot depreciate a "${asset.status}" asset`);
      }

      const amount = computeDepreciationAmount(asset, periodMonths);
      if (amount <= 0) {
        throw new AssetServiceError(409, "Asset is already fully depreciated to its salvage value");
      }

      const financialYear = await resolveFinancialYear(societyId, runDate, session);
      const runKey = runDate.toISOString().slice(0, 10);

      const event = createAccountingEvent({
        type: EVENT_TYPES.DEPRECIATION_POSTED,
        societyId,
        financialYearId: financialYear._id,
        sourceModule: "Assets",
        sourceRef: String(asset._id),
        actorUserId,
        idempotencyKey: `depreciation:${asset._id}:${runKey}`,
        payload: {
          narration: `Depreciation: ${asset.name} (${asset.assetCode})`,
          date: runDate,
          lines: [
            { accountId: String(asset.linkedDepreciationExpenseAccountId), side: "Debit", amount, narration: `Depreciation expense: ${asset.name}` },
            { accountId: String(asset.linkedAccumulatedDepreciationAccountId), side: "Credit", amount, narration: `Accumulated depreciation: ${asset.name}` },
          ],
        },
      });

      const posted = await engineProcess(event, { session });

      asset.accumulatedDepreciation = round2(asset.accumulatedDepreciation + amount);
      asset.depreciationRuns.push({
        date: runDate,
        financialYearId: financialYear._id,
        amount,
        method: asset.depreciationMethod,
        voucherId: posted.voucher._id,
      });
      await asset.save({ session });

      result = asset;
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * Disposes an asset: removes its cost and accumulated depreciation from the
 * books, records sale proceeds, and books the gain/loss on disposal.
 */
export async function disposeAsset(societyId, assetId, { date, proceeds, disposalAccountId, gainLossAccountId, note } = {}, actorUserId) {
  const disposalDate = date ? new Date(date) : new Date();
  const proceedsAmt = round2(proceeds || 0);

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const asset = await Asset.findOne({ _id: assetId, societyId, isDeleted: false }).session(session);
      if (!asset) throw new AssetServiceError(404, "Asset not found");
      if (asset.status !== "Active") {
        throw new AssetServiceError(409, `Asset is already "${asset.status}"`);
      }
      if (proceedsAmt > 0 && !disposalAccountId) {
        throw new AssetServiceError(400, "disposalAccountId (the account receiving disposal proceeds) is required when proceeds > 0");
      }

      const netBookValue = round2(asset.purchaseCost - asset.accumulatedDepreciation);
      const gainLoss = round2(proceedsAmt - netBookValue);
      if (Math.abs(gainLoss) >= 0.005 && !gainLossAccountId) {
        throw new AssetServiceError(400, "gainLossAccountId is required — this disposal produces a gain/loss on disposal");
      }

      const lines = [];
      if (asset.accumulatedDepreciation > 0) {
        lines.push({
          accountId: String(asset.linkedAccumulatedDepreciationAccountId),
          side: "Debit",
          amount: asset.accumulatedDepreciation,
          narration: `Remove accumulated depreciation: ${asset.name}`,
        });
      }
      if (proceedsAmt > 0) {
        lines.push({
          accountId: String(disposalAccountId),
          side: "Debit",
          amount: proceedsAmt,
          narration: `Disposal proceeds: ${asset.name}`,
        });
      }
      if (gainLoss < -0.005) {
        lines.push({
          accountId: String(gainLossAccountId),
          side: "Debit",
          amount: round2(-gainLoss),
          narration: `Loss on disposal: ${asset.name}`,
        });
      }
      lines.push({
        accountId: String(asset.linkedAssetAccountId),
        side: "Credit",
        amount: asset.purchaseCost,
        narration: `Remove asset cost: ${asset.name}`,
      });
      if (gainLoss > 0.005) {
        lines.push({
          accountId: String(gainLossAccountId),
          side: "Credit",
          amount: round2(gainLoss),
          narration: `Gain on disposal: ${asset.name}`,
        });
      }

      const financialYear = await resolveFinancialYear(societyId, disposalDate, session);

      const event = createAccountingEvent({
        type: EVENT_TYPES.ASSET_DISPOSED,
        societyId,
        financialYearId: financialYear._id,
        sourceModule: "Assets",
        sourceRef: String(asset._id),
        actorUserId,
        idempotencyKey: `asset-disposal:${asset._id}`,
        payload: {
          narration: `Asset disposed: ${asset.name} (${asset.assetCode})`,
          date: disposalDate,
          lines,
        },
      });

      const posted = await engineProcess(event, { session });

      asset.status = "Disposed";
      asset.disposal = {
        date: disposalDate,
        proceeds: proceedsAmt,
        gainLoss,
        gainLossAccountId: Math.abs(gainLoss) >= 0.005 ? gainLossAccountId : null,
        disposalAccountId: proceedsAmt > 0 ? disposalAccountId : null,
        voucherId: posted.voucher._id,
        note,
      };
      await asset.save({ session });

      result = asset;
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/** Metadata-only custody/location change — never touches the ledger. */
export async function transferAsset(societyId, assetId, { toLocation, toCustodian, note }, actorUserId) {
  const asset = await getAssetById(societyId, assetId);
  if (asset.status !== "Active") {
    throw new AssetServiceError(409, `Cannot transfer a "${asset.status}" asset`);
  }
  asset.transferHistory.push({
    date: new Date(),
    fromLocation: asset.location,
    toLocation,
    fromCustodian: asset.custodian,
    toCustodian,
    note,
    byUserId: actorUserId,
  });
  if (toLocation !== undefined) asset.location = toLocation;
  if (toCustodian !== undefined) asset.custodian = toCustodian;
  await asset.save();
  return asset;
}
