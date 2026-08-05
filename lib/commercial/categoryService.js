import CommercialCategory from "@/models/CommercialCategory";
import { logAudit } from "@/lib/audit-logger";
import { CATEGORY_SCOPES, COMMERCIAL_AUDIT_ACTIONS } from "./constants";
import { CommercialError, notFound } from "./errors";
import { slugify } from "./schemas";
import { toCategoryDto } from "./dto";
import { withTransaction } from "./transactions";

// Effective category list for a society = active GLOBAL rows + that society's
// own active rows. Global rows are never duplicated per society.
export async function listEffectiveCategories(societyId) {
  const rows = await CommercialCategory.find({
    isDeleted: false,
    isActive: true,
    $or: [
      { scope: CATEGORY_SCOPES.GLOBAL },
      { scope: CATEGORY_SCOPES.SOCIETY, societyId },
    ],
  })
    .select("name slug scope sortOrder isActive")
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  return rows.map(toCategoryDto);
}

// Admin list includes inactive society rows so they can be re-enabled.
export async function listCategoriesForAdmin(societyId) {
  const rows = await CommercialCategory.find({
    isDeleted: false,
    $or: [
      { scope: CATEGORY_SCOPES.GLOBAL, isActive: true },
      { scope: CATEGORY_SCOPES.SOCIETY, societyId },
    ],
  })
    .select("name slug scope sortOrder isActive")
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  return rows.map(toCategoryDto);
}

export async function assertCategoryUsable(societyId, categoryId) {
  const category = await CommercialCategory.findOne({
    _id: categoryId,
    isDeleted: false,
    isActive: true,
    $or: [
      { scope: CATEGORY_SCOPES.GLOBAL },
      { scope: CATEGORY_SCOPES.SOCIETY, societyId },
    ],
  })
    .select("_id")
    .lean();
  if (!category) throw new CommercialError(400, "Unknown category", "UNKNOWN_CATEGORY");
  return category;
}

export async function createSocietyCategory({ societyId, userId, input }) {
  const slug = input.slug || slugify(input.name);
  if (!slug) throw new CommercialError(400, "Invalid category name", "INVALID_SLUG");

  // A society category may not shadow an effective global slug.
  const clash = await CommercialCategory.findOne({
    slug,
    isDeleted: false,
    $or: [
      { scope: CATEGORY_SCOPES.GLOBAL },
      { scope: CATEGORY_SCOPES.SOCIETY, societyId },
    ],
  })
    .select("_id scope")
    .lean();
  if (clash) {
    throw new CommercialError(409, "A category with this name already exists", "DUPLICATE_CATEGORY");
  }

  return withTransaction(async (session) => {
    const [created] = await CommercialCategory.create(
      [
        {
          scope: CATEGORY_SCOPES.SOCIETY,
          societyId,
          name: input.name,
          slug,
          sortOrder: input.sortOrder ?? 100,
          isActive: true,
          createdBy: userId,
          updatedBy: userId,
          updatedReason: "Profile Created",
        },
      ],
      session ? { session } : {},
    );
    await logAudit(userId, societyId, COMMERCIAL_AUDIT_ACTIONS.CATEGORY_CREATED, null, {
      _id: created._id,
      name: created.name,
      slug: created.slug,
    });
    return toCategoryDto(created.toObject());
  });
}

export async function updateSocietyCategory({ societyId, userId, categoryId, input }) {
  // Global categories are read-only to society admins.
  const existing = await CommercialCategory.findOne({
    _id: categoryId,
    societyId,
    scope: CATEGORY_SCOPES.SOCIETY,
    isDeleted: false,
  });
  if (!existing) throw notFound();

  const before = { name: existing.name, sortOrder: existing.sortOrder, isActive: existing.isActive };
  if (input.name !== undefined) existing.name = input.name;
  if (input.sortOrder !== undefined) existing.sortOrder = input.sortOrder;
  if (input.isActive !== undefined) existing.isActive = input.isActive;
  existing.updatedBy = userId;
  existing.updatedReason = "Category Changed";

  return withTransaction(async (session) => {
    await existing.save(session ? { session } : {});
    await logAudit(userId, societyId, COMMERCIAL_AUDIT_ACTIONS.CATEGORY_UPDATED, before, {
      _id: existing._id,
      name: existing.name,
      sortOrder: existing.sortOrder,
      isActive: existing.isActive,
    });
    return toCategoryDto(existing.toObject());
  });
}
