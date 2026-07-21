// POST /api/admin/profile-edit-requests/:id/approve
// Applies the request's payload onto the flat's canonical Member document
// (see lib/profile-edit-apply.js), marks the request Approved, and notifies
// the owner. Mirrors app/api/admin/tenant-requests/[id]/approve/route.js's
// structure.
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import ProfileEditRequest from "@/models/ProfileEditRequest";
import Member from "@/models/Member";
import { requireRoles } from "@/lib/authz";
import { logAudit } from "@/lib/audit-logger";
import { applyProfileEditPayload } from "@/lib/profile-edit-apply";
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
    const editRequest = await ProfileEditRequest.findOne({
      _id: id,
      societyId: auth.user.societyId,
      status: "Pending",
    });
    if (!editRequest)
      return NextResponse.json({ error: "No pending request found for that id" }, { status: 404 });
    const member = await Member.findOne({ _id: editRequest.memberId, societyId: auth.user.societyId });
    if (!member) return NextResponse.json({ error: "Flat not found" }, { status: 404 });
    try {
      applyProfileEditPayload(member, editRequest);
    } catch (err) {
      if (err.code === "FAMILY_MEMBER_NOT_FOUND") {
        return NextResponse.json({ error: "That family member no longer exists on this flat" }, { status: 409 });
      }
      throw err;
    }
    await member.save();
    editRequest.status = "Approved";
    editRequest.approvedBy = auth.user.userId;
    editRequest.approvedAt = new Date();
    await editRequest.save();
    const notif = buildProfileEditDecisionNotification({
      decision: "approved",
      section: editRequest.section,
      flatNo: member.flatNo,
    });
    await sendInApp({
      societyId: auth.user.societyId,
      createdBy: auth.user.userId,
      createdByName: "Admin",
      type: notif.type,
      title: notif.title,
      message: notif.message,
      recipientType: "member",
      // The flat's Member._id — not requestedByUserId — matches every other
      // recipientType:"member" emitter in this app (see tenant-requests'
      // approve/reject routes for the same fix and its rationale).
      recipientIds: [String(member._id)],
      metadata: { profileEditRequestId: String(editRequest._id) },
    });
    await logAudit(auth.user.userId, auth.user.societyId, "PROFILE_EDIT_REQUEST_APPROVED", null, {
      profileEditRequestId: String(editRequest._id),
      memberId: String(member._id),
      section: editRequest.section,
      action: editRequest.action,
    });
    return NextResponse.json({ success: true, profileEditRequest: editRequest });
  } catch (err) {
    console.error("Profile edit request approve error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
