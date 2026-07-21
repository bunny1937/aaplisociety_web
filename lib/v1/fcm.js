// Firebase Cloud Messaging fan-out for the /v1 layer. Ported from
// mobile-backend src/services/fcm.ts + src/config/firebase.ts.
//
// firebase-admin is loaded lazily so the app builds/runs even when it isn't
// installed or FIREBASE_SA_JSON isn't configured (push simply no-ops then).
// All senders are best-effort and never throw into the request path.
import { DeviceToken, User } from "./models";

const isDev = process.env.NODE_ENV !== "production";
let _messaging = null;
let _init = false;

// Pure parsing - no firebase-admin dependency, so it's unit-testable without
// ever touching real credentials. Returns a plain {projectId, clientEmail,
// privateKey} object or null; never logs the values themselves.
export function resolveCredentialConfig(env = process.env) {
  // Format 1: full service-account JSON blob.
  const sa = env.FIREBASE_SA_JSON;
  if (sa && sa.trim()) {
    try {
      const parsed = JSON.parse(sa);
      let privateKey = parsed.private_key;
      if (privateKey && privateKey.includes("\\n")) privateKey = privateKey.replace(/\\n/g, "\n");
      if (!parsed.project_id || !parsed.client_email || !privateKey) return null;
      return { projectId: parsed.project_id, clientEmail: parsed.client_email, privateKey };
    } catch (e) {
      console.error("[v1/fcm] FIREBASE_SA_JSON is not valid JSON:", e?.message ?? e);
      return null;
    }
  }

  // Format 2: the 3 separate keys (same as the other project).
  const projectId = env.FIREBASE_PROJECT_ID;
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  let privateKey = env.FIREBASE_PRIVATE_KEY;
  if (projectId && clientEmail && privateKey) {
    privateKey = privateKey.replace(/^"|"$/g, "").replace(/\\n/g, "\n");
    return { projectId, clientEmail, privateKey };
  }

  return null;
}

async function getMessaging() {
  if (_init) return _messaging;
  _init = true;
  try {
    const admin = (await import("firebase-admin")).default;
    if (!admin.apps.length) {
      const config = resolveCredentialConfig();
      if (!config) {
        console.warn(
          "[v1/fcm] No Firebase credentials found (set FIREBASE_SA_JSON, or " +
            "FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY) — push disabled",
        );
        _messaging = null;
        return null;
      }
      admin.initializeApp({ credential: admin.credential.cert(config) });
    }
    _messaging = admin.messaging();
  } catch (e) {
    console.error("[v1/fcm] firebase-admin init failed:", e?.message ?? e);
    _messaging = null;
  }
  return _messaging;
}

async function sendToTokens(tokens, payload, data, label) {
  if (!tokens.length) {
    // Silent no-op here was the exact failure mode that made "no push
    // arrived" indistinguishable from "nobody registered a device" — always
    // surface it in dev.
    if (isDev) console.log(`[v1/fcm] ${label ?? ""} 0 device tokens found — skipping`);
    return;
  }
  const messaging = await getMessaging();
  if (!messaging) return;
  try {
    const resp = await messaging.sendEachForMulticast({
      tokens,
      notification: { title: payload.title, body: payload.body },
      data,
      android: { priority: "high" },
      apns: { headers: { "apns-priority": "10" } },
    });
    if (isDev) {
      const codes = [...new Set(resp.responses.filter((r) => !r.success).map((r) => r.error?.code).filter(Boolean))];
      console.log(
        `[v1/fcm] ${label ?? ""} tokens=${tokens.length} success=${resp.successCount} failed=${resp.failureCount}` +
          (codes.length ? ` errors=${codes.join(",")}` : ""),
      );
    }
    const stale = [];
    resp.responses.forEach((r, i) => {
      if (!r.success && r.error?.code === "messaging/registration-token-not-registered") {
        stale.push(tokens[i]);
      }
    });
    if (stale.length) await DeviceToken.deleteMany({ fcmToken: { $in: stale } });
  } catch (e) {
    console.error("[v1/fcm] send failed:", e?.message ?? e);
  }
}

function stringifyData(data) {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
}

export function uniqueTokens(devices) {
  return [...new Set(devices.map((d) => d.fcmToken).filter(Boolean))];
}

export async function sendFcmToUser(userId, payload, data = {}) {
  const devices = await DeviceToken.find({ userId }).select("fcmToken");
  await sendToTokens(uniqueTokens(devices), payload, stringifyData(data), `user=${userId}`);
}

export async function sendFcmToMember(memberId, payload, data = {}) {
  const user = await User.findOne({ $or: [{ memberId }, { "profiles.memberId": memberId }] }).select("_id");
  if (!user) {
    if (isDev) console.log(`[v1/fcm] member=${memberId} no matching User — skipping`);
    return;
  }
  await sendFcmToUser(String(user._id), payload, data);
}

export async function sendFcmToSociety(societyId, payload, data = {}) {
  const devices = await DeviceToken.find({ societyId }).select("fcmToken");
  await sendToTokens(uniqueTokens(devices), payload, stringifyData(data), `society=${societyId}`);
}
