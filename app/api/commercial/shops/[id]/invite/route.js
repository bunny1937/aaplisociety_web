// POST /api/commercial/shops/:id/invite — admin action that gets a shop
// owner onto the platform. Mirrors the bulk-import onboarding-token pattern
// (app/api/admin/bulk-import/route.js) but for a single shop, so it sends
// the email directly instead of through EmailOutbox — that queue's
// {importRunId, userId, type} uniqueness/retry contract exists for
// idempotent batch retries, which don't apply to one admin click.
//
// Never writes to Member. Setting Shop.ownerUserId is the same
// non-destructive link the model already documents.
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { CommercialError, notFound } from "@/lib/commercial/errors";
import Shop from "@/models/Shop";
import User from "@/models/User";
import Society from "@/models/Society";
import { buildUsernameBloomFilter, generateSimpleUsername } from "@/lib/username-generator";
import { generatePassword } from "@/lib/password-generator";
import { signToken } from "@/lib/jwt";
import { sendEmail, onboardingEmailHtml } from "@/lib/brevo-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = adminCommercialRoute(
  "shops.invite",
  async ({ societyId, params }) => {
    const shop = await Shop.findOne({ _id: params.id, societyId, isDeleted: { $ne: true } });
    if (!shop) throw notFound();
    if (!shop.ownerEmail) {
      throw new CommercialError(400, "Add an owner email to this shop before inviting.", "NO_OWNER_EMAIL");
    }

    const society = await Society.findById(societyId).select("societyCode societyName address").lean();
    const unitLabel = [shop.wing, shop.shopNo].filter(Boolean).join("-") + (shop.tradeName ? ` (${shop.tradeName})` : "");

    let targetUserId;
    if (shop.ownerMemberId) {
      // Owner is a resident — Shop.js's pre-save hook forbids ownerMemberId
      // and ownerUserId being set together, so this shop's link is already
      // established and must NOT be touched. Find their existing resident
      // User (via the profiles.memberId index every onboarding/bulk-import
      // path already relies on) and attach a Commercial profile to it —
      // never mint a second, duplicate account for someone already on the
      // platform.
      const owner = await User.findOne({ "profiles.memberId": shop.ownerMemberId, societyId });
      if (!owner) {
        throw new CommercialError(
          404,
          "This shop's owner is linked to a resident member, but no matching login account was found. Check the member record.",
          "OWNER_MEMBER_NOT_FOUND",
        );
      }
      const already = (owner.profiles || []).some((p) => String(p.shopId) === String(shop._id));
      if (!already) {
        owner.profiles.push({
          profileId: new mongoose.Types.ObjectId(),
          societyId,
          kind: "Commercial",
          shopId: shop._id,
          societyName: society?.societyName ?? "",
          isPrimary: false,
          status: "Active",
        });
        await owner.save();
      }
      targetUserId = owner._id;
    } else if (shop.ownerUserId) {
      // Owner already has a User doc (e.g. a previously invited non-resident
      // owner, or was invited for a different shop) — attach a Commercial
      // profile if this shop isn't already on it.
      const owner = await User.findById(shop.ownerUserId);
      if (!owner) throw notFound();
      const already = (owner.profiles || []).some((p) => String(p.shopId) === String(shop._id));
      if (!already) {
        owner.profiles.push({
          profileId: new mongoose.Types.ObjectId(),
          societyId,
          kind: "Commercial",
          shopId: shop._id,
          societyName: society?.societyName ?? "",
          isPrimary: owner.profiles.length === 0,
          status: "Active",
        });
        await owner.save();
      }
      targetUserId = owner._id;
    } else {
      const bloom = await buildUsernameBloomFilter();
      const username = await generateSimpleUsername(society?.societyCode || "soc", `shop-${shop.shopNo}`, bloom);
      const tempPassword = generatePassword();
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      const [newUser] = await User.create([
        {
          name: shop.ownerName,
          email: shop.ownerEmail,
          username,
          phone: shop.ownerPhone || null,
          password: passwordHash,
          role: "Member",
          societyId,
          mustChangePassword: true,
          isActive: true,
          profiles: [
            {
              profileId: new mongoose.Types.ObjectId(),
              societyId,
              kind: "Commercial",
              shopId: shop._id,
              societyName: society?.societyName ?? "",
              isPrimary: true,
              status: "Active",
            },
          ],
        },
      ]);
      shop.ownerUserId = newUser._id;
      await shop.save();
      targetUserId = newUser._id;
    }

    const onboardingToken = signToken({ userId: String(targetUserId), purpose: "onboarding" }, { expiresIn: "7d" });
    const setCredentialsUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/onboarding/set-credentials?token=${onboardingToken}`;
    await sendEmail({
      to: shop.ownerEmail,
      subject: `Set up your account — ${society?.societyName ?? "your society"}`,
      html: onboardingEmailHtml({
        memberName: shop.ownerName,
        societyName: society?.societyName ?? "",
        societyAddress: society?.address ?? "",
        unitKind: shop.unitKind || "Shop",
        unitLabel,
        setCredentialsUrl,
      }),
    });

    return { invited: true, userId: String(targetUserId) };
  },
  { requireFlag: "enabled" },
);
