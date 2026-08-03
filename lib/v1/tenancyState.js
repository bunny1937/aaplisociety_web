// Shared resolver for "is this tenant's app login actually on?"
//
// THE COMPLAINT: "the tenant login switch is off why? cant u see from users
// that its active or not, its active then why do I have to make it active from
// here". Correct on every count.
//
// What was happening: the owner app read `tenancy.loginEnabled`, a boolean
// MIRRORED onto the TenantRequest by PATCH /tenant-requests/:id/login. That
// mirror only comes into existence the first time somebody toggles the switch.
// For every tenancy approved before that route existed - which is all of them -
// the field is simply absent. tenant-history/route.js then reported
// `loginEnabled: null`, and the app rendered OFF.
//
// So the switch was showing the state of a cache that had never been written,
// while the real answer - User.isActive, the flag the login route itself flips
// and the flag the auth layer actually enforces - sat one query away.
//
// This asks the users collection. Precedence:
//   1. An explicit boolean on the TenantRequest (an owner who deliberately
//      switched the login off must stay switched off).
//   2. The tenant User's isActive - the real, enforced answer.
//   3. Approved status with no User found yet - treat as enabled, because an
//      approved tenancy has a working login by definition and telling the owner
//      otherwise invites them to "fix" something that was never broken.

// Matches the same way PATCH /tenant-requests/:id/login does, so the switch can
// never disagree with what toggling it would actually change.
export async function findTenantUser(request, User) {
  const or = [];
  if (request.tenantEmail) or.push({ email: request.tenantEmail });
  if (request.tenantPhone) or.push({ phone: request.tenantPhone });
  if (!or.length) return null;
  return User.findOne({
    $and: [
      { $or: or },
      { $or: [{ memberId: request.memberId }, { "profiles.memberId": request.memberId }] },
    ],
  })
    .select("_id isActive")
    .lean();
}

export async function resolveLoginEnabled(request, { User }) {
  if (!request) return false;
  if (typeof request.loginEnabled === "boolean") return request.loginEnabled;
  try {
    const user = await findTenantUser(request, User);
    if (user) return user.isActive !== false;
  } catch {
    // A lookup failure must not flip a working login to "disabled" in the UI.
  }
  return request.status === "Approved" || request.status === "Active";
}

// Batched variant for list endpoints, so N tenancies cost ONE users query
// instead of N. tenant-history uses this.
export async function resolveLoginEnabledMany(requests, { User }) {
  const out = new Map();
  const need = [];
  for (const r of requests) {
    if (typeof r.loginEnabled === "boolean") out.set(String(r._id), r.loginEnabled);
    else need.push(r);
  }
  if (!need.length) return out;

  const emails = need.map((r) => r.tenantEmail).filter(Boolean);
  const phones = need.map((r) => r.tenantPhone).filter(Boolean);
  const memberIds = need.map((r) => r.memberId).filter(Boolean);

  let users = [];
  if (emails.length || phones.length) {
    try {
      users = await User.find({
        $and: [
          { $or: [{ email: { $in: emails } }, { phone: { $in: phones } }] },
          { $or: [{ memberId: { $in: memberIds } }, { "profiles.memberId": { $in: memberIds } }] },
        ],
      })
        .select("email phone isActive")
        .lean();
    } catch {
      users = [];
    }
  }

  const byEmail = new Map(users.filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), u]));
  const byPhone = new Map(users.filter((u) => u.phone).map((u) => [String(u.phone), u]));

  for (const r of need) {
    const u =
      (r.tenantEmail && byEmail.get(String(r.tenantEmail).toLowerCase())) ||
      (r.tenantPhone && byPhone.get(String(r.tenantPhone))) ||
      null;
    out.set(
      String(r._id),
      u ? u.isActive !== false : r.status === "Approved" || r.status === "Active",
    );
  }
  return out;
}
