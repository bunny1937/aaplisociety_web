// app/api/auth/login/route.js
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import AuditLog from "@/models/AuditLog";
import { signToken } from "@/lib/jwt";
import { issueRefreshToken, setRefreshCookie } from "@/lib/refresh-token";

const MAX_ATTEMPTS = parseInt(process.env.RATE_LIMIT_LOGIN, 10) || 10;
const WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map();

function checkLoginRateLimit(identifier) {
  const key = identifier.toLowerCase();
  const now = Date.now();
  const entry = loginAttempts.get(key) || {
    count: 0,
    resetAt: now + WINDOW_MS,
  };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + WINDOW_MS;
  }
  entry.count += 1;
  loginAttempts.set(key, entry);
  return entry.count > MAX_ATTEMPTS ? { blocked: true } : { blocked: false };
}

function clearLoginRateLimit(identifier) {
  loginAttempts.delete(identifier.toLowerCase());
}

export async function POST(request) {
  try {
    await connectDB();

    const body = await request.json();

    const rawIdentifier = body.username || body.email || "";
    const rawPassword = body.password;
    if (typeof rawIdentifier !== "string" || typeof rawPassword !== "string") {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 400 },
      );
    }
    const identifier = rawIdentifier.trim().toLowerCase();
    const password = rawPassword;

    if (!identifier || !password) {
      return NextResponse.json(
        { error: "Username/email and password are required" },
        { status: 400 },
      );
    }

    const rateCheck = checkLoginRateLimit(identifier);
    if (rateCheck.blocked) {
      return NextResponse.json(
        { error: "Too many login attempts. Try again later." },
        { status: 429 },
      );
    }

    // Find by username  OR  email  (covers both Member and Admin flows)
    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }],
      isActive: true,
    });

    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const ua = request.headers.get("user-agent") || "unknown";

    if (!user) {
      await AuditLog.create({
        action: "LOGIN_FAILURE",
        newData: { identifier, reason: "user_not_found", ip, ua },
        timestamp: new Date(),
      }).catch(() => {});
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      await AuditLog.create({
        userId: user._id,
        societyId: user.societyId,
        action: "LOGIN_FAILURE",
        newData: { identifier, reason: "wrong_password", ip, ua },
        timestamp: new Date(),
      }).catch(() => {});
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }

    // ── ADMIN / SECRETARY / ACCOUNTANT ───────────────────────────────────────
    // These still carry root-level role + societyId — unchanged flow.
    if (
      [
        "Admin",
        "Secretary",
        "Accountant",
        "Security",
        "SOCIETY_ADMIN",
      ].includes(user.role)
    ) {
      clearLoginRateLimit(identifier);
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
        sameSite: "strict",
        path: "/",
        maxAge: 60 * 60 * 8, // 8 hours
      });
      setRefreshCookie(response, await issueRefreshToken(user._id));

      return response;
    }

    // ── MEMBER — multi-profile logic ─────────────────────────────────────────
    const activeProfiles = (user.profiles ?? []).filter(
      (p) => p.status === "Active",
    );

    // CASE A: single profile → auto-login
    if (activeProfiles.length === 1) {
      clearLoginRateLimit(identifier);
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
        sameSite: "strict",
        path: "/",
        maxAge: 60 * 60 * 8,
      });
      setRefreshCookie(response, await issueRefreshToken(user._id));

      return response;
    }

    // CASE B: multiple profiles → return list, frontend shows selector
    if (activeProfiles.length > 1) {
      clearLoginRateLimit(identifier);
      const profileSelectToken = signToken(
        {
          userId: user._id,
          purpose: "profile-select",
        },
        { expiresIn: "10m" },
      );

      // No cookie yet — user must pick a society first
      return NextResponse.json({
        success: true,
        requiresProfileSelect: true,
        userId: user._id,
        profileSelectToken,
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
