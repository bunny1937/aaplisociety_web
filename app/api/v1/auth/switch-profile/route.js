// app/api/v1/auth/switch-profile/route.js
//
// FIX APPLIED HERE: accept the pending token from the request BODY as well as
// the Authorization header.
//
// The app was patched to send it in the body:
//
//   dio.post('/auth/switch-profile', data: {
//     'profileId': ..., 'profileSelectToken': ...,
//   });
//
// while this route only ever read the header via getClaims(). The Dio
// interceptor sets Authorization from TokenStore, and at this point in the
// flow TokenStore is empty - login returned a pending token instead of a real
// token pair, and the app deliberately does not persist it. So the header was
// absent and every selection came back 401 "No token".
//
// Reading both is the right resolution rather than forcing one:
//
//   - header  : what the current /v1 clients and the web caller already send
//   - body    : what a client without a cookie jar or token store can send
//               without polluting its global auth interceptor with a
//               short-lived token that must never be persisted
//
// Security is unchanged either way. The token is a signed JWT carrying
// pending: true and a 15-minute TTL; where it travels does not affect what it
// proves. The body is TLS-encrypted exactly like the header, and unlike a
// header it will not be captured by proxy access logs that record
// Authorization.

import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import { verifyAccess } from "@/lib/v1/jwt";
import { profileSelectSchema } from "@/lib/v1/schemas";
import { User } from "@/lib/v1/models";
import { issueTokens } from "@/lib/v1/authService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The app has no Authorization header at this moment: login returned a
// pending token that is deliberately not persisted to TokenStore, so it
// sends it in the body. Same signed JWT, same pending claim, same 15m TTL —
// only the transport differs, and a body is not captured by proxy logs that
// record Authorization.
function claimsFrom(req, bodyToken) {
  // The body token is request-scoped and deliberately not persisted, so it is
  // always the caller's real intent. The Authorization header is whatever the
  // interceptor happened to have in TokenStore — possibly a stale session from
  // a previous login, which silently resolves to the wrong user.
  if (bodyToken) {
    try {
      const claims = verifyAccess(bodyToken);
      if (claims.pending) return claims;
    } catch {
      throw new ApiError(401, "Profile selection expired. Please sign in again.");
    }
  }
  try {
    return getClaims(req, { allowPending: true });
  } catch {
    throw new ApiError(
      401,
      "No token. Send the profile-select token from login as an Authorization header or as profileSelectToken in the body.",
    );
  }
}

export const POST = withRoute(async (req) => {
  const body = await req.json().catch(() => ({}));

  // Accept either name so a client patched to one convention or the other
  // works. Matches the dual naming now returned by /auth/login.
  const bodyToken = body.profileSelectToken || body.selectToken || null;

const claims = claimsFrom(req, bodyToken);
if (!claims.pending) throw new ApiError(400, "Profile already selected");
const parsed = profileSelectSchema.safeParse(body);
if (!parsed.success) throw zodError(parsed);

 const user = await User.findById(claims.userId);
if (!user) throw new ApiError(401, "User not found");
if (user.isActive === false) throw new ApiError(403, "Account is disabled");
const profile = (user.profiles || []).find(
  (p) => String(p.profileId ?? p._id) === parsed.data.profileId && p.status === "Active",
);
if (!profile) {
  const available = (user.profiles || [])
    .filter((p) => p.status === "Active")
    .map((p) => `${p.wing || ""}-${p.flatNo || "?"}:${String(p.profileId ?? p._id)}`);
  throw new ApiError(
    404,
    process.env.NODE_ENV === "production"
      ? "Profile not found"
      : `Profile not found. Sent ${parsed.data.profileId}; user ${user._id} has [${available.join(", ")}]`,
  );
}
// Persist so /v1/auth/me, the website session and the app agree on which
// flat is active. Without this the app and web disagree after a switch.
const chosenId = String(profile.profileId ?? profile._id);
if (String(user.activeProfileId ?? "") !== chosenId) {
  user.activeProfileId = profile.profileId ?? profile._id;
  await user.save();
}

return json(await issueTokens(user, profile));
});
