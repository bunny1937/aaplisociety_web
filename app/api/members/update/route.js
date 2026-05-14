import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import AuditLog from "@/models/AuditLog";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { memberSchema } from "@/lib/validators";
import cache from "@/lib/cache";

export async function PUT(request) {
  try {
    await connectDB();

    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const body = await request.json();
    const { memberId, ...updateData } = body;

    if (!memberId) {
      return NextResponse.json(
        { error: "Member ID required" },
        { status: 400 },
      );
    }

    const validationResult = memberSchema.safeParse(updateData);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Validation failed", details: validationResult.error.errors },
        { status: 400 },
      );
    }

    const oldMember = await Member.findOne({
      _id: memberId,
      societyId: decoded.societyId,
    });

    if (!oldMember) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    // Guard: opening balance fields are locked after first bill is generated
    const openingFieldsChanged =
      ("openingPrincipal" in validationResult.data &&
        validationResult.data.openingPrincipal !== oldMember.openingPrincipal) ||
      ("openingInterest" in validationResult.data &&
        validationResult.data.openingInterest !== oldMember.openingInterest);

    if (openingFieldsChanged) {
      const anyBill = await Bill.findOne({
        memberId,
        societyId: decoded.societyId,
        isDeleted: { $ne: true },
      }).select("_id").lean();
      if (anyBill) {
        return NextResponse.json(
          { error: "Opening balances are locked after first bill is generated. Edit them via a ledger adjustment instead." },
          { status: 400 },
        );
      }
    }

    // Always derive openingBalance from the two components — never accept it as independent input
    const finalData = { ...validationResult.data };
    const newPrincipal = finalData.openingPrincipal ?? oldMember.openingPrincipal ?? 0;
    const newInterest = finalData.openingInterest ?? oldMember.openingInterest ?? 0;
    finalData.openingBalance = parseFloat((newPrincipal + newInterest).toFixed(2));

    const updatedMember = await Member.findByIdAndUpdate(
      memberId,
      { $set: finalData },
      { new: true, runValidators: true },
    );

    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "UPDATE_MEMBER",
      oldData: oldMember,
      newData: updatedMember,
      timestamp: new Date(),
    });
    await cache.delPattern(`members:list:${decoded.societyId}:*`);
    return NextResponse.json({
      message: "Member updated successfully",
      member: updatedMember,
    });
  } catch (error) {
    console.error("Update member error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(request) {
  try {
    await connectDB();

    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    if (decoded.role !== "Admin") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get("memberId");

    if (!memberId) {
      return NextResponse.json(
        { error: "Member ID required" },
        { status: 400 },
      );
    }

    const member = await Member.findOneAndDelete({
      _id: memberId,
      societyId: decoded.societyId,
    });

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "DELETE_MEMBER",
      oldData: member,
      timestamp: new Date(),
    });

    return NextResponse.json({ message: "Member deleted successfully" });
  } catch (error) {
    console.error("Delete member error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
