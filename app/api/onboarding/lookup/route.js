// POST /api/onboarding/lookup
//
// Step 1 of the app onboarding flow. "Does an account exist for this email?"
//
// This route is the single gate that decides which screen the app shows:
//   NEW_ACCOUNT      -> the account exists in DB but has never been set up
//   EXISTING_ACCOUNT -> already set up; show its flats, allow claiming more
//   PROHIBITED       -> no member record anywhere. Dead end, by design.
//
// SECURITY NOTES - read before changing anything here.
//
// 1. This endpoint is UNAUTHENTICATED, so it is an email-enumeration surface.
//    It is mitigated, not eliminated:
//      - a signed onboarding token is REQUIRED unless the caller provides a
//        valid societyCode + flatNo pair, so you cannot walk it with a plain
//        email list;
//      - responses are shape-identical and constant-ish time;
//      - it is rate limited per IP.
//    Do NOT "simplify" this by accepting a bare email. That would let anyone
//    test whether an address lives in the platform.
//
// 2. It never returns a password, a username, a member id, or a full email.
//    Flat labels only, which the caller already proved they know.
//
// 3. PROHIBITED is deliberately a hard stop. The app must not offer a
//    "create account anyway" path - a member row has to be created by an
//    admin import first. This is what the user asked for: "that new account
//    should exist in db if no then prohibited".

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import Member from "@/models/Member";
import Society from "@/models/Society";
import { verifyToken } from "@/lib/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-IP throttle. In-memory, matching the pattern already used by
// /api/auth/login. Resets on cold start, which is acceptable for a
// low-value-per-attempt enumeration surface.
const MAX_LOOKUPS = 12;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map();

function throttle(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) {
    attempts.set(ip, { first: now, count: 1 });
    return true;
  }
  rec.count += 1;
  // Opportunistic sweep so the Map cannot grow without bound on a warm lambda.
  if (attempts.size > 5000) {
    for (const [k, v] of attempts) if (now - v.first > WINDOW_MS) attempts.delete(k);
  }
  return rec.count <= MAX_LOOKUPS;
}

function maskEmail(email) {
  const [local, domain] = String(email).split("@");
  if (!domain) return "***";
  const head = local.slice(0, 2);
  return `${head}${"*".repeat(Math.max(3, local.length - 2))}@${domain}`;
}

