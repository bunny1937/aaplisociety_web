// POST /api/admin/profile-edit-requests/:id/reject  { reason: string }
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import ProfileEditRequest from "@/models/ProfileEditRequest";
import Member from "@/models/Member";
import { requireRoles } from "@/lib/authz";
import { logAudit } from "@/lib/audit-logger";
import { buildProfileEditDecisionNotification } from "@/lib/profile-edit-notifications";
import { sendInApp } from "@/lib/visitor-channels";

export async function POST(request, { params }) {
  const auth = requireRoles(request, ["Admin", "Secretary"]);
  if (!auth.valid) return auth;

  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return NextResponse.json({ error: "Valid id required" }, { status: 400 });

  try {
    await connectDB();
    const body = await request.json().catch(() => ({}));
    const reason = String(body.reason || "").trim();

    const editRequest = await ProfileEditRequest.findOne({
      _id: id,
      societyId: auth.user.societyId,
      status: "Pending",
    });
    if (!editRequest)
      return NextResponse.json({ error: "No pending request found for that id" }, { status: 404 });

    const member = await Member.findOne({ _id: editRequest.memberId, societyId: auth.user.societyId }).lean();

    editRequest.status = "Rejected";
    editRequest.rejectionReason = reason || undefined;
    await editRequest.save();

    const notif = buildProfileEditDecisionNotification({
      decision: "rejected",
      section: editRequest.section,
      flatNo: member?.flatNo || "your flat",
      rejectionReason: reason || undefined,
    });
    await sendInApp({
      societyId: auth.user.societyId,
      createdBy: auth.user.userId,
      createdByName: "Admin",
      type: notif.type,
      title: notif.title,
      message: notif.message,
      recipientType: "member",
      recipientIds: [String(editRequest.memberId)],
      metadata: { profileEditRequestId: String(editRequest._id) },
    });

    await logAudit(auth.user.userId, auth.user.societyId, "PROFILE_EDIT_REQUEST_REJECTED", null, {
      profileEditRequestId: String(editRequest._id),
      reason,
    });

    return NextResponse.json({ success: true, profileEditRequest: editRequest });
  } catch (err) {
    console.error("Profile edit request reject error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
