<<<<<<< Updated upstream
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import { requireRoles } from "@/lib/authz";

export async function GET(request) {
  const auth = requireRoles(request, ["Security"]);
  if (!auth.valid) return auth;

  try {
    await connectDB();

    const { searchParams } = new URL(request.url);
    const q = String(searchParams.get("q") || "").trim();

    if (!q) {
      return NextResponse.json({ success: true, flats: [] });
    }

    const flats = await Member.find({
      societyId: auth.user.societyId,
      isDeleted: { $ne: true },
      $or: [
        { flatNo: { $regex: q, $options: "i" } },
        { wing: { $regex: q, $options: "i" } },
        { ownerName: { $regex: q, $options: "i" } },
        { tenantName: { $regex: q, $options: "i" } },
      ],
    })
      .select(
        "flatNo wing ownerName tenantName ownershipType currentTenant contactNumber",
      )
      .sort({ wing: 1, flatNo: 1 })
      .limit(20)
      .lean();

    return NextResponse.json({ success: true, flats });
  } catch (err) {
    console.error("Security flat search error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
=======
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import { requireRoles } from "@/lib/authz";

export async function GET(request) {
  const auth = requireRoles(request, ["Security"]);
  if (!auth.valid) return auth;

  try {
    await connectDB();

    const { searchParams } = new URL(request.url);
    const q = String(searchParams.get("q") || "").trim();

    if (!q) {
      return NextResponse.json({ success: true, flats: [] });
    }

    const flats = await Member.find({
      societyId: auth.user.societyId,
      isDeleted: { $ne: true },
      $or: [
        { flatNo: { $regex: q, $options: "i" } },
        { wing: { $regex: q, $options: "i" } },
        { ownerName: { $regex: q, $options: "i" } },
        { tenantName: { $regex: q, $options: "i" } },
      ],
    })
      .select(
        "flatNo wing ownerName tenantName ownershipType currentTenant contactNumber",
      )
      .sort({ wing: 1, flatNo: 1 })
      .limit(20)
      .lean();

    return NextResponse.json({ success: true, flats });
  } catch (err) {
    console.error("Security flat search error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
>>>>>>> Stashed changes
