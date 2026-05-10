import mongoose from "mongoose";

// Indian FY logic helper stored for reference
// FY starts April 1. joinMonth >= 4 → joinFY = joinYear, else joinFY = joinYear - 1
// Required period: April of (joinFY-1) → joinMonth-1 of joinYear

const AuditReportSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    societyName: { type: String, required: true },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    submittedByName: { type: String },
    submittedAt: { type: Date, default: Date.now, index: true },

    // Join month/year of the society on this platform
    joinMonth: { type: Number, required: true }, // 1-12
    joinYear: { type: Number, required: true },

    // Required audit window (calculated on submission)
    auditFromMonth: { type: Number, required: true }, // 1-12 (always April=4)
    auditFromYear: { type: Number, required: true },
    auditToMonth: { type: Number, required: true }, // joinMonth - 1
    auditToYear: { type: Number, required: true },
    totalMonthsRequired: { type: Number, required: true },

    // Validation summary
    validation: {
      totalMembersExpected: { type: Number },
      totalMembersFound: { type: Number },
      totalRowsExpected: { type: Number },
      totalRowsFound: { type: Number },
      columnChecks: { type: mongoose.Schema.Types.Mixed }, // { col: pass/fail }
      amountChecks: { type: Number }, // count of amount mismatches
      duplicateRows: { type: Number },
      missingMonths: [String], // e.g. ['2025-04', '2025-05']
      passed: { type: Boolean, required: true },
      errors: [String],
      warnings: [String],
    },

    // Stored bill data per member per month
    billRows: [
      {
        memberId: String,
        wing: String,
        flatNo: String,
        ownerName: String,
        month: Number,
        year: Number,
        billPeriodId: String,
        previousBalance: Number,
        interestDue: Number,
        charges: mongoose.Schema.Types.Mixed, // { headName: amount }
        subtotal: Number,
        grandTotal: Number,
      },
    ],

    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
      index: true,
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    reviewNotes: { type: String },

    fileName: { type: String },
    fileSize: { type: Number },
  },
  { timestamps: true },
);

AuditReportSchema.index({ societyId: 1, submittedAt: -1 });
AuditReportSchema.index({ status: 1, submittedAt: -1 });

export default mongoose.models.AuditReport ||
  mongoose.model("AuditReport", AuditReportSchema);
