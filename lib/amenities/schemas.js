import { z } from "zod";
import {
  AMENITY_STATUSES, ATTENDANCE_MODES, ACCESS_AUDIENCES, RULE_KINDS,
  CLOSURE_TYPES, INCIDENT_SEVERITIES, INCIDENT_STATUSES, EVENT_STATUS,
  ATTENDEE_TYPES, DAYS_OF_WEEK, QR_MODES,
} from "./constants";

// Request validation for every amenity endpoint.
//
// Messages are written for the person filling in the form, not for a developer:
// they surface directly in the admin UI and in the app's error toast.

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid identifier");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM format");
const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");
const dow = z.number().int().refine((v) => DAYS_OF_WEEK.includes(v), "Day must be 0 (Sunday) to 6");

// ---------------------------------------------------------------- categories
export const categoryCreateSchema = z.object({
  name: z.string().trim().min(2, "Category name must be at least 2 characters").max(80),
  description: z.string().trim().max(500).optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});
export const categoryUpdateSchema = categoryCreateSchema.partial();

export const reorderSchema = z.object({
  order: z.array(z.object({ id: objectId, displayOrder: z.number().int().min(0) }))
    .min(1, "Send at least one item to reorder"),
});

// ---------------------------------------------------------------- amenities
const accessSchema = z.object({
  audience: z.enum(ACCESS_AUDIENCES).optional(),
  customRoles: z.array(z.string().trim().min(1)).optional(),
  minAge: z.number().int().min(0).max(120).nullable().optional(),
  maxAge: z.number().int().min(0).max(120).nullable().optional(),
});

const capacitySchema = z.object({
  unlimited: z.boolean().optional(),
  maxOccupancy: z.number().int().min(1).nullable().optional(),
  warningThresholdPct: z.number().int().min(1).max(100).optional(),
});

const slotPolicySchema = z.object({
  enabled: z.boolean().optional(),
  slotDurationMins: z.number().int().min(5, "Slots must be at least 5 minutes").max(1440).optional(),
  gapBetweenSlotsMins: z.number().int().min(0).max(240).optional(),
  bufferTimeMins: z.number().int().min(0).max(240).optional(),
  maxCapacityPerSlot: z.number().int().min(1).nullable().optional(),
});

const visitorPolicySchema = z.object({
  allowed: z.boolean().optional(),
  maxVisitorsPerResident: z.number().int().min(0).max(100).optional(),
  maxVisitorsTotal: z.number().int().min(0).nullable().optional(),
  allowedFrom: hhmm.nullable().optional(),
  allowedTo: hhmm.nullable().optional(),
  approvalRequired: z.boolean().optional(),
  allowedVisitorTypes: z.array(z.string().trim().min(1)).optional(),
});

const contactPersonSchema = z.object({
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(20).optional(),
  role: z.string().trim().max(80).optional(),
});

const amenityBase = {
  name: z.string().trim().min(2, "Amenity name must be at least 2 characters").max(120),
  categoryId: objectId,
  description: z.string().trim().max(2000).optional(),
  location: z.string().trim().max(200).optional(),
  contactPerson: contactPersonSchema.optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
  operatingDays: z.array(dow).optional(),
  openingTime: hhmm.optional(),
  closingTime: hhmm.optional(),
  access: accessSchema.optional(),
  capacity: capacitySchema.optional(),
  slotPolicy: slotPolicySchema.optional(),
  visitorPolicy: visitorPolicySchema.optional(),
  attendanceMode: z.enum(ATTENDANCE_MODES).optional(),
  featureOverrides: z.record(z.boolean()).optional(),
};

// Cross-field checks that a per-field schema cannot express. A "limited"
// capacity with no maximum, or an age range that excludes everybody, are
// configuration traps rather than typos, so they are rejected here.
function refineAmenity(schema) {
  return schema
    .refine((v) => !(v.capacity?.unlimited === false && !v.capacity?.maxOccupancy), {
      message: "Set a maximum occupancy or mark the capacity unlimited",
      path: ["capacity", "maxOccupancy"],
    })
    .refine((v) => {
      const { minAge, maxAge } = v.access || {};
      return !(minAge != null && maxAge != null && minAge > maxAge);
    }, { message: "Minimum age cannot be greater than maximum age", path: ["access", "minAge"] })
    .refine((v) => !(v.slotPolicy?.enabled && v.slotPolicy?.bufferTimeMins != null &&
      v.slotPolicy?.slotDurationMins != null && v.slotPolicy.bufferTimeMins >= v.slotPolicy.slotDurationMins), {
      message: "Buffer time must be shorter than the slot duration",
      path: ["slotPolicy", "bufferTimeMins"],
    })
    .refine((v) => {
      if (!v.openingTime || !v.closingTime) return true;
      return v.closingTime > v.openingTime;
    }, { message: "Closing time must be after opening time", path: ["closingTime"] });
}

