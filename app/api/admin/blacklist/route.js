// app/api/admin/blacklist/route.js
// Admin/Secretary watchlist management.
//   GET                 -> list active + inactive entries
//   POST  { name, phone, reason, severity, photo } -> add
//   DELETE ?id=...      -> deactivate (soft remove)
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import Blacklist from "@/models/Blacklist";
import { requireRoles } from "@/lib/authz";
import { logAudit } from "@/lib/audit-logger";
import { isSafePhotoValue } from "@/lib/visitor-config";
export async function GET(request) {
  const auth = requireRoles(request, ["Admin", "Secretary"]);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get("all") === "1";
    const query = { societyId: auth.user.societyId };
    if (!includeInactive) query.active = true;
    const entries = await Blacklist.find(query)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate("addedBy", "name")
      .lean();
    return NextResponse.json({ success: true, entries });
  } catch (err) {
    console.error("Blacklist list error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
export async function POST(request) {
  const auth = requireRoles(request, ["Admin", "Secretary"]);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const body = await request.json();
    const name = String(body.name || "").trim();
    const phoneRaw = String(body.phone || "").trim();
    const reason = String(body.reason || "").trim();
    const severity = ["flag", "block"].includes(body.severity) ? body.severity : "flag";
    const photo = String(body.photo || "").trim();
    if (!reason)
      return NextResponse.json({ error: "reason is required" }, { status: 400 });
    if (!name && !phoneRaw)
      return NextResponse.json(
        { error: "Provide a name or phone to watch" },
        { status: 400 },
      );
    if (!isSafePhotoValue(photo))
      return NextResponse.json(
        { error: "photo must be an uploaded URL" },
        { status: 400 },
      );
    const phone = Blacklist.normalizePhone(phoneRaw);
    // Avoid duplicate active entries for the same phone.
    if (phone) {
      const dup = await Blacklist.findOne({
        societyId: auth.user.societyId,
        phone,
        active: true,
      }).lean();
      if (dup)
        return NextResponse.json(
          { error: "An active watchlist entry already exists for this number" },
          { status: 409 },
        );
    }
    const entry = await Blacklist.create({
      societyId: auth.user.societyId,
      name,
      phone,
      reason,
      severity,
      photo,
      addedBy: auth.user.userId,
      active: true,
    });
    await logAudit(auth.user.userId, auth.user.societyId, "BLACKLIST_ADDED", null, {
      id: entry._id.toString(),
      name,
      phone,
      severity,
    });
    return NextResponse.json({ success: true, entry });
  } catch (err) {
    console.error("Blacklist add error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
export async function DELETE(request) {
  const auth = requireRoles(request, ["Admin", "Secretary"]);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id || !mongoose.Types.ObjectId.isValid(id))
      return NextResponse.json({ error: "Valid id required" }, { status: 400 });
    const entry = await Blacklist.findOneAndUpdate(
      { _id: id, societyId: auth.user.societyId },
      { active: false },
      { new: true },
    );
    if (!entry)
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    await logAudit(auth.user.userId, auth.user.societyId, "BLACKLIST_REMOVED", null, {
      id: entry._id.toString(),
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Blacklist remove error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
