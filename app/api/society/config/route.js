import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import cache from "@/lib/cache";
export async function GET(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    const cacheKey = `society:config:${decoded.societyId}`;
    const society = await cache.getOrSet(
      cacheKey,
      () => Society.findById(decoded.societyId).lean(),
      900, // 15 min
    );
    if (!society)
      return NextResponse.json({ error: "Society not found" }, { status: 404 });
    return NextResponse.json({ society });
  } catch (error) {
    console.error("Fetch society config error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
