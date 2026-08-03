// GET /api/admin/bulk-import/schema
//
// THE ONLY backend call the import wizard makes before submit.
//
// Returns the full 6-sheet column schema, enums, regex patterns and
// cross-sheet rules. The browser then validates every keystroke locally and
// does not call the server again until the whole workbook is clean.
//
// Optional `?probe=1` additionally returns the set of emails already
// registered on the platform, so the wizard can flag a taken email live
// without a per-cell round trip. It is a single indexed query returning only
// the email column, not a per-row lookup.

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { requireRoles } from "@/lib/authz";
import { buildClientSchema, SCHEMA_VERSION } from "@/lib/import/importSchema";
import cache from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPERADMIN_ROLES = ["SuperAdmin"];

export async function GET(request) {
  const auth = await requireRoles(request, SUPERADMIN_ROLES);
  if (!auth.valid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const wantProbe = searchParams.get("probe") === "1";

  const payload = {
    success: true,
    ...buildClientSchema(),
  };

  if (wantProbe) {
    try {
      await connectDB();

      // One projection-only query over the { email: 1 } index. On a platform
      // with a few thousand users this is a handful of KB and lets the client
      // reject an already-registered email the instant it is typed, instead of
      // discovering it after a full import attempt.
      //
      // Cached for 60s: the wizard is a single-admin, minutes-long session and
      // a newly created account appearing one minute late is harmless - the
      // authoritative check still runs inside the import transaction.
      const taken = await cache.getOrSet(
        "import:taken-emails",
        async () => {
          const users = await User.find(
            { email: { $exists: true, $ne: null, $ne: "" } },
            { email: 1, _id: 0 },
          ).lean();
          return users.map((u) => String(u.email).toLowerCase());
        },
        60,
      );

      payload.probe = {
        takenEmails: taken,
        // Explicitly tell the client this list is advisory, so the UI can word
        // the message as "already registered" rather than a hard block.
        advisory: true,
        builtAt: new Date().toISOString(),
      };
    } catch (err) {
      // A probe failure must never stop the wizard from opening. The schema is
      // the part that matters; the email list is an optimisation.
      console.warn("[bulk-import/schema] probe failed:", err.message);
      payload.probe = { takenEmails: [], advisory: true, degraded: true };
    }
  }

  return NextResponse.json(payload, {
    headers: {
      // The schema only changes when we deploy. Let the browser reuse it.
      "Cache-Control": "private, max-age=300",
      "X-Schema-Version": SCHEMA_VERSION,
    },
  });
}
