import { NextResponse } from "next/server";
import { loadUploadedFile } from "@/lib/file-store";

// Serves an uploaded binary stored in MongoDB. Content-addressed by Mongo _id,
// so bytes can be cached immutably.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const file = await loadUploadedFile(id);
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    return new NextResponse(file.buffer, {
      headers: {
        "Content-Type": file.contentType || "application/octet-stream",
        "Content-Length": String(file.size != null ? file.size : file.buffer.length),
        "Content-Disposition": `inline; filename="${file.filename || "file"}"`,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("file serve error:", error);
    return NextResponse.json(
      { error: "Failed to load file", details: error.message },
      { status: 500 }
    );
  }
}
