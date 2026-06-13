import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";

export async function GET(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const now = new Date();
    const currentPeriodId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Latest generated period for this society
    const latestBill = await Bill.findOne({
      societyId: decoded.societyId,
      isDeleted: { $ne: true },
    })
      .sort({ billPeriodId: -1 })
      .select("billPeriodId")
      .lean();

    const latestPeriodId = latestBill?.billPeriodId || null;

    // Is current month generated? Also true if a future month is already generated.
    const currentGenerated =
      !!latestPeriodId && String(latestPeriodId) >= String(currentPeriodId);
    // Next period = one month after latest (or current if nothing generated)
    let nextPeriodId = null;
    if (latestPeriodId) {
      const [y, m] = latestPeriodId.split("-").map(Number);
      const nextDate = new Date(y, m, 1); // month m is already 1-indexed, so new Date(y, m, 1) = next month
      nextPeriodId = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;
    }

    // Are all bills for latest period fully paid?
    let allPaid = false;
    if (latestPeriodId) {
      const unpaidBill = await Bill.findOne({
        societyId: decoded.societyId,
        billPeriodId: latestPeriodId,
        isDeleted: { $ne: true },
        balanceAmount: { $gt: 0.005 },
      })
        .select("_id")
        .lean();
      allPaid = !unpaidBill;
    }

    return NextResponse.json({
      latestPeriodId,
      currentPeriodId,
      currentGenerated,
      allPaid,
      nextPeriodId,
    });
  } catch (err) {
    console.error("latest-period error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
