// Alias of /api/onboarding/activate for the mobile app (Dio baseUrl .../v1).
// runtime/dynamic MUST be literal — see note in ../lookup/route.js.
export { POST } from "@/app/api/onboarding/activate/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";