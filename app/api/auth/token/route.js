import { NextResponse } from "next/server";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
export async function GET(request) {
  const token = getTokenFromRequest(request);
  if (!token || !verifyToken(token)) {
    return NextResponse.json({ token: null });
  }
  return NextResponse.json({ token });
}
