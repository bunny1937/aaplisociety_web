// Mongoose models for the /v1 (mobile) API. Ported verbatim from the
// mobile-backend's src/models/index.ts.
//
// IMPORTANT: these are registered under DISTINCT model names ("V1User",
// "V1Visitor", ...) but each is explicitly bound to the SAME underlying
// collection the web app owns ("users", "visitors", ...). This means:
//   1. No Mongoose model-name collision with the web app's own models
//      (models/User.js registers "User"; this registers "V1User").
//   2. Reads/writes hit the exact same shared collections, so the mobile
//      endpoints behave identically to the deployed mobile backend.
//   3. strict:false mirror schemas preserve web-authored fields on read and
//      let mobile-only fields (offlineMeta, escalation history, plaintext
//      pass OTP, tenant move-out timestamps, reset codes, ...) persist.
// The web app's own models are untouched.
import mongoose from "mongoose";

const { Schema } = mongoose;
const { ObjectId } = Schema.Types;

// Helper: idempotent model registration bound to an explicit collection name.
function m(name, schema, collection) {
  return mongoose.models[name] || mongoose.model(name, schema, collection);
}

// ROOT CAUSE OF "Profile not found" (404 on /v1/auth/switch-profile).
//
// This mirror schema is what the ENTIRE /v1 (mobile) API reads users through.
// It used to be missing the one field the whole multi-flat feature hangs on:
//
//     profileId
//
// Sub-document schemas are strict even when the PARENT schema is strict:false,
// so every profileId stored by the website was silently DROPPED on hydration.
// p.profileId was therefore always undefined.
//
// It also declared { _id: true }. models/User.js declares { _id: false }, so
// there is no _id persisted for a profile in Mongo - which means Mongoose
// MINTED A BRAND NEW RANDOM ObjectId for each profile on every single load.
//
// Both routes fall back to `String(p.profileId ?? p._id)`:
//
//   POST /v1/auth/login          -> hydration #1 -> ids A1, A2  (sent to app)
//   POST /v1/auth/switch-profile -> hydration #2 -> ids B1, B2  (compared)
//
// A1 !== B1 and A1 !== B2, always, by construction. So the lookup could never
// match and the route could only ever return 404. It was not a stale token,
// not the picker, not the app - the ids were random garbage generated fresh
// per request. The website works because app/api/auth/* uses models/User.js,
// which declares profileId properly.
//
// Fix: declare profileId and turn sub-document _id off, so this schema is
// byte-identical in shape to models/User.js ProfileSchema.
const ProfileSchema = new Schema(
  {
    profileId: { type: ObjectId },
    memberId: {
      type: ObjectId,
      ref: "Member",
      required: function () {
        return this.kind !== "Commercial";
      },
    },
    societyId: { type: ObjectId, ref: "Society", index: true },
    role: { type: String, required: true },
    flatNo: String,
    wing: String,
    societyName: String,
    isPrimary: { type: Boolean, default: false },
    joinedAt: Date,
    status: { type: String, default: "Active" },
    occupancyType: { type: String, enum: ["Owner", "Tenant"], default: "Owner" },
    kind: { type: String, enum: ["Residential", "Commercial"], default: "Residential" },
    shopId: {
      type: ObjectId,
      ref: "Shop",
      default: null,
      required: function () {
        return this.kind === "Commercial";
      },
    },
  },
  // MUST match models/User.js. With _id: true Mongoose invents a new id per
  // read and every profile lookup fails.
  { _id: false },
);

const UserSchema = new Schema(
  {
    username: { type: String, required: true, index: true },
    email: { type: String, index: true },
    passwordHash: { type: String },
    password: { type: String },
    role: { type: String, required: true },
    societyId: { type: ObjectId, ref: "Society", index: true },
    memberId: { type: ObjectId, ref: "Member" },
    profiles: [ProfileSchema],
    activeProfileId: ObjectId,
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    resetCodeHash: { type: String },
    resetCodeExpiresAt: { type: Date },
    resetCodeAttempts: { type: Number, default: 0 },
  },
  { timestamps: true, strict: false },
);

