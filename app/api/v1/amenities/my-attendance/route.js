import { withRoute, json } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import connectDB from "@/lib/mongodb";
import AmenityAttendance from "@/models/amenities/AmenityAttendance";
import { memberContext, requireCapability } from "@/lib/amenities/memberContext";
import { CAPABILITY } from "@/lib/amenities/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/amenities/my-attendance?page=&limit=&amenityId=
//
// A resident's own visit history. Scoped to memberId from the token, so one
// resident can never read another's attendance.
export const GET = withRoute(async (request) => {
  const claims = await getClaims(request);
  await connectDB();
  const ctx = await memberContext(claims, request);
  requireCapability(ctx, CAPABILITY.VIEW_OWN_ATTENDANCE);

  const sp = new URL(request.url).searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 20));

  const filter = { societyId: ctx.societyId, memberId: ctx.memberId };
  if (sp.get("amenityId")) filter.amenityId = sp.get("amenityId");

  const [records, total, stats] = await Promise.all([
    AmenityAttendance.find(filter)
      .sort({ timeIn: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select("amenityId amenityName timeIn timeOut durationMins slotLabel checkInMethod eventId guestCount autoCheckedOut")
      .lean(),
    AmenityAttendance.countDocuments(filter),
    // Small "your usage" summary for the top of the screen.
    AmenityAttendance.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$amenityName",
          visits: { $sum: 1 },
          totalMins: { $sum: { $ifNull: ["$durationMins", 0] } },
        },
      },
      { $sort: { visits: -1 } },
      { $limit: 5 },
    ]),
  ]);

  return json({
    attendance: records,
    favourites: stats,
    openSession: records.find((r) => !r.timeOut) || null,
    meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  });
});
