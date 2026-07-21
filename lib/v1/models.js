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

const ProfileSchema = new Schema(
  {
    memberId: { type: ObjectId, ref: "Member" },
    societyId: { type: ObjectId, ref: "Society", index: true },
    role: { type: String, required: true },
    flatNo: String,
    wing: String,
    societyName: String,
    status: { type: String, default: "Active" },
    occupancyType: { type: String, enum: ["Owner", "Tenant"], default: "Owner" },
  },
  { _id: true },
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
    expiresAt: Date,
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, strict: false },
);

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
    memberId: { type: ObjectId, ref: "Member", required: true, index: true },
    requestedByUserId: { type: ObjectId, ref: "User", required: true },
    section: { type: String, enum: ["Contact", "FamilyMember", "EmergencyContact"], required: true },
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