const EscalationStepSchema = new Schema(
  {
    level: { type: Number, required: true },
    channel: { type: String, enum: ["in_app", "push", "sms", "whatsapp", "email", "guard_call", "admin_alert"], required: true },
    target: { type: String, default: "" },
    recipientRole: { type: String, default: "" },
    ok: { type: Boolean, default: false },
    error: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const VisitorSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: "Society", required: true, index: true },
    memberId: { type: ObjectId, ref: "Member", index: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    photo: String,
    photoKey: String,
    vehicleNumber: String,
    purpose: { type: String, enum: ["Guest", "Delivery", "Domestic Help", "Vendor", "Cab", "Other"] },
    purposeNote: String,
    status: { type: String, default: "Pending", index: true },
    entryMethod: { type: String, enum: ["Manual", "Pass", "SOS", "OfflineEntry", "GuardRequest"], default: "Manual" },
    offlineMeta: {
      wasOffline: { type: Boolean, default: false },
      queuedAt: Date,
      syncedAt: Date,
      note: String,
      clientRef: String,
      confirmation: {
        status: { type: String, enum: ["Pending", "Acknowledged", "Flagged"], default: "Pending" },
        at: Date,
        by: ObjectId,
      },
    },
    passId: { type: ObjectId, ref: "VisitorPass" },
    linkedComplaintId: { type: ObjectId, ref: "Complaint" },
    assignedGuardId: { type: ObjectId, ref: "User" },
    isBlacklisted: { type: Boolean, default: false },
    blacklistReason: String,
    entryTime: { type: Date, default: Date.now, index: true },
    exitTime: Date,
    expiresAt: Date,
    approvedBy: ObjectId,
    approvedAt: Date,
    approverRole: String,
    enteredBy: ObjectId,
    gateLabel: { type: String, default: "Main Gate" },
    escalation: {
      level: { type: Number, default: 0 },
      stopped: { type: Boolean, default: false },
      lastNotifiedAt: Date,
      history: { type: [EscalationStepSchema], default: [] },
    },
  },
  { timestamps: true, strict: false },
);
VisitorSchema.index(
  { societyId: 1, "offlineMeta.clientRef": 1 },
  { unique: true, partialFilterExpression: { "offlineMeta.clientRef": { $type: "string", $gt: "" } } },
);

// 90 days. Raise it if a society ever asks for a longer in-app history, but
// remember you are paying for storage, index size and backup size to keep a
// feed nobody scrolls.
export const NOTIFICATION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const NotificationSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: "Society", required: true, index: true },
    createdBy: ObjectId,
    createdByName: { type: String, default: "System" },
    type: { type: String, required: true },
    title: String,
    message: String,
    priority: { type: String, enum: ["normal", "high", "critical"], default: "normal" },
    recipientType: { type: String, default: "user" },
    recipientIds: [{ type: String }],
    metadata: Schema.Types.Mixed,
    actionUrl: String,
    readBy: [{ userId: { type: ObjectId, ref: "User" }, readAt: { type: Date, default: Date.now } }],
    // Every notification now carries its own expiry, defaulted to 90 days out.
    // The TTL index below is what actually deletes it; without a default this
    // field was declared but never populated, so nothing ever expired.
    expiresAt: { type: Date, default: () => new Date(Date.now() + NOTIFICATION_TTL_MS) },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, strict: false },
);

// --- Notification retention -------------------------------------------------
// This collection was the fastest-growing thing in the database: roughly 1.3
// rows per visitor event, forever. Nobody has ever opened a notification from
// four months ago, but every one of them was stored, indexed and included in
// backups every month, which is what pushed the Atlas tier up.
//
// The durable audit trail lives on the Visitor / Bill / Payment documents. These
// rows are a feed, so they get a 90-day life. MongoDB's TTL monitor deletes
// expired documents in the background roughly once a minute, at zero cost to us.
//
// expireAfterSeconds: 0 means "delete when the date in this field has passed",
// which is why the default above is a future date rather than `Date.now`.
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "notif_ttl" });

// The poller's query is the single most frequent query in the entire system:
//   { societyId, isDeleted: { $ne: true }, createdAt: { $gt: since } } sort createdAt desc
// Without this compound index that becomes a collection scan per poll - the most
// expensive possible shape for the most repeated possible call. With it, an
// empty result is an index-only lookup that touches no documents at all.
NotificationSchema.index({ societyId: 1, createdAt: -1 }, { name: "notif_feed" });

// Members filter the same feed by recipient, so support that too.
NotificationSchema.index({ societyId: 1, recipientType: 1, recipientIds: 1, createdAt: -1 }, { name: "notif_recipient" });

const DeviceTokenSchema = new Schema({
  userId: { type: ObjectId, ref: "User", required: true, index: true },
  societyId: { type: ObjectId, ref: "Society", index: true },
  fcmToken: { type: String, required: true, unique: true },
  platform: { type: String, enum: ["android", "ios"], required: true },
  lastSeenAt: { type: Date, default: Date.now },
});

const RefreshTokenSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true, index: true },
    jti: { type: String, required: true, unique: true },
    revoked: { type: Boolean, default: false },
    expiresAt: { type: Date, index: { expires: 0 } },
  },
  { timestamps: true },
);

const BillSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: "Society", required: true, index: true },
    memberId: { type: ObjectId, ref: "Member", required: true, index: true },
    period: String,
    title: String,
    principal: { type: Number, default: 0 },
    interest: { type: Number, default: 0 },
    amount: { type: Number, required: true },
    amountPaid: { type: Number, default: 0 },
    status: { type: String, default: "Unpaid", index: true },
    dueDate: Date,
  },
  { timestamps: true, strict: false },
);

const PaymentSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: "Society", required: true, index: true },
    billId: { type: ObjectId, ref: "Bill", required: true, index: true },
    memberId: { type: ObjectId, ref: "Member", index: true },
    amount: { type: Number, required: true },
    paymentMode: String,
    reference: String,
  },
  { timestamps: true },
);

const ComplaintSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: "Society", required: true, index: true },
    memberId: { type: ObjectId, ref: "Member", required: true, index: true },
    anonymousName: { type: String, required: true },
    category: { type: String, required: true },
    title: { type: String, required: true },
    description: String,
    status: { type: String, default: "PENDING", index: true },
    anonymous: { type: Boolean, default: false },
    resolutionNote: String,
  },
  { timestamps: true, strict: false },
);

const NoticeSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: "Society", required: true, index: true },
    createdBy: { type: ObjectId, ref: "User", required: true },
    createdByName: { type: String, required: true },
    type: { type: String, required: true },
    priority: { type: String, default: "medium" },
    title: { type: String, required: true },
    description: String,
    pinned: { type: Boolean, default: false },
  },
  { timestamps: true, strict: false },
);

const TenantRequestDocumentsSchema = new Schema(
  { contractKey: String, signatureKey: String, aadhaarKey: String, policeVerificationKey: String },
  { _id: false },
);

const TenantRequestSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: "Society", required: true, index: true },
    memberId: { type: ObjectId, ref: "Member", required: true, index: true },
    requestedByUserId: { type: ObjectId, ref: "User", required: true },
    tenantName: { type: String, required: true },
    tenantPhone: { type: String, required: true },
    tenantEmail: { type: String, required: true },
    leaseStartDate: { type: Date, required: true },
    leaseEndDate: { type: Date, required: true },
    rentPerMonth: { type: Number, required: true },
    depositAmount: { type: Number, default: 0 },
    documents: TenantRequestDocumentsSchema,
    status: { type: String, enum: ["Pending", "Approved", "Rejected", "Closed"], default: "Pending", index: true },
    rejectionReason: String,
    approvedBy: { type: ObjectId, ref: "User" },
    approvedAt: Date,
    leaseExpiredAt: Date,
    ownerConfirmedMoveOutAt: Date,
    adminConfirmedMoveOutAt: Date,
  },
  { timestamps: true, strict: false },
);

const ProfileEditRequestSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: "Society", required: true, index: true },
    memberId: {
      type: ObjectId,
      ref: "Member",
      required: function () {
        return this.section !== "ShopProfile";
      },
      index: true,
    },
    shopId: {
      type: ObjectId,
      ref: "Shop",
      default: null,
      required: function () {
        return this.section === "ShopProfile";
      },
      index: true,
    },
    requestedByUserId: { type: ObjectId, ref: "User", required: true },
    section: { type: String, enum: ["Contact", "FamilyMember", "EmergencyContact", "Parking", "ShopProfile"], required: true },
    action: { type: String, enum: ["Edit", "Add", "Remove"], required: true },
    familyMemberId: ObjectId,
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["Pending", "Approved", "Rejected"], default: "Pending", index: true },
    rejectionReason: String,
    approvedBy: { type: ObjectId, ref: "User" },
    approvedAt: Date,
  },
  { timestamps: true, strict: false },
);

const RentPaymentSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: "Society", required: true, index: true },
    memberId: { type: ObjectId, ref: "Member", required: true, index: true },
    recordedByUserId: { type: ObjectId, ref: "User", required: true },
    month: { type: String, required: true },
    amount: { type: Number, required: true },
    paymentMode: { type: String, enum: ["Cash", "UPI", "BankTransfer", "Cheque", "Online"], required: true },
    paidAt: { type: Date, required: true },
    notes: String,
  },
  { timestamps: true, strict: false },
);

const VisitorPassSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: "Society", required: true, index: true },
    memberId: { type: ObjectId, ref: "Member", required: true, index: true },
    createdBy: { type: ObjectId, ref: "User", required: true },
    visitorName: { type: String, required: true },
    visitorPhone: String,
    visitorPhoto: String,
    vehicleNumber: String,
    purpose: { type: String, enum: ["Guest", "Delivery", "Domestic Help", "Vendor", "Cab", "Other"], default: "Guest" },
    note: String,
    passType: { type: String, enum: ["OneTime", "Recurring", "Frequent"], default: "OneTime" },
    recurrence: {
      days: { type: [Number], default: [] },
      startTime: { type: String, default: "00:00" },
      endTime: { type: String, default: "23:59" },
    },
    validFrom: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    maxUses: { type: Number, default: 1 },
    usedAt: [{ type: Date }],
    otp: { type: String, required: true },
    otpHash: { type: String, required: true, index: true },
    qrTokenHash: { type: String, index: true },
    status: { type: String, enum: ["Active", "Used", "Expired", "Revoked"], default: "Active", index: true },
    revokedBy: { type: ObjectId, ref: "User" },
    revokedAt: Date,
  },
  { timestamps: true, strict: false },
);
VisitorPassSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3 * 24 * 60 * 60 });

const BlacklistSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: "Society", required: true, index: true },
    name: String,
    phone: { type: String, index: true },
    reason: { type: String, required: true },
    photo: String,
    severity: { type: String, enum: ["flag", "block"], default: "flag" },
    addedBy: { type: ObjectId, ref: "User", required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, strict: false },
);

const ParkingSlotSchema = new Schema(
  { slotNumber: String, type: String, vehicleType: String, monthlyBilling: Boolean },
  { _id: false },
);
const FamilyMemberSchema = new Schema({
  name: String,
  relation: String,
  age: Number,
  contactNumber: String,
  occupation: String,
});
const MemberSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: "Society", index: true },
    userId: { type: ObjectId, ref: "User", index: true },
    flatNo: String,
    wing: String,
    floor: Number,
    carpetAreaSqft: Number,
    builtUpAreaSqft: Number,
    flatType: String,
    parkingSlots: [ParkingSlotSchema],
    isActive: { type: Boolean, default: true },
    ownershipType: String,
    possessionDate: Date,
    ownerName: String,
    contactNumber: String,
    alternateContact: String,
    whatsappNumber: String,
    emailPrimary: String,
    emailSecondary: String,
    familyMembers: [FamilyMemberSchema],
    emergencyContact: { name: String, relation: String, phoneNumber: String, address: String },
    membershipStatus: String,
    membershipNumber: String,
    hasVotingRights: Boolean,
    advanceCredit: { type: Number, default: 0 },
    currentTenant: Schema.Types.Mixed,
    tenantHistory: [Schema.Types.Mixed],
  },
  { timestamps: true, strict: false },
);

const SocietySchema = new Schema(
  { name: String, address: String, gstNo: String, fyStartMonth: Number },
  { timestamps: true, strict: false },
);

const TransactionSchema = new Schema(
  {
    transactionId: String,
    date: Date,
    memberId: { type: ObjectId, ref: "Member", index: true },
    societyId: { type: ObjectId, ref: "Society", required: true, index: true },
    createdBy: ObjectId,
    type: { type: String, required: true },
    category: String,
    description: String,
    amount: { type: Number, required: true },
    balanceAfterTransaction: Number,
    referenceId: ObjectId,
    referenceModel: String,
    billPeriodId: String,
    paymentMode: String,
    interestCleared: Number,
    principalCleared: Number,
    paymentBreakdown: Schema.Types.Mixed,
  },
  { timestamps: true, strict: false },
);

const ReceiptSchema = new Schema(
  {
    receiptNo: String,
    filename: String,
    billId: { type: ObjectId, ref: "Bill" },
    billPeriodId: String,
    memberId: { type: ObjectId, ref: "Member", index: true },
    societyId: { type: ObjectId, ref: "Society", required: true, index: true },
    amount: { type: Number, required: true },
    paymentMode: String,
    paidAt: Date,
    transactionId: String,
    notes: String,
    status: { type: String, default: "Generated" },
  },
  { timestamps: true, strict: false },
);

export const User = m("V1User", UserSchema, "users");
export const Member = m("V1Member", MemberSchema, "members");
export const Society = m("V1Society", SocietySchema, "societies");
export const Transaction = m("V1Transaction", TransactionSchema, "transactions");
export const Receipt = m("V1Receipt", ReceiptSchema, "receipts");
export const Visitor = m("V1Visitor", VisitorSchema, "visitors");
export const Notification = m("V1Notification", NotificationSchema, "notifications");
export const DeviceToken = m("V1DeviceToken", DeviceTokenSchema, "devicetokens");
export const RefreshToken = m("V1RefreshToken", RefreshTokenSchema, "refreshtokens");
export const Bill = m("V1Bill", BillSchema, "bills");
export const Payment = m("V1Payment", PaymentSchema, "payments");
export const Complaint = m("V1Complaint", ComplaintSchema, "complaints");
export const Notice = m("V1Notice", NoticeSchema, "notices");
export const TenantRequest = m("V1TenantRequest", TenantRequestSchema, "tenantrequests");
export const RentPayment = m("V1RentPayment", RentPaymentSchema, "rentpayments");
export const ProfileEditRequest = m("V1ProfileEditRequest", ProfileEditRequestSchema, "profileeditrequests");
export const VisitorPass = m("V1VisitorPass", VisitorPassSchema, "visitorpasses");
export const Blacklist = m("V1Blacklist", BlacklistSchema, "blacklists");

export { mongoose };