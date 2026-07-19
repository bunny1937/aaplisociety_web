// app/api/auth/logout/route.js
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { revokeRefreshToken, clearRefreshCookie } from "@/lib/refresh-token";

export async function POST(request) {
  const refreshCookie = request.cookies.get("refreshToken")?.value;
  if (refreshCookie) {
    try {
      await connectDB();
      await revokeRefreshToken(refreshCookie);
    } catch (err) {
      // Best-effort: a DB hiccup here must not block the user from logging
      // out client-side — the access token cookie is cleared below
      // regardless, and an unrevoked refresh token still expires on its own.
      console.error("Refresh token revocation failed during logout:", err);
    }
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set("token", "", {
    maxAge: 0,
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
  res.cookies.set("admin_token", "", {
    maxAge: 0,
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
  clearRefreshCookie(res);
  return res;
}
