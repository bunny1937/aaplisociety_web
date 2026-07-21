import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import SocietyEntry from "@/models/SocietyEntry";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
function auth(request) {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  return verifyToken(token);
}
// GET /api/society-entries?fy=2025
export async function GET(request) {
  const decoded = auth(request);
  if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await connectDB();
  const { searchParams } = new URL(request.url);
  const fy = parseInt(searchParams.get("fy") || "0");
  const query = { societyId: decoded.societyId };
  if (fy) query.fy = fy;
  const entries = await SocietyEntry.find(query)
    .populate("createdBy", "name")
    .sort({ createdAt: -1 })
    .lean();
  return NextResponse.json({ entries });
}
// POST /api/society-entries
export async function POST(request) {
  const decoded = auth(request);
  if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["Admin", "Secretary"].includes(decoded.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await connectDB();
  const body = await request.json();
  const { fy, name, type, entryKind, amount, date, notes } = body;
  if (!fy || !name?.trim() || !entryKind || !amount) {
    return NextResponse.json({ error: "fy, name, entryKind, amount required" }, { status: 400 });
  }
  if (!["income", "expenditure"].includes(entryKind)) {
    return NextResponse.json({ error: "entryKind must be income or expenditure" }, { status: 400 });
  }
  if (isNaN(amount) || Number(amount) <= 0) {
    return NextResponse.json({ error: "amount must be positive number" }, { status: 400 });
  }
  const entry = await SocietyEntry.create({
    societyId: decoded.societyId,
    fy: Number(fy),
    name: name.trim(),
    type: type || "Custom",
    entryKind,
    amount: Number(amount),
    date: date ? new Date(date) : new Date(),
    notes: notes?.trim() || "",
    createdBy: decoded.userId,
  });
  return NextResponse.json({ success: true, entry });
}
// DELETE /api/society-entries?id=<entryId>
export async function DELETE(request) {
  const decoded = auth(request);
  if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["Admin", "Secretary"].includes(decoded.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await connectDB();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const entry = await SocietyEntry.findOneAndDelete({ _id: id, societyId: decoded.societyId });
  if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
