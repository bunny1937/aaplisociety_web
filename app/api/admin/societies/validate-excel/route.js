import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import User from "@/models/User";
import { validateAdminRequest } from "@/lib/admin-middleware";

export async function POST(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;

  await connectDB();
  const { rows } = await request.json();
  const conflicts = [];

  for (let i = 0; i < rows.length; i++) {
    const { email, registrationNo, societyName } = rows[i];

    // Email uniqueness across User collection
    if (email) {
      const existingUser = await User.findOne({
        email: email.toLowerCase().trim(),
      }).lean();
      if (existingUser)
        conflicts.push({
          rowIndex: i,
          field: "Admin Email*",
          message: `Email already registered: "${email}"`,
        });
    }

    // Registration No uniqueness in Society collection
    if (registrationNo) {
      const existingSoc = await Society.findOne({
        registrationNo: registrationNo.trim(),
        isDeleted: { $ne: true },
      }).lean();
      if (existingSoc)
        conflicts.push({
          rowIndex: i,
          field: "Registration No*",
          message: `Registration No already exists: "${registrationNo}"`,
        });
    }

    // Society name uniqueness (case-insensitive)
    if (societyName) {
      const existingName = await Society.findOne({
        name: { $regex: `^${societyName.trim()}$`, $options: "i" },
        isDeleted: { $ne: true },
      }).lean();
      if (existingName)
        conflicts.push({
          rowIndex: i,
          field: "Society Name*",
          message: `Society name already exists: "${societyName}"`,
        });
    }
  }

  return NextResponse.json({ conflicts });
}
