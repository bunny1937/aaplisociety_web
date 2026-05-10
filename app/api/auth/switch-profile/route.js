// app/api/auth/switch-profile/route.js
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { signToken } from "@/lib/jwt";

export async function POST(request) {
  try {
    await connectDB();

    const body = await request.json();
    const { profileId, userId: bodyUserId } = body;

    if (!profileId) {
      return NextResponse.json({ error: "profileId is required" }, { status: 400 });
    }

    // Auth: existing token (profile switch) OR userId from body (post-login society select)
    const userToken = request.cookies.get("token")?.value;
    let resolvedUserId;

    if (userToken) {
      let decoded;
      try {
        decoded = jwt.verify(userToken, process.env.JWT_SECRET);
      } catch {
        return NextResponse.json({ error: "Invalid token" }, { status: 401 });
      }
      resolvedUserId = decoded.userId;
    } else if (bodyUserId) {
      resolvedUserId = bodyUserId;
    } else {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await User.findById(resolvedUserId);
    if (!user || !user.isActive) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Find the requested profile
    const profile = user.profiles.find(
      (p) => String(p.profileId) === String(profileId) && p.status === "Active",
    );

    if (!profile) {
      return NextResponse.json(
        { error: "Profile not found or inactive" },
        { status: 404 },
      );
    }

    // Persist activeProfileId on user document
    await User.updateOne(
      { _id: user._id },
      { activeProfileId: profile.profileId },
    );

    // Issue fresh JWT — include profile fields so member API routes work
    const newToken = signToken({
      userId: user._id,
      activeProfileId: profile.profileId,
      memberId: profile.memberId,
      societyId: profile.societyId,
      role: profile.role,
    });

    const response = NextResponse.json({
      success: true,
      activeProfile: {
        profileId: profile.profileId,
        societyId: profile.societyId,
        memberId: profile.memberId,
        societyName: profile.societyName,
        flatNo: profile.flatNo,
        wing: profile.wing,
        role: profile.role,
      },
      user: {
        id: user._id,
        name: user.name,
        username: user.username,
      },
    });

    response.cookies.set("token", newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    });

    return response;
  } catch (error) {
    console.error("switch-profile error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