export const amenityCreateSchema = refineAmenity(z.object(amenityBase));
// Status is intentionally absent: it is only writable via the status endpoint,
// which also emits notifications and an audit entry. .strict() is load-bearing
// here, not stylistic: without it zod silently drops unknown keys instead of
// rejecting them, which would let a client smuggle `status` (or any
// server-owned field like societyId/liveOccupancy) straight through.
export const amenityUpdateSchema = refineAmenity(z.object(amenityBase).partial().strict());

export const statusChangeSchema = z.object({
  status: z.enum(AMENITY_STATUSES),
  note: z.string().trim().max(500).optional(),
  notify: z.boolean().optional(),
  // Marks the notification critical and bypasses quiet-hours batching.
  isEmergency: z.boolean().optional(),
});

// ---------------------------------------------------------------- rules
export const rulesReplaceSchema = z.object({
  // Whole-set replace. The admin edits rules as one list, so a diffed PUT keeps
  // ordering and deletions consistent; existing _ids are preserved when sent.
  rules: z.array(z.object({
    _id: objectId.optional(),
    kind: z.enum(RULE_KINDS),
    text: z.string().trim().min(1, "Rule text cannot be empty").max(1000),
    displayOrder: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
  })).max(200, "That is more rules than residents will ever read"),
  notify: z.boolean().optional(),
});

// ---------------------------------------------------------------- availability
export const availabilityReplaceSchema = z.object({
  weekly: z.array(z.object({
    dayOfWeek: dow,
    openTime: hhmm,
    closeTime: hhmm,
  })).refine((rows) => rows.every((r) => r.closeTime > r.openTime), {
    message: "Each window must close after it opens",
  }),
  regenerateSlots: z.boolean().optional(),
});

export const closureCreateSchema = z.object({
  closureType: z.enum(CLOSURE_TYPES),
  startDate: isoDate,
  endDate: isoDate,
  reason: z.string().trim().min(1, "Give residents a reason for the closure").max(500),
  allDay: z.boolean().optional(),
  notify: z.boolean().optional(),
}).refine((v) => Date.parse(v.endDate) >= Date.parse(v.startDate), {
  message: "Closure end date must be on or after the start date",
  path: ["endDate"],
});

// ---------------------------------------------------------------- slots
export const slotGenerateSchema = z.object({
  days: z.array(dow).optional(),
  slotDurationMins: z.number().int().min(5).max(1440).optional(),
  gapBetweenSlotsMins: z.number().int().min(0).max(240).optional(),
  bufferTimeMins: z.number().int().min(0).max(240).optional(),
  maxCapacityPerSlot: z.number().int().min(1).nullable().optional(),
  // Hand-tuned slots survive regeneration unless this is set.
  replaceCustom: z.boolean().optional(),
  // Lets the admin preview the generated grid before committing.
  dryRun: z.boolean().optional(),
});

export const slotUpsertSchema = z.object({
  dayOfWeek: dow,
  startTime: hhmm,
  endTime: hhmm,
  capacity: z.number().int().min(1).nullable().optional(),
  label: z.string().trim().max(80).optional(),
  isActive: z.boolean().optional(),
}).refine((v) => v.endTime > v.startTime, {
  message: "Slot end time must be after the start time",
  path: ["endTime"],
});

// ---------------------------------------------------------------- maintenance
export const maintenanceCreateSchema = z.object({
  amenityId: objectId,
  startDate: isoDate,
  endDate: isoDate,
  reason: z.string().trim().min(3, "Give a reason for the maintenance").max(500),
  notes: z.string().trim().max(2000).optional(),
  notify: z.boolean().optional(),
}).refine((v) => Date.parse(v.endDate) > Date.parse(v.startDate), {
  message: "Maintenance must end after it starts",
  path: ["endDate"],
});

