import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Notice from "@/models/Notice";

// DELETE /api/notices/[id] — Admin soft-deletes
export async function DELETE(request, { params }) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const decoded = verifyToken(token);
    if (!decoded || !["Admin", "Secretary"].includes(decoded.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const notice = await Notice.findOne({
      _id: id,
      societyId: decoded.societyId,
    });
    if (!notice)
      return NextResponse.json({ error: "Notice not found" }, { status: 404 });

    notice.isDeleted = true;
    await notice.save();

    return NextResponse.json({ success: true, message: "Notice deleted" });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error", details: error.message },
      { status: 500 },
    );
  }
}

// PATCH /api/notices/[id] — Pin/unpin
export async function PATCH(request, { params }) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const decoded = verifyToken(token);
    if (!decoded || !["Admin", "Secretary"].includes(decoded.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const { pinned } = await request.json();

    const notice = await Notice.findOneAndUpdate(
      { _id: id, societyId: decoded.societyId, isDeleted: false },
      { $set: { pinned: !!pinned } },
      { new: true },
    );

    if (!notice)
      return NextResponse.json({ error: "Notice not found" }, { status: 404 });

    return NextResponse.json({ success: true, notice });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error", details: error.message },
      { status: 500 },
    );
  }
}
