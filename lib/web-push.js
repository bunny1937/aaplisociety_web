// lib/web-push.js
// Free Web Push using the open VAPID protocol. No third-party service, no
// per-message cost. You only need the `web-push` npm package + a VAPID keypair.
import webpush from "web-push";

let configured = false;

/**
 * Returns a configured web-push instance, or null if VAPID keys are missing.
 * Missing keys => push is simply skipped (the app never crashes).
 */
export function getWebPush() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return null;

  if (!configured) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:admin@aaplisociety.com",
      pub,
      priv,
    );
    configured = true;
  }
  return webpush;
}
