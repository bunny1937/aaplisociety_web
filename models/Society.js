import mongoose from "mongoose";
const SocietySchema = new mongoose.Schema(
  {
    // Basic Information
    name: { type: String, required: true, trim: true },
    registrationNo: { type: String, unique: true, sparse: true, trim: true, minlength: 4 },
    dateOfRegistration: { type: Date },
    address: { type: String, trim: true },
    panNo: { type: String, trim: true },
    tanNo: { type: String, trim: true },
    // Contact Details
    personOfContact: { type: String, trim: true },
    contactEmail: { type: String, trim: true },
    contactPhone: { type: String, trim: true },
    // Carpet Area
    carpetAreaSqft: { type: Number, default: 0 },
    // Bill Template - UPDATED STRUCTURE
    // Separate designer template for payment / advance receipts. Mirrors the
    // bill template design shape so the same designer UI can edit both.
    receiptTemplate: {
      type: {
        type: String,
        enum: ["default", "custom"],
        default: "default",
      },
      design: { type: mongoose.Schema.Types.Mixed, default: null },
      logoUrl: { type: String },
      signatureUrl: { type: String },
      updatedAt: { type: Date },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    billTemplate: {
      type: {
        type: String,
        enum: ["default", "custom", "uploaded-pdf", "uploaded-image"],
        default: "default",
      },
      // For uploaded PDF
      pdfUrl: { type: String },
      hasFormFields: { type: Boolean, default: false },
      detectedFields: [{ type: String }],
      // For uploaded image
      imageUrl: { type: String },
      // For custom design
      design: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
        headerBg: String,
        headerColor: String,
        societyNameSize: Number,
        addressSize: Number,
        billTitleSize: Number,
        billTitleAlign: String,
        tableHeaderBg: String,
        tableHeaderColor: String,
        tableRowBg1: String,
        tableRowBg2: String,
        tableBorderColor: String,
        totalBg: String,
        totalColor: String,
        totalSize: Number,
        footerSize: Number,
        footerText: [String],
        showSignature: Boolean,
        signatureLabel: String,
      },
      // Common assets
      logoUrl: { type: String },
      signatureUrl: { type: String },
      uploadedAt: { type: Date },
      uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      // OLD FIELDS - keep for backward compatibility
      fileName: { type: String },
      filePath: { type: String },
    },
    // Configuration
    config: {
      // billing settings (non-charge)
     interestRate: { type: Number, default: 0 },
serviceTaxRate: { type: Number, default: 0 },
gracePeriodDays: { type: Number, default: 10 },

billDueDate: {
  type: Date,
  default: null,
},

billDueDay: {
  type: Number,
  min: 1,
  max: 31,
  default: 10,
},
      billPayFinalDay: { type: Number, min: 1, max: 31, default: 25 }, // ← NEW: last day to accept payment/interest for the month
      // NEW CONFIG FLAGS
      interestRounding: {
        type: String,
        enum: ["TWO_DECIMAL", "ROUND_UP"],
        default: "TWO_DECIMAL",
      },
      interestUseMode: {
        // OLDEST_FIRST: clear oldest bill's interest first
        // TOTAL: treat all interest as one bucket (still oldest-first physically)
        type: String,
        enum: ["OLDEST_FIRST", "TOTAL"],
        default: "OLDEST_FIRST",
      },
      advanceAutoApply: {
        type: Boolean,
        default: false, // admin decided: NO automation per your answer
      },
      adjustmentApplicationMode: {
        type: String,
        enum: ["INTEREST_FIRST", "PRINCIPAL_FIRST"],
        default: "INTEREST_FIRST",
      },
      interestTriggerTiming: {
        type: String,
        enum: ["SAME_DAY", "NEXT_DAY"],
        default: "NEXT_DAY",
      },
      memberPaymentBreakdownVisible: {
        type: Boolean,
        default: true, // transparent by default
      },
      interestBasis: {
        type: String,
        enum: ["MONTHLY"],
        default: "MONTHLY",
      },
      // Scheduled bill generation/push
      // billGenerationDay: day of month admin generates bills (e.g., 1 = 1st of month)
      // billPushDay: day of month bills become visible to members / go Unpaid (e.g., 5 = 5th)
      // If billPushDay > today at generation time → bills stored as 'Scheduled', auto-pushed by cron
      billGenerationDay: { type: Number, min: 1, max: 28, default: 1 },
      billPushDay: { type: Number, min: 1, max: 28, default: 1 },
      // Interest Activation Settings (replaces gracePeriodDays / billDueDay / billPayFinalDay)
      interestAfterDays: { type: Number, min: 0, max: 365, default: 15 },
      interestActivationMode: {
        type: String,
        enum: ["VIEW", "APPLICABLE"],
        default: "VIEW",
      },
      // Bill Generation Mode (replaces billGenerationDay)
      billGenerationMode: {
        type: String,
        enum: ["MANUAL", "AUTOMATIC"],
        default: "MANUAL",
      },
      billAutoGenerateDay: { type: Number, min: 1, max: 5, default: 1 },
      // dynamic charges — single source of truth
      charges: [
        {
          label: { type: String },
          type: {
            type: String,
            enum: ["Fixed", "Per Sq Ft", "Per Vehicle"],
            default: "Fixed",
          },
          value: { type: Number, default: 0 },
          isActive: { type: Boolean, default: true },
          vehicleType: {
            type: String,
            enum: ["Two-Wheeler", "Four-Wheeler", null],
            default: null,
          },
        },
      ],
    },
    // Inside society.config schema:
    parkingRates: {
      Open: {
        "Two-Wheeler": { type: Number, default: 0 },
        "Four-Wheeler": { type: Number, default: 0 },
      },
      Covered: {
        "Two-Wheeler": { type: Number, default: 0 },
        "Four-Wheeler": { type: Number, default: 0 },
      },
      // Stilt has no entry — never billed
    },
    // Subscription
    subscription: {
      planType: {
        type: String,
        enum: ["Free", "Basic", "Premium", "Enterprise"],
        default: "Free",
      },
      startDate: { type: Date, default: Date.now },
      lastPaymentDate: { type: Date },
      nextPaymentDate: { type: Date },
      amountPaid: { type: Number, default: 0 },
      status: {
        type: String,
        enum: ["Active", "Suspended", "Trial", "Expired"],
        default: "Trial",
      },
      paymentHistory: [
        {
          date: { type: Date, required: true },
          amount: { type: Number, required: true },
          transactionId: { type: String },
          method: { type: String },
        },
      ],
    },
    societyId: { type: String, unique: true, sparse: true }, // e.g. green_valley_andheri_2018_47
    // 3-digit code assigned at creation (e.g. "482") - combined with a
    // member's flat number, this is all that's needed to build a short,
    // collision-free auto-generated username (see lib/username-generator.js).
    // Members replace this during onboarding, so it only needs to work once.
    societyCode: { type: String, unique: true, sparse: true, trim: true },
    area: { type: String },
    buildDate: { type: Date },
    credentials: {
      adminEmail: { type: String },
      plainPassword: { type: String, select: true }, // explicitly included
    },
    // Soft delete support
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    deletionReason: { type: String },
    // Config versioning
    configVersion: { type: Number, default: 1 },
    // Onboarding tracking
    onboarding: {
      billHistoryImported: { type: Boolean, default: false },
      billHistoryImportedAt: { type: Date, default: null },
      billHistoryPeriods: [{ type: String }], // e.g. ["2025-04", "2025-05", ...]
      joinPeriodId: { type: String, default: null }, // YYYY-MM when society joined platform
    },
    // Matrix Config
    matrixConfig: {
      L: { type: Number, default: 0 },
      R: { type: Number, default: 0 },
    },
    // Bulk-import provenance — lets a failed/partial import be compensated by
    // deleting every document tagged with the same run, and lets normal
    // queries exclude a society still mid-import if ever needed.
    importRunId: { type: String, default: null, index: true },
    importStatus: {
      type: String,
      enum: ["importing", "active"],
      default: "active",
    },
    // ❌ FIX #2: REMOVED billingHeads[] array
    // Use BillingHead model as SINGLE SOURCE OF TRUTH:
    // Query: BillingHead.find({ societyId })
  },
  {
    timestamps: true,
  },
);
// Pre-save hook
// Clamp a day value to the last valid day of a given month/year
function clampDay(day, month, year) {
  if (!day) return day;
  // Last day of that month: new Date(year, month, 0) = last day of month-1
  const lastDay = new Date(year, month, 0).getDate();
  return Math.min(day, lastDay);
}
SocietySchema.pre("save", function (next) {
  if (this.isModified("config") || this.isModified("matrixConfig")) {
    this.configVersion += 1;
  }
  // Clamp day fields so they never overflow for any given month.
  // We clamp against the shortest month (Feb = 28 in non-leap, 29 in leap).
  // Using Feb of current year as the reference — safest cross-month anchor.
  if (this.config) {
    const now = new Date();
    const y = now.getFullYear();
    // Feb = month 2, so new Date(y, 2, 0).getDate() = 28 or 29
    const febLastDay = new Date(y, 2, 0).getDate(); // 28 or 29
    if (this.config.billDueDay > febLastDay)
      this.config.billDueDay = febLastDay;
    if (this.config.billPayFinalDay > 31) this.config.billPayFinalDay = 31;
    if (this.config.billGenerationDay > febLastDay)
      this.config.billGenerationDay = febLastDay;
    if (this.config.billPushDay > febLastDay)
      this.config.billPushDay = febLastDay;
    // Ensure new enum fields have valid defaults if missing
    if (!this.config.interestRounding)
      this.config.interestRounding = "TWO_DECIMAL";
    if (!this.config.interestUseMode)
      this.config.interestUseMode = "OLDEST_FIRST";
  }
  next();
});
// Indexes
SocietySchema.index({ isDeleted: 1 });
SocietySchema.index({ "subscription.status": 1 });
SocietySchema.index({ importStatus: 1 });
export default mongoose.models.Society ||
  mongoose.model("Society", SocietySchema);