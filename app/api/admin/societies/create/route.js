import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import User from "@/models/User";
import bcrypt from "bcryptjs";
import { validateAdminRequest } from "@/lib/admin-middleware";

function generateSocietyId(name, area, buildDate) {
  const parts = name.trim().split(" ");
  const first = parts[0]?.slice(0, 4).toLowerCase() || "soc";
  const last = parts[parts.length - 1]?.slice(0, 4).toLowerCase() || "ety";
  const areaSlug =
    area?.replace(/\s+/g, "").slice(0, 6).toLowerCase() || "area";
  const year = buildDate
    ? new Date(buildDate).getFullYear()
    : new Date().getFullYear();
  const rand = String(Math.floor(10 + Math.random() * 90));
  return `${first}_${last}_${areaSlug}_${year}_${rand}`;
}

function generatePassword() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const nums = "0123456789";
  const syms = "@#$!";
  const all = chars + nums + syms;
  let pwd = "";
  pwd += chars[Math.floor(Math.random() * chars.length)].toUpperCase();
  pwd += nums[Math.floor(Math.random() * nums.length)];
  pwd += syms[Math.floor(Math.random() * syms.length)];
  for (let i = 0; i < 7; i++)
    pwd += all[Math.floor(Math.random() * all.length)];
  return pwd
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

export async function POST(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  await connectDB();
  const body = await request.json();
  const {
    fullName,
    email,
    societyName,
    area,
    buildDate,
    address,
    registrationNo,
    config,
  } = body;

  // Generate unique societyId
  let societyId,
    attempts = 0;
  do {
    societyId = generateSocietyId(societyName, area, buildDate);
    const existing = await Society.findOne({ societyId });
    if (!existing) break;
    attempts++;
  } while (attempts < 10);

  const plainPassword = generatePassword();
  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  const society = await Society.create({
    societyId,
    name: societyName,
    address,
    registrationNo,
    area,
    buildDate: buildDate ? new Date(buildDate) : undefined,
    contactEmail: email,
    config: {
      charges: config?.charges?.length
        ? config.charges
        : [
            {
              label: "Maintenance Charges",
              type: "Per Sq Ft",
              value: 0,
              isActive: true,
            },
            {
              label: "Sinking Fund",
              type: "Per Sq Ft",
              value: 0,
              isActive: true,
            },
            {
              label: "Repair Fund",
              type: "Per Sq Ft",
              value: 0,
              isActive: true,
            },
            { label: "Water Charges", type: "Fixed", value: 0, isActive: true },
            {
              label: "Security Charges",
              type: "Fixed",
              value: 0,
              isActive: true,
            },
            {
              label: "Electricity Charges",
              type: "Fixed",
              value: 0,
              isActive: true,
            },
          ],
    },
    subscription: { status: "Trial" },
    credentials: { adminEmail: email, plainPassword }, // stored temporarily for superadmin only
  });

  const user = await User.create({
    name: fullName,
    email,
    password: hashedPassword,
    role: "Admin",
    societyId: society._id,
    isActive: true,
  });

  return NextResponse.json({
    success: true,
    society,
    adminEmail: email,
    plainPassword,
  });
}
