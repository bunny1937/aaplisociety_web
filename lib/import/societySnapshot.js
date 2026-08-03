import cache from "@/lib/cache";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import BillingHead from "@/models/BillingHead";
import Society from "@/models/Society";

/**
 * One cached read of everything the Excel validators need.
 *
 * ## The problem this solves
 *
 * Every validation and preview endpoint independently re-read the same
 * collections, unbounded, on every single click:
 *
 *   /api/members/preview-import   → Member.find({ societyId })          (all members)
 *   /api/billing/validate-excel   → Member.find + BillingHead.find      (all members)
 *   /api/bills/import?preview     → Member.find + Bill.find({societyId}) (ALL bills, no period filter)
 *   /api/billing/preview          → Member.find + Transaction.findOne PER MEMBER (N+1)
 *   /api/admin/societies/validate-excel → User.findOne + Society.findOne ×2 per row
 *
 * None of them cached anything. Excel validation is an inherently iterative
 * activity — upload, see 14 errors, fix, re-upload, see 3, fix, re-upload — so
 * the realistic cost is these queries multiplied by 4-6 attempts per import
 * session, per admin.
 *
 * For a 500-member society, one validation click is:
 *   500 member docs + every bill row ever written + the billing heads
 * ...deserialised into JS objects, to answer questions that are almost
 * entirely "does this flat exist" and "is this already billed".
 *
 * ## What this returns instead
 *
 * A compact lookup index — ids, flat keys, emails, phones — not full
 * documents. A 500-member society's snapshot is roughly 60KB against ~2MB of
 * hydrated Mongoose documents.
 *
 * Cached for 5 minutes in Redis, which is exactly the shape of an import
 * session: the first click pays for the read, the next five are free, and it
 * is stale enough to be irrelevant by the time anyone imports again.
 *
 * Invalidate with `invalidateSocietySnapshot(societyId)` after any import,
 * member create/delete, or bill generation.
 */

const TTL_SECONDS = 300;
const key = (societyId) => `import:snapshot:${societyId}`;

export async function getSocietySnapshot(societyId) {
  return cache.getOrSet(
    key(societyId),
    async () => {
      // .select() is doing real work here — without it Mongo ships every
      // member's full parking/family/owner-history/tenant-history subtree,
      // which for a large society is the bulk of the payload and none of it is
      // used for validation.
      const [members, heads, society] = await Promise.all([
        Member.find({ societyId, isDeleted: { $ne: true } })
          .select(
            "_id flatNo wing ownerName emailPrimary contactNumber carpetAreaSqft builtUpAreaSqft parkingSlots",
          )
          .lean(),
        BillingHead.find({ societyId, isActive: true, isDeleted: false })
          .sort({ order: 1 })
          .lean(),
        Society.findOne({ societyId }).select("config societyName").lean(),
      ]);

      const norm = (s) => String(s ?? "").trim().toLowerCase();

      return {
        builtAt: Date.now(),
        memberCount: members.length,
        members,
        heads,
        config: society?.config ?? {},
        societyName: society?.societyName ?? "",
        // Pre-built indexes. Building these once and caching them means the
        // per-row validation loop is pure in-memory lookups.
        byId: Object.fromEntries(members.map((m) => [String(m._id), m])),
        byWingFlat: Object.fromEntries(
          members.map((m) => [`${norm(m.wing)}-${norm(m.flatNo)}`, m]),
        ),
        // email -> owner name, so "same person, second flat" is not flagged as
        // a duplicate while "same email, different owner" still is.
        emailOwner: Object.fromEntries(
          members.filter((m) => m.emailPrimary).map((m) => [norm(m.emailPrimary), norm(m.ownerName)]),
        ),
        phones: members.map((m) => norm(m.contactNumber)).filter(Boolean),
      };
    },
    TTL_SECONDS,
  );
}

/**
 * Existing bills for ONE period, not the entire history.
 *
 * `bills/import?action=preview` did `Bill.find({ societyId })` with no period
 * filter at all, pulling every bill the society has ever generated just to
 * build a Set of "already billed" keys for the one month being imported. For a
 * society two years in, that is 24 × memberCount documents read to answer a
 * question about 1 × memberCount.
 *
 * That query also grows without bound: it gets slower every month the product
 * is used, which is the kind of thing that is invisible in testing and
 * unpleasant in production.
 */
export async function getBilledSet(societyId, periodIds) {
  const periods = [...new Set(periodIds.filter(Boolean))];
  if (!periods.length) return new Set();

  const cacheKey = `import:billed:${societyId}:${periods.sort().join(",")}`;
  const pairs = await cache.getOrSet(
    cacheKey,
    async () => {
      const bills = await Bill.find({
        societyId,
        billPeriodId: { $in: periods },
      })
        .select("memberId billPeriodId")
        .lean();
      return bills.map((b) => `${b.memberId}|${b.billPeriodId}`);
    },
    // Shorter TTL than the member snapshot: bills change during an import
    // session in a way members do not.
    60,
  );
  return new Set(pairs);
}

export async function invalidateSocietySnapshot(societyId) {
  await cache.del(key(societyId));
}