export const maintenanceUpdateSchema = z.object({
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  reason: z.string().trim().min(3).max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  notify: z.boolean().optional(),
});

export const maintenanceExtendSchema = z.object({
  newEndDate: isoDate,
  reason: z.string().trim().min(3, "Explain why the maintenance is being extended").max(500),
  notes: z.string().trim().max(2000).optional(),
  notify: z.boolean().optional(),
});

export const maintenanceReopenSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
  // Defaults to whatever the amenity was before maintenance began.
  restoreStatus: z.enum(AMENITY_STATUSES).optional(),
  notify: z.boolean().optional(),
});

// ---------------------------------------------------------------- events
export const eventCreateSchema = z.object({
  amenityId: objectId,
  title: z.string().trim().min(3, "Give the event a title").max(150),
  description: z.string().trim().max(4000).optional(),
  organizerName: z.string().trim().max(120).optional(),
  organizerPhone: z.string().trim().max(20).optional(),
  venue: z.string().trim().max(200).optional(),
  startAt: isoDate,
  endAt: isoDate,
  capacity: z.number().int().min(1).nullable().optional(),
  registrationRequired: z.boolean().optional(),
  registrationDeadline: isoDate.nullable().optional(),
  guestsAllowed: z.boolean().optional(),
  maxGuestsPerRegistration: z.number().int().min(0).max(20).optional(),
  waitlistEnabled: z.boolean().optional(),
  status: z.enum([EVENT_STATUS.DRAFT, EVENT_STATUS.PUBLISHED]).optional(),
  // Lets an admin schedule a society meeting outside normal operating hours.
  ignoreAvailability: z.boolean().optional(),
  notify: z.boolean().optional(),
}).refine((v) => Date.parse(v.endAt) > Date.parse(v.startAt), {
  message: "Event must end after it starts",
  path: ["endAt"],
});

export const eventUpdateSchema = z.object({
  title: z.string().trim().min(3).max(150).optional(),
  description: z.string().trim().max(4000).optional(),
  organizerName: z.string().trim().max(120).optional(),
  organizerPhone: z.string().trim().max(20).optional(),
  venue: z.string().trim().max(200).optional(),
  startAt: isoDate.optional(),
  endAt: isoDate.optional(),
  capacity: z.number().int().min(1).nullable().optional(),
  registrationRequired: z.boolean().optional(),
  registrationDeadline: isoDate.nullable().optional(),
  guestsAllowed: z.boolean().optional(),
  maxGuestsPerRegistration: z.number().int().min(0).max(20).optional(),
  waitlistEnabled: z.boolean().optional(),
  status: z.enum([EVENT_STATUS.DRAFT, EVENT_STATUS.PUBLISHED, EVENT_STATUS.COMPLETED]).optional(),
  ignoreAvailability: z.boolean().optional(),
  notify: z.boolean().optional(),
});

export const eventRegisterSchema = z.object({
  memberId: objectId.optional(),
  guestCount: z.number().int().min(0).max(20).optional(),
  note: z.string().trim().max(300).optional(),
});

export const registrationCancelSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

export const registrationMarkSchema = z.object({
  registrationId: objectId,
  status: z.enum(["ATTENDED", "NO_SHOW"]),
});

export const waitlistJoinSchema = z.object({
  memberId: objectId.optional(),
  guestCount: z.number().int().min(0).max(20).optional(),
});

// ---------------------------------------------------------------- attendance
export const checkInSchema = z.object({
  amenityId: objectId,
  attendeeType: z.enum(ATTENDEE_TYPES).optional(),
  memberId: objectId.optional(),
  residentName: z.string().trim().max(120).optional(),
  flatNo: z.string().trim().max(30).optional(),
  occupancyType: z.string().trim().max(20).optional(),
  visitorId: objectId.optional(),
  visitorName: z.string().trim().max(120).optional(),
  visitorPhone: z.string().trim().max(20).optional(),
  hostMemberId: objectId.optional(),
  eventId: objectId.optional(),
  guestCount: z.number().int().min(0).max(50).optional(),
  notes: z.string().trim().max(500).optional(),
  // Required when forcing entry past a rule; the route also checks the caller
  // holds OVERRIDE_ATTENDANCE.
  overrideReason: z.string().trim().max(300).optional(),
}).refine((v) => v.attendeeType !== "VISITOR" || Boolean(v.visitorName || v.visitorId), {
  message: "Visitor name is required for a visitor check-in",
  path: ["visitorName"],
}).refine((v) => v.attendeeType === "VISITOR" || Boolean(v.memberId || v.residentName), {
  message: "Select the resident checking in",
  path: ["memberId"],
});

