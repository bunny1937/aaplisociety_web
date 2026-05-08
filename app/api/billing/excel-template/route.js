import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import BillingHead from "@/models/BillingHead";
import Society from "@/models/Society";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import * as XLSX from "xlsx";
import Bill from "@/models/Bill";
import {
  getOldestDueDate,
  calculateMonthlyInterest,
} from "../../../../utils/interestUtils";
import { safeConfigDate } from "../../../../utils/dateUtils";

export async function GET(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const month = parseInt(
      searchParams.get("month") || new Date().getMonth() + 1,
    );
    const year = parseInt(searchParams.get("year") || new Date().getFullYear());

    const memberIdFilter = searchParams.get("memberIds");
    const memberIdSet = memberIdFilter
      ? memberIdFilter.split(",").map((s) => s.trim()).filter(Boolean)
      : null;

    const memberQuery = { societyId: decoded.societyId, isDeleted: { $ne: true } };
    if (memberIdSet?.length) memberQuery._id = { $in: memberIdSet };

    const [members, heads, society] = await Promise.all([
      Member.find(memberQuery)
        .select(
          "_id flatNo wing ownerName carpetAreaSqft contactNumber parkingSlots openingBalance openingPrincipal openingInterest",
        )
        .sort({ wing: 1, flatNo: 1 })
        .lean(),
      BillingHead.find({
        societyId: decoded.societyId,
        isActive: true,
        isDeleted: false,
      })
        .sort({ order: 1 })
        .lean(),
      Society.findById(decoded.societyId).lean(),
    ]);

    const dueDay = society?.config?.billDueDay || 10;
    const dueDate = new Date(year, month - 1, dueDay).toISOString().split("T")[0];

    const parkingHeads = heads.filter((h) =>
      h.headName?.toLowerCase().includes("parking"),
    );

    const rows = await Promise.all(
      members.map(async (m) => {
        const area = Number(m.carpetAreaSqft || 0);
        let subtotal = 0;

        const _safedue = safeConfigDate(
          year,
          month,
          society.config?.billDueDay || 10,
        );
        const row = {
          MemberId: m._id.toString(),
          Wing: m.wing,
          FlatNo: m.flatNo,
          OwnerName: m.ownerName,
          Month: month,
          Year: year,
          DueDate: dueDate || _safedue.toLocaleDateString("en-IN"),
        };

        // Non-parking heads — apply by calculationType
        for (const head of heads) {
          if (parkingHeads.includes(head)) {
            row[head.headName] = 0; // placeholder, filled below
            continue;
          }
          const hLower = head.headName.trim().toLowerCase();
          const isParking =
            hLower.includes("parking") &&
            (hLower.includes("two") ||
              hLower.includes("four") ||
              hLower.includes("wheeler"));
          let amount = 0;
          if (isParking) {
            const matchCount = (m.parkingSlots ?? []).filter((slot) => {
              if (slot.type === "Stilt" || slot.monthlyBilling === false)
                return false;
              const vehicleLabel = (slot.vehicleType || "")
                .replace(/-/g, " ")
                .toLowerCase();
              const slotType = (slot.type || "").toLowerCase();
              return hLower.includes(slotType) && hLower.includes(vehicleLabel);
            }).length;
            amount = head.defaultAmount * matchCount;
          } else if (head.calculationType === "Fixed") {
            amount = head.defaultAmount;
          } else if (head.calculationType === "Per Sq Ft") {
            amount = area * head.defaultAmount;
          } else if (head.calculationType === "Percentage") {
            amount = (subtotal * head.defaultAmount) / 100;
          }

          row[head.headName] = parseFloat(amount.toFixed(2));
          subtotal += amount;
        }

        // Parking — only charge slots this member actually has (skip Stilt)
        for (const slot of m.parkingSlots || []) {
          if (slot.type === "Stilt" || slot.monthlyBilling === false) continue;
          const vehicleLabel = slot.vehicleType.replace(/-/g, " "); // "Two-Wheeler" → "Two Wheeler"
          const expectedName = `${slot.type} Parking - ${vehicleLabel}`;
          const matchHead = parkingHeads.find(
            (h) => h.headName === expectedName,
          );
          if (!matchHead || matchHead.defaultAmount <= 0) continue;
          row[expectedName] =
            (row[expectedName] || 0) + matchHead.defaultAmount;
          subtotal += matchHead.defaultAmount;
        }

        row["Total"] = parseFloat(subtotal.toFixed(2));

        // Interest config
        const interestRate = parseFloat(society?.config?.interestRate || 0);
        const gracePeriodDays = parseInt(society?.config?.gracePeriodDays || 0);
        const billDueDay = society?.config?.billDueDay || 10;

        // Reference date = 1st of bill month
        const referenceDate = new Date(year, month - 1, 1);

        // Fetch unpaid bills from DB (need principalBalance for correct interest base)
        const unpaidBills = await Bill.find({
          memberId: m._id,
          societyId: decoded.societyId,
          status: { $in: ["Unpaid", "Partial", "Overdue"] },
        })
          .select("balanceAmount principalBalance interestBalance dueDate billYear billMonth")
          .lean();

        // prevBalance for display = sum of all unpaid bill balances (principal + interest)
        let prevBalance = unpaidBills.reduce(
          (sum, b) => sum + (b.balanceAmount || 0),
          0,
        );
        if (prevBalance === 0 && (m.openingBalance || 0) > 0) {
          prevBalance = m.openingBalance;
        }

        let interestDue = 0;

        // If bill already generated — use the stored value, never recalculate.
        // This ensures export and UI are always in sync with actual stored data.
        const existingBill = await Bill.findOne({
          memberId: m._id,
          societyId: decoded.societyId,
          billPeriodId: `${year}-${String(month).padStart(2, "0")}`,
          isDeleted: { $ne: true },
        })
          .select("interestAmount")
          .lean();

        if (existingBill) {
          interestDue = parseFloat(existingBill.interestAmount || 0);
        } else if (unpaidBills.length > 0 || (m.openingPrincipal || 0) > 0) {
          // Preview before bill is generated: compute interest on PRINCIPAL only (no interest-on-interest)
          const principalForInterest =
            unpaidBills.length > 0
              ? unpaidBills.reduce((s, b) => s + (b.principalBalance || 0), 0)
              : m.openingPrincipal || 0;
          const remInt =
            unpaidBills.length > 0
              ? unpaidBills.reduce((s, b) => s + (b.interestBalance || 0), 0)
              : m.openingInterest || 0;

          if (principalForInterest > 0 || remInt > 0) {
            const sortedUnpaid = [...unpaidBills].sort(
              (a, b) => new Date(a.dueDate) - new Date(b.dueDate),
            );
            const oldestDueDate = getOldestDueDate(
              sortedUnpaid,
              billDueDay,
              year,
              month,
            );
            const { monthInterest } = calculateMonthlyInterest({
              remainingPrincipal: principalForInterest,
              remInt,
              annualRate: interestRate,
              gracePeriodDays,
              interestAfterDays: society?.config?.interestAfterDays,
              interestActivationMode: society?.config?.interestActivationMode || "APPLICABLE",
              billDueDate: oldestDueDate,
              referenceDate,
              interestRounding: society?.config?.interestRounding || "TWO_DECIMAL",
              interestTriggerTiming: society?.config?.interestTriggerTiming || "NEXT_DAY",
            });
            interestDue = monthInterest;
          }
        }

        row["PreviousBalance"] = parseFloat(prevBalance.toFixed(2));
        row["InterestDue"] = parseFloat(interestDue.toFixed(2));
        row["GrandTotal"] = parseFloat(
          (subtotal + prevBalance + interestDue).toFixed(2),
        );
        return row;
      }),
    );

    const instructions = [
      {
        MemberId: "⚠ DO NOT change MemberId, Wing, FlatNo, Month, Year columns",
        Wing: "",
        FlatNo: "",
        OwnerName: "Adjust charge amounts if needed",
        Month: "",
        Year: "",
        DueDate: "",
      },
    ];

    const ws = XLSX.utils.json_to_sheet([...instructions, ...rows]);
    const headerKeys = Object.keys(rows[0] || {});
    ws["!cols"] = headerKeys.map((k) => {
      return { wch: Math.max(k.length + 2, 16), hidden: false };
    });
    // Note in instructions row already says "DO NOT EDIT" — PreviousBalance/InterestDue/GrandTotal are for reference only
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      ws,
      `Bills_${year}_${String(month).padStart(2, "0")}`,
    );

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buf, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="BillTemplate_${year}-${String(month).padStart(2, "0")}.xlsx"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
