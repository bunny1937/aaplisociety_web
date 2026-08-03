import mongoose from "mongoose";

/**
 * Per-society retention configuration.
 *
 * ## Why this exists (you were right)
 *
 * The first version gated purging on a single environment variable,
 * `RETENTION_PURGE_ENABLED`. That is a **global** switch: flipping it to true
 * turns on deletion for every society on the platform simultaneously, using
 * one hardcoded set of day counts. That is exactly the wrong shape for a
 * multi-tenant product:
 *
 *  - Society A may have been live for two years and genuinely want 60-day
 *    notification retention. Society B onboarded last week and has nothing to
 *    purge — but also has an admin who has never once logged in.
 *  - A society under an active dispute needs its complaints frozen, not
 *    expired on the platform's default schedule.
 *  - Retention periods are a *contractual* matter between you and each
 *    society. They cannot be a deploy-time constant.
 *
 * So retention is now **opt-in per society, per policy**, stored in the
 * database where the society's own admin can see and change it.
 *
 * ## The env var is still there, but it can only ever say NO
 *
 * `RETENTION_PURGE_ENABLED=false` is now a **kill switch**, not an enable
 * switch. Setting it to false disables purging platform-wide regardless of
 * what any society has configured — your emergency brake. Setting it to true
 * does not enable anything by itself; each society must also have opted in.
 *
 *   purge happens  =  global kill switch is NOT off
 *                  AND society has enabled: true
 *                  AND society has enabled THAT policy
 *                  AND the archive was actually downloaded
 *
 * A society that never touches this page never has a single row deleted.
 * The safe state is the default state.
 */
const PolicyOverrideSchema = new mongoose.Schema(
  {
    policyId: { type: String, required: true },
    // Opt in to purging for this specific data class. Default false: a society
    // that enables retention generally still has to say yes to each class.
    purgeEnabled: { type: Boolean, default: false },
    // Override the platform default day counts. Null = use the policy default
    // from lib/retention/policies.js.
    archiveAfterDays: { type: Number, default: null },
  },
  { _id: false },
);

const RetentionSettingSchema = new mongoose.Schema(
  {
    societyId: { type: String, required: true, unique: true, index: true },

    /**
     * Master switch for this society. While false, the nightly scan still
     * runs and still tells the admin what *would* be archived, but nothing is
     * ever deleted. This lets a society watch the system work for a month
     * before committing to it.
     */
    enabled: { type: Boolean, default: false },

    /**
     * Extra safety: even with everything enabled, refuse to purge more than
     * this many documents for this society in a single night. A
     * misconfiguration should cost you a slow catch-up, not a data loss event.
     */
    maxPurgePerNight: { type: Number, default: 5000 },

    /**
     * How long the admin has to download an archive before the system gives up
     * and re-notifies. Data is NEVER deleted while undownloaded — this only
     * controls the reminder cadence.
     */
    downloadGraceDays: { type: Number, default: 30 },

    policies: { type: [PolicyOverrideSchema], default: [] },

    /**
     * Where the nightly "you have an archive waiting" email goes for THIS
     * society. Falls back to the society's own adminEmail / contactEmail when
     * empty, so it works with zero configuration.
     */
    notifyEmails: { type: [String], default: [] },

    // Audit: who turned this on, and when. Retention is a legal posture; you
    // want to be able to answer "who authorised deleting this".
    enabledBy: { type: String, default: null },
    enabledAt: { type: Date, default: null },
    lastScanAt: { type: Date, default: null },
    lastPurgeAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/**
 * Resolve the effective setting for one society + policy, applying defaults.
 * Never throws and never invents an "enabled" — a missing document means
 * "this society has not opted in", which is the safe answer.
 */
RetentionSettingSchema.statics.resolve = async function (societyId, policy) {
  const doc = await this.findOne({ societyId }).lean();
  const override = doc?.policies?.find((p) => p.policyId === policy.id);
  return {
    // Archiving/reporting is always on — it is read-only and costs nothing but
    // a nightly count query. Only DELETION is gated.
    societyEnabled: Boolean(doc?.enabled),
    purgeEnabled: Boolean(doc?.enabled && override?.purgeEnabled && policy.purgeable),
    archiveAfterDays: override?.archiveAfterDays ?? policy.archiveAfterDays,
    maxPurgePerNight: doc?.maxPurgePerNight ?? 5000,
    downloadGraceDays: doc?.downloadGraceDays ?? 30,
    notifyEmails: doc?.notifyEmails ?? [],
  };
};

export default mongoose.models.RetentionSetting ||
  mongoose.model("RetentionSetting", RetentionSettingSchema);