export const checkOutSchema = z.object({
  attendanceId: objectId.optional(),
  amenityId: objectId.optional(),
  memberId: objectId.optional(),
  visitorPhone: z.string().trim().max(20).optional(),
}).refine((v) => Boolean(v.attendanceId || (v.amenityId && (v.memberId || v.visitorPhone))), {
  message: "Identify the check-in to close, or the amenity and person",
});

export const attendanceAdjustSchema = z.object({
  timeIn: isoDate.optional(),
  timeOut: isoDate.nullable().optional(),
  notes: z.string().trim().max(500).optional(),
  // Mandatory: an attendance correction without a stated reason is not auditable.
  reason: z.string().trim().min(3, "Record why this attendance is being adjusted").max(300),
});

export const autoCheckoutSchema = z.object({
  amenityId: objectId.optional(),
  afterMins: z.number().int().min(15).max(1440).optional(),
});

// ---------------------------------------------------------------- QR
export const qrGenerateSchema = z.object({
  mode: z.enum(QR_MODES).optional(),
  label: z.string().trim().max(100).optional(),
  locationHint: z.string().trim().max(150).optional(),
  rotationIntervalMins: z.number().int().min(1).max(10080).nullable().optional(),
  expiresAt: isoDate.nullable().optional(),
});

export const qrScanSchema = z.object({
  token: z.string().min(6, "Scan a valid amenity QR code"),
  // Omitted means "toggle": check out if a session is open, otherwise check in.
  direction: z.enum(["IN", "OUT"]).optional(),
  memberId: objectId.optional(),
  attendeeType: z.enum(ATTENDEE_TYPES).optional(),
  residentName: z.string().trim().max(120).optional(),
  flatNo: z.string().trim().max(30).optional(),
  occupancyType: z.string().trim().max(20).optional(),
  visitorName: z.string().trim().max(120).optional(),
  visitorPhone: z.string().trim().max(20).optional(),
  eventId: objectId.optional(),
  locationHint: z.string().trim().max(150).optional(),
});

// ---------------------------------------------------------------- visitors
export const amenityVisitorCreateSchema = z.object({
  amenityId: objectId,
  visitorName: z.string().trim().min(2, "Enter the visitor's name").max(120),
  visitorPhone: z.string().trim().max(20).optional(),
  visitorType: z.string().trim().max(50).optional(),
  partySize: z.number().int().min(1).max(50).optional(),
  hostMemberId: objectId,
  expectedAt: isoDate.optional(),
});

export const amenityVisitorDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().max(300).optional(),
});

// ---------------------------------------------------------------- incidents
export const incidentCreateSchema = z.object({
  amenityId: objectId,
  // Free-form: validated against the society's configured incidentTypes at the
  // route, not pinned to a build-time enum.
  incidentType: z.string().trim().min(1, "Choose an issue type").max(80),
  title: z.string().trim().min(3, "Give the incident a short title").max(150),
  description: z.string().trim().min(1, "Describe what happened").max(4000),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  assignedTo: objectId.nullable().optional(),
  linkedAttendanceId: objectId.nullable().optional(),
});

export const incidentUpdateSchema = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  assignedTo: objectId.nullable().optional(),
  incidentType: z.string().trim().min(1).max(80).optional(),
  resolutionNotes: z.string().trim().max(4000).optional(),
  escalationLevel: z.number().int().min(0).max(5).optional(),
});

// ---------------------------------------------------------------- settings
export const settingsUpdateSchema = z.object({
  features: z.record(z.boolean()).optional(),
  incidentTypes: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  customAccessRoles: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
  visitorTypes: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
  timezone: z.string().trim().min(3).max(60).optional(),
  autoCheckoutAfterMins: z.number().int().min(15).max(1440).optional(),
  eventReminderLeadMins: z.number().int().min(5).max(10080).optional(),
  waitlistHoldMins: z.number().int().min(5).max(10080).optional(),
  analyticsRetentionDays: z.number().int().min(30).max(3650).optional(),
  notifyOnStatusChange: z.boolean().optional(),
  notifyOnRulesUpdate: z.boolean().optional(),
});
