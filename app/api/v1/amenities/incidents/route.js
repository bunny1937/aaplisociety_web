import { z } from "zod";
import connectDB from "@/lib/mongodb";
import { withRoute, json, ApiError, zodError } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import Amenity from "@/models/amenities/Amenity";
import AmenityIncident from "@/models/amenities/AmenityIncident";
import { User as V1User } from "@/lib/v1/models";
import {
  INCIDENT_SEVERITY, INCIDENT_STATUS, SEVERITY_RANK, ACTIVITY_ACTION,
} from "@/lib/amenities/constants";
import { memberContext, requireCapability } from "@/lib/amenities/memberContext";
import { CAPABILITY, AMENITY_ADMIN_ROLES } from "@/lib/amenities/permissions";
import { getSettings } from "@/lib/amenities/settingsService";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { notifyIncidentReported } from "@/lib/amenities/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  amenityId: z.string().regex(/^[a-f\d]{24}$/i, "Select an amenity"),
  incidentType: z.string().trim().min(1, "Choose an issue type").max(80),
  title: z.string().trim().min(3, "Give your report a short title").max(150),
  description: z.string().trim().min(1, "Describe what happened").max(4000),
  severity: z.enum(Object.values(INCIDENT_SEVERITY)).optional(),
});

// GET /api/v1/amenities/incidents
// A resident sees only their own reports — the society's full incident queue is
// an admin surface, and exposing it would reveal every complaint in the building.
export const GET = withRoute(async (request) => {
  const claims = await getClaims(request);
  await connectDB();
  const ctx = await memberContext(claims, request);
  requireCapability(ctx, CAPABILITY.REPORT_INCIDENT);

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit")) || 25, 50);

  const filter = { societyId: ctx.societyId, reportedBy: ctx.userId };
  if (searchParams.get("status")) filter.status = searchParams.get("status");
  if (searchParams.get("amenityId")) filter.amenityId = searchParams.get("amenityId");

  const incidents = await AmenityIncident.find(filter)
    .select("amenityId amenityName incidentType title description severity status resolutionNotes resolutionDate createdAt")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const settings = await getSettings(ctx.societyId);

  return json({
    incidents,
    openCount: incidents.filter((i) =>
      ![INCIDENT_STATUS.RESOLVED, INCIDENT_STATUS.CLOSED, INCIDENT_STATUS.REJECTED].includes(i.status)).length,
    // Sent so the app's picker always matches this society's configured list
    // rather than a hardcoded set.
    incidentTypes: settings.incidentTypes || [],
  });
});

// POST /api/v1/amenities/incidents
export const POST = withRoute(async (request) => {
  const claims = await getClaims(request);
  await connectDB();
  const ctx = await memberContext(claims, request);
  requireCapability(ctx, CAPABILITY.REPORT_INCIDENT);

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return zodError(parsed);
  const body = parsed.data;

  const amenity = await Amenity.findOne({
    _id: body.amenityId, societyId: ctx.societyId, isDeleted: false,
  }).select("name").lean();
  if (!amenity) throw new ApiError(404, "That amenity could not be found");

  const settings = await getSettings(ctx.societyId);
  const allowed = settings.incidentTypes || [];
  if (allowed.length && !allowed.includes(body.incidentType)) {
    throw new ApiError(422, {
      error: `"${body.incidentType}" is not one of your society's issue types`,
      allowedTypes: allowed,
    });
  }

  // Residents cannot self-assign CRITICAL; severity is triaged by the committee.
  // Defaulting to LOW keeps the admin queue's severity ordering meaningful.
  const severity = body.severity === INCIDENT_SEVERITY.CRITICAL
    ? INCIDENT_SEVERITY.LOW
    : body.severity || INCIDENT_SEVERITY.LOW;

  const incident = await AmenityIncident.create({
    societyId: ctx.societyId,
    amenityId: body.amenityId,
    amenityName: amenity.name,
    incidentType: body.incidentType,
    title: body.title,
    description: body.description,
    severity,
    severityRank: SEVERITY_RANK[severity] || 1,
    status: INCIDENT_STATUS.OPEN,
    reportedBy: ctx.userId,
    reportedByName: ctx.member?.name || "",
    reportedByRole: ctx.role,
    reportedByFlat: ctx.flatLabel,
  });

  // Notify the committee, not the whole society: an incident report is not news.
  const admins = await V1User.find({
    societyId: ctx.societyId,
    role: { $in: AMENITY_ADMIN_ROLES },
    isActive: { $ne: false },
  }).select("_id").lean();

  await notifyIncidentReported({
    societyId: ctx.societyId,
    incident,
    adminUserIds: admins.map((a) => a._id),
    actor: ctx.actor,
  });

  await logAmenityActivity({
    societyId: ctx.societyId,
    entityType: "INCIDENT",
    entityId: incident._id,
    amenityId: body.amenityId,
    amenityName: amenity.name,
    action: ACTIVITY_ACTION.INCIDENT_REPORTED,
    actor: ctx.actor,
    newValue: { incidentType: body.incidentType, title: body.title, severity },
  });

  return json({
    incident,
    message: "Thanks — your report has been sent to the committee.",
  }, { status: 201 });
});
