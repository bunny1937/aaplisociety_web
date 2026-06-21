// app/api/push/subscribe/route.js
// GET    -> hands the browser the public VAPID key (safe to expose)
// POST   -> saves this device's push subscription, linked to the logged-in member
// DELETE -> removes a subscription (e.g. when the user turns alerts off)
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import PushSubscription from "@/models/PushSubscription";
import { requireAuth } from "@/lib/authz";

export async function GET() {
  return NextResponse.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
}

export async function POST(request) {
  const auth = requireAuth(request);
  if (!auth.valid) return auth;

  try {
    await connectDB();
    const { subscription } = await request.json();
    if (!subscription || !subscription.endpoint || !subscription.keys)
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });

    await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        memberId: auth.user.memberId || null,
        userId: auth.user.userId || null,
        societyId: auth.user.societyId || null,
        userAgent: request.headers.get("user-agent") || "",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("push subscribe error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request) {
  const auth = requireAuth(request);
  if (!auth.valid) return auth;

  try {
    await connectDB();
    const { endpoint } = await request.json();
    if (endpoint) await PushSubscription.deleteOne({ endpoint });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
