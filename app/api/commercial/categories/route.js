import { NextResponse } from "next/server";
import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { CommercialError } from "@/lib/commercial/errors";
import {
  listCategoriesForAdmin,
  createSocietyCategory,
} from "@/lib/commercial/categoryService";
import { categoryCreateSchema } from "@/lib/commercial/schemas";

// Shared GLOBAL categories are never copied per society: they are merged at
// read time, so a platform-level rename reaches every society at once.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminCommercialRoute("categories.list", async ({ societyId }) => ({
  categories: await listCategoriesForAdmin(societyId),
}));

export const POST = adminCommercialRoute("categories.create", async ({ req, societyId, userId }) => {
  const parsed = categoryCreateSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new CommercialError(400, { error: parsed.error.flatten() }, "VALIDATION");
  }
  const category = await createSocietyCategory({ societyId, userId, input: parsed.data });
  return NextResponse.json({ success: true, category }, { status: 201 });
});
