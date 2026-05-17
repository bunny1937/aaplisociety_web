import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Bill from "@/models/Bill";

export async function GET(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded || !decoded.memberId)
      return NextResponse.json({ error: "Not a member" }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "50");
    const page = parseInt(searchParams.get("page") || "1");

    const query = {
      memberId: decoded.memberId,
      societyId: decoded.societyId,
      isDeleted: { $ne: true },
      status: { $ne: "Scheduled" },
      importedFrom: { $ne: "BulkImport" },
    };
    if (status && status !== "all") query.status = status;

    const [bills, total] = await Promise.all([
      Bill.find(query)
        .sort({ billYear: -1, billMonth: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("-billHtml") // exclude heavy field for list
        .lean(),
      Bill.countDocuments(query),
    ]);

    const summary = {
      total,
      totalAmount: bills.reduce((s, b) => s + (b.totalAmount || 0), 0),
      totalPaid: bills.reduce((s, b) => s + (b.amountPaid || 0), 0),
      totalOutstanding: bills
        .filter((b) => b.status !== "Paid")
        .reduce((s, b) => s + (b.balanceAmount || 0), 0),
    };

    return NextResponse.json({
      success: true,
      bills,
      summary,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error", details: error.message },
      { status: 500 },
    );
  }
}
