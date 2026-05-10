// app/api/auth/login/route.js
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { signToken } from "@/lib/jwt";

export async function POST(request) {
  try {
    await connectDB();

    const body = await request.json();

    // Accept either "username" or legacy "email" field from body
    // (Admin login still sends email; Member login sends username)
    const identifier = (body.username || body.email || "").trim().toLowerCase();
    const { password } = body;

    if (!identifier || !password) {
      return NextResponse.json(
        { error: "Username/email and password are required" },
        { status: 400 },
      );
    }

    // Find by username  OR  email  (covers both Member and Admin flows)
    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }],
      isActive: true,
    });

    if (!user) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }

    // ── ADMIN / SECRETARY / ACCOUNTANT ───────────────────────────────────────
    // These still carry root-level role + societyId — unchanged flow.
    if (
      ["Admin", "Secretary", "Accountant", "SOCIETY_ADMIN"].includes(user.role)
    ) {
      const token = signToken({
        userId: user._id,
        email: user.email,
        role: user.role,
        societyId: user.societyId,
        societyCode: user.societyCode,
      });

      const response = NextResponse.json({
        success: true,
        message: "Login successful",
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          societyId: user.societyId,
        },
      });

      response.cookies.set("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 8, // 8 hours
      });

      return response;
    }

    // ── MEMBER — multi-profile logic ─────────────────────────────────────────
    const activeProfiles = (user.profiles ?? []).filter(
      (p) => p.status === "Active",
    );

    // CASE A: single profile → auto-login
    if (activeProfiles.length === 1) {
      const profile = activeProfiles[0];

      // Persist activeProfileId
      await User.updateOne(
        { _id: user._id },
        { activeProfileId: profile.profileId },
      );

      const token = signToken({
        userId: user._id,
        activeProfileId: profile.profileId,
        memberId: profile.memberId,
        societyId: profile.societyId,
        role: profile.role,
      });

      const response = NextResponse.json({
        success: true,
        requiresProfileSelect: false,
        user: {
          id: user._id,
          name: user.name,
          username: user.username,
          role: profile.role,
          societyId: profile.societyId,
          memberId: profile.memberId,
          flatNo: profile.flatNo,
          wing: profile.wing,
          societyName: profile.societyName,
          activeProfile: profile,
        },
      });

      response.cookies.set("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 8,
      });

      return response;
    }

    // CASE B: multiple profiles → return list, frontend shows selector
    if (activeProfiles.length > 1) {
      // No cookie yet — user must pick a society first
      return NextResponse.json({
        success: true,
        requiresProfileSelect: true,
        userId: user._id,
        name: user.name,
        username: user.username,
        profiles: activeProfiles.map((p) => ({
          profileId: p.profileId,
          societyId: p.societyId,
          societyName: p.societyName,
          flatNo: p.flatNo,
          wing: p.wing,
          role: p.role,
        })),
      });
    }

    // CASE C: Member with zero active profiles (edge case / misconfigured)
    return NextResponse.json(
      { error: "No active society profiles found for this account" },
      { status: 403 },
    );
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
