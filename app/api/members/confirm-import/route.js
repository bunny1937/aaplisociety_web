import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import User from "@/models/User";
import ExcelJS from "exceljs";
import bcrypt from "bcryptjs";
import AuditLog from "@/models/AuditLog";
import { readFile, unlink } from "fs/promises";
import { randomBytes } from "crypto";
import { resolve, sep } from "path";
import cache from "@/lib/cache";
import { requireRoles, SOCIETY_ADMIN_ROLES } from "@/lib/authz";

function generatePassword() {
  return randomBytes(6).toString("base64url").toUpperCase();
}

export async function POST(request) {
  try {
    await connectDB();

    const auth = requireRoles(request, SOCIETY_ADMIN_ROLES);
    if (!auth.valid) return auth;
    const decoded = auth.user;

    const { tempFilePath } = await request.json();

    if (!tempFilePath) {
      return NextResponse.json(
        { error: "No temp file specified" },
        { status: 400 },
      );
    }

    // Guard: only allow files inside the designated temp directory
    const tempDir = resolve(process.cwd(), "temp");
    const resolvedPath = resolve(tempFilePath);
    if (!resolvedPath.startsWith(tempDir + sep)) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    // Read temp file
    const buffer = await readFile(resolvedPath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const firstSheet = workbook.worksheets[0];
    const isEnhancedTemplate = firstSheet.name.includes("Basic Info");

    let result;
    if (isEnhancedTemplate) {
      result = await processEnhancedImport(workbook, decoded);
    } else {
      result = await processSimpleImport(workbook, decoded);
    }

    // Delete temp file
    await unlink(resolvedPath);

    // Audit log
    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "IMPORT_MEMBERS",
      newData: {
        importedCount: result.createdMembers.length,
        importType: isEnhancedTemplate ? "enhanced" : "simple",
      },
      timestamp: new Date(),
    });
    await cache.delPattern(`members:list:${decoded.societyId}:*`);
    await cache.del(`admin:stats:global`);
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Confirm import error:", error);
    return NextResponse.json(
      {
        error: "Import failed",
        details: error.message,
      },
      { status: 500 },
    );
  }
}

// ... (Keep your existing processEnhancedImport and processSimpleImport functions)
