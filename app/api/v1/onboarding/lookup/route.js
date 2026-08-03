// Alias of /api/onboarding/lookup for the mobile app (Dio baseUrl .../v1).
// Re-export, not a copy — two copies of an unauthenticated enumeration
// surface is what gets hardened in one place and forgotten in the other.
// runtime/dynamic MUST be literal: Next.js statically analyses this file and
// cannot follow a re-exported config value (it warns and silently applies
// defaults, which can route this to Edge where mongoose/bcryptjs do not run).
export { POST } from "@/app/api/onboarding/lookup/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";