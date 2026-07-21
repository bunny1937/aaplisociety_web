import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { OCCUPANCY_TYPES } from "@/lib/v1/constants";
import { detectFileType } from "@/lib/v1/fileSignature";
import { buildKey, uploadBuffer } from "@/lib/v1/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELDS = { contract: "contract", signature: "signature", aadhaar: "aadhaar", policeVerification: "police-verification" };
const MAX_BYTES = 10 * 1024 * 1024;

// POST /v1/tenant-requests/upload/:field — owner uploads one tenant document
// (multipart, field "file"). Returns the object key to embed in the request
// body. Replaces Multer with req.formData().
export const POST = withRoute(async (req, ctx) => {
  const { field } = await ctx.params;
  const folderPart = FIELDS[field];
  if (!folderPart) throw new ApiError(400, "Unknown document field");

  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (!claims.memberId || claims.occupancyType === OCCUPANCY_TYPES.TENANT) {
    throw new ApiError(403, "Only owners can upload tenant documents");
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") throw new ApiError(400, "file is required");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new ApiError(413, "File too large (max 10MB)");
  const detected = detectFileType(buffer);
  if (!detected) throw new ApiError(400, "Only PDF, JPEG or PNG files are allowed");

  const ext = detected === "application/pdf" ? "pdf" : detected === "image/png" ? "png" : "jpg";
  const key = buildKey(societyId, `tenant-requests/${folderPart}`, ext);
  await uploadBuffer(key, buffer, detected);
  return json({ ok: true, field, key });
});
