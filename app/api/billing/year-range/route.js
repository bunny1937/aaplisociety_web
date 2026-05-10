import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import { getTokenFromRequest } from "@/lib/jwt";

export async function GET(request) {
  try {
    const decoded = getTokenFromRequest(request);
    if (!decoded)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await connectDB();

    const [minDoc, maxDoc] = await Promise.all([
      Bill.findOne({ societyId: decoded.societyId })
        .sort({ billYear: 1 })
        .select("billYear")
        .lean(),
      Bill.findOne({ societyId: decoded.societyId })
        .sort({ billYear: -1 })
        .select("billYear")
        .lean(),
    ]);

    const now = new Date();
    return NextResponse.json({
      minYear: minDoc?.billYear || now.getFullYear(),
      maxYear: now.getFullYear() + 1,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
