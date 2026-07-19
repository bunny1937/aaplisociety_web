// POST /api/admin/tenant-requests/:id/confirm-move-out
// Admin's half of the two-party permanent close-out (owner's half is
// POST /v1/tenant-requests/:id/confirm-move-out on the mobile-backend — see
// that plan's Task 8). Whichever side confirms second finalizes.
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import TenantRequest from "@/models/TenantRequest";
import Member from "@/models/Member";
import { requireRoles } from "@/lib/authz";
import { logAudit } from "@/lib/audit-logger";

export async function POST(request, { params }) {
  const auth = requireRoles(request, ["Admin", "Secretary"]);
  if (!auth.valid) return auth;

  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return NextResponse.json({ error: "Valid id required" }, { status: 400 });

  try {
    await connectDB();
    const tenantRequest = await TenantRequest.findOne({ _id: id, societyId: auth.user.societyId });
    if (!tenantRequest) return NextResponse.json({ error: "Not found" }, { status: 404 });

    tenantRequest.adminConfirmedMoveOutAt = new Date();

    if (tenantRequest.ownerConfirmedMoveOutAt) {
      const member = await Member.findById(tenantRequest.memberId);
      if (member) {
        member.moveCurrentTenantToHistory("Move-out confirmed by admin and owner");
        await member.save();
      }
      tenantRequest.status = "Closed";
    }
    await tenantRequest.save();

    await logAudit(auth.user.userId, auth.user.societyId, "TENANT_MOVE_OUT_CONFIRMED", null, {
      tenantRequestId: String(tenantRequest._id),
      finalized: tenantRequest.status === "Closed",
    });

    return NextResponse.json({ success: true, tenantRequest });
  } catch (err) {
    console.error("Tenant move-out confirm error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