export async function POST(request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (!throttle(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a few minutes." },
      { status: 429 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = String(body.email || "").trim().toLowerCase();
  const token = body.token ? String(body.token) : null;
  const societyCode = String(body.societyCode || "").trim().toUpperCase();
  const flatNo = String(body.flatNo || "").trim().toUpperCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  // ── Proof of possession ──────────────────────────────────────────────
  // Either a signed onboarding token from the email, or society + flat, which
  // only someone who lives there plausibly knows.
  let tokenUserId = null;

  if (token) {
    const decoded = verifyToken(token);
    if (!decoded || decoded.purpose !== "onboarding") {
      return NextResponse.json(
        {
          outcome: "LINK_INVALID",
          message:
            "This activation link is invalid or has expired. Ask your society admin to resend it.",
        },
        { status: 400 },
      );
    }
    tokenUserId = decoded.userId;
  } else if (!societyCode || !flatNo) {
    return NextResponse.json(
      {
        error: "PROOF_REQUIRED",
        message:
          "Open the activation link from your email, or enter your society code and flat number.",
      },
      { status: 400 },
    );
  }

  await connectDB();

  // ── Find every account holding this email ───────────────────────────────
  // Plural on purpose. Imports run before the multi-flat fix landed may have
  // produced several User docs sharing one email (see BULK-IMPORT-PATCH.md).
  // We surface that instead of silently picking one, because silently picking
  // one is exactly the bug that hid Bhavani's other two flats.
  const users = await User.find({ email }).lean();

  if (users.length === 0) {
    return NextResponse.json({
      outcome: "PROHIBITED",
      message:
        "No flat on this platform is registered to this email. Your society admin must add you first — accounts cannot be created from the app.",
      maskedEmail: maskEmail(email),
    });
  }

  // If a token was supplied it must belong to one of these accounts. Guards
  // against pasting someone else's link alongside your own email.
  if (tokenUserId && !users.some((u) => String(u._id) === String(tokenUserId))) {
    return NextResponse.json(
      {
        outcome: "LINK_MISMATCH",
        message:
          "This activation link belongs to a different email address. Enter the email the link was sent to.",
      },
      { status: 403 },
    );
  }

  // Prefer the token's user; otherwise the one that owns the flat quoted.
  let user = tokenUserId
    ? users.find((u) => String(u._id) === String(tokenUserId))
    : null;

  if (!user) {
    user =
      users.find((u) =>
        (u.profiles || []).some(
          (p) => String(p.flatNo || "").toUpperCase() === flatNo,
        ),
      ) || null;

    if (!user) {
      // Email exists but not on that flat. Same generic wording as PROHIBITED
      // so the pair cannot be brute-forced apart.
      return NextResponse.json({
        outcome: "PROHIBITED",
        message:
          "No flat on this platform is registered to this email. Your society admin must add you first — accounts cannot be created from the app.",
        maskedEmail: maskEmail(email),
      });
    }

    // Verify the society code too, so flat number alone is not enough.
    const societies = await Society.find(
      { _id: { $in: (user.profiles || []).map((p) => p.societyId) } },
      { societyCode: 1, societyName: 1 },
    ).lean();
    const codeOk = societies.some(
      (s) => String(s.societyCode || "").toUpperCase() === societyCode,
    );
    if (!codeOk) {
      return NextResponse.json({
        outcome: "PROHIBITED",
        message:
          "No flat on this platform is registered to this email. Your society admin must add you first — accounts cannot be created from the app.",
        maskedEmail: maskEmail(email),
      });
    }
  }

  // ── Build the flat list ──────────────────────────────────────────────
  // Union of profiles across every doc with this email, so a legacy split
  // account still shows all three flats to the member.
  const allProfiles = users.flatMap((u) =>
    (u.profiles || []).map((p) => ({ ...p, _ownerUserId: String(u._id) })),
  );

  const societyIds = [...new Set(allProfiles.map((p) => String(p.societyId)))];
  const societies = await Society.find(
    { _id: { $in: societyIds } },
    { societyName: 1, societyCode: 1 },
  ).lean();
  const societyById = new Map(societies.map((s) => [String(s._id), s]));

  const flats = allProfiles.map((p) => {
    const soc = societyById.get(String(p.societyId));
    return {
      profileId: String(p.profileId),
      flatNo: p.flatNo,
      wing: p.wing || null,
      label: p.wing ? `${p.wing}-${p.flatNo}` : String(p.flatNo),
      societyName: p.societyName || soc?.societyName || "Society",
      occupancyType: p.occupancyType || "Owner",
      role: p.role || "Member",
      status: p.status || "Active",
      isPrimary: !!p.isPrimary,
      // "split" means this flat sits on a different User doc than the one being
      // activated - a legacy artefact the app should report, not paper over.
      split: String(p._ownerUserId) !== String(user._id),
    };
  });

  const needsSetup = users.filter((u) => u.mustChangePassword);
  const isNew = !!user.mustChangePassword;

  return NextResponse.json({
    outcome: isNew ? "NEW_ACCOUNT" : "EXISTING_ACCOUNT",
    maskedEmail: maskEmail(email),
    name: user.name || null,
    // Only revealed once the caller has proven possession, and only so the
    // "existing account" screen can prefill the login field.
    username: isNew ? null : user.username || null,
    flats,
    activatedCount: flats.filter((f) => !f.split || !isNew).length,
    totalFlats: flats.length,
    // Signals a pre-fix split account. The app shows a support note; an admin
    // needs to run the merge script in CHANGES.md.
    splitAccount: users.length > 1,
    pendingSetupCount: needsSetup.length,
    rules: {
      usernamePattern: "^[a-z0-9_-]{4,30}$",
      passwordMinLength: 6,
      passwordNeedsLetterAndDigit: true,
      // The app must make the user retype the email. Same rule as the website:
      // it has to match exactly, no normalisation beyond trim + lowercase.
      requireEmailReentry: true,
    },
  });
}
