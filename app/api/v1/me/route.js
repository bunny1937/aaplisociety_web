import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import { User } from "@/lib/v1/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/me — the logged-in user's own editable profile fields (name/phone/
// gateLabel). Separate from /v1/auth/me, which returns claims + member +
// society context, not the raw user record.
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const user = await User.findById(claims.userId).select("name username phone gateLabel role");
  if (!user) throw new ApiError(404, "User not found");
  return json({
    user: {
      _id: String(user._id),
      name: user.name ?? "",
      username: user.username,
      phone: user.phone ?? "",
      gateLabel: user.gateLabel ?? "",
      role: user.role,
    },
  });
});

// PATCH /v1/me — self-service update of basic details. Deliberately narrow:
// only name/phone/gateLabel are editable here (not username/password/role).
export const PATCH = withRoute(async (req) => {
  const claims = getClaims(req);
  const body = await req.json().catch(() => ({}));
  const update = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) throw new ApiError(400, "Name can't be empty");
    update.name = name;
  }
  if (typeof body.phone === "string") {
    const phone = body.phone.trim();
    if (phone && !/^\d{10,13}$/.test(phone.replace(/\D/g, ""))) {
      throw new ApiError(400, "Enter a valid contact number");
    }
    update.phone = phone;
  }
  if (typeof body.gateLabel === "string") {
    const gateLabel = body.gateLabel.trim();
    if (gateLabel.length > 50) throw new ApiError(400, "Gate label must be 50 characters or less");
    update.gateLabel = gateLabel;
  }
  if (!Object.keys(update).length) throw new ApiError(400, "Nothing to update");

  const user = await User.findByIdAndUpdate(claims.userId, { $set: update }, { new: true }).select(
    "name username phone gateLabel role",
  );
  if (!user) throw new ApiError(404, "User not found");
  return json({
    user: {
      _id: String(user._id),
      name: user.name ?? "",
      username: user.username,
      phone: user.phone ?? "",
      gateLabel: user.gateLabel ?? "",
      role: user.role,
    },
  });
});
