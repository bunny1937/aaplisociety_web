import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { Visitor } from "@/lib/v1/models";
import { VISITOR_ACCESS_ROLES } from "@/lib/v1/constants";
import { detectFileType } from "@/lib/v1/fileSignature";
import { buildKey, uploadBuffer, presignDownload } from "@/lib/v1/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

// POST /v1/visitors/:id/upload-photo — guard uploads a visitor photo
// (multipart/form-data, field "file"). Replaces Multer with req.formData().
export const POST = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, VISITOR_ACCESS_ROLES);

  // A malformed id used to surface as a 500 CastError, which the guard app
  // reported as a generic upload failure.
  if (!id || !/^[a-f\d]{24}$/i.test(String(id))) {
    throw new ApiError(400, "Invalid visitor id");
  }

  const visitor = await Visitor.findOne({ _id: id, societyId });
  if (!visitor) throw new ApiError(404, "Visitor not found");

  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") throw new ApiError(400, "file is required");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new ApiError(413, "File too large (max 5MB)");
  const detected = detectFileType(buffer);
  if (detected !== "image/jpeg" && detected !== "image/png") {
    throw new ApiError(400, "Only JPEG or PNG images are allowed");
  }

  const ext = detected === "image/png" ? "png" : "jpg";
  const key = buildKey(societyId, "visitor-photos", ext);
  await uploadBuffer(key, buffer, detected);
  visitor.photoKey = key;
  await visitor.save();

  // Return the URL under BOTH keys. The client reads `photoUrl` (that is the
  // field name every visitor payload uses elsewhere), while `url` is kept for
  // any existing caller. Returning only `url` meant a freshly uploaded photo
  // did not render until the next full list refetch.
  const photoUrl = await presignDownload(key);
  return json({ ok: true, photoKey: key, photoUrl, url: photoUrl });
});