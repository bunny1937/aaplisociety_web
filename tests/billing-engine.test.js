import { calculateMonthlyInterest, allocatePaymentInterestFirst } from "../utils/interestUtils.js";

// ── VIEW Mode ────────────────────────────────────────────────────────────────
describe("VIEW mode", () => {
  test("suppresses new interest but carries remInt", () => {
    const result = calculateMonthlyInterest({
      remainingPrincipal: 1500,
      remInt: 50,
      annualRate: 21,
      interestAfterDays: 15,
      interestActivationMode: "VIEW",
      billDueDate: new Date("2026-04-10"),
      referenceDate: new Date("2026-05-01"),
    });
    expect(result.currInt).toBe(0);
    expect(result.monthInterest).toBe(50);
    expect(result.remInt).toBe(50);
  });

  test("zero remInt in VIEW mode returns all zeros", () => {
    const result = calculateMonthlyInterest({
      remainingPrincipal: 1500,
      remInt: 0,
      annualRate: 21,
      interestAfterDays: 15,
      interestActivationMode: "VIEW",
      billDueDate: new Date("2026-04-10"),
      referenceDate: new Date("2026-05-01"),
    });
    expect(result.currInt).toBe(0);
    expect(result.monthInterest).toBe(0);
  });
});

// ── APPLICABLE Mode ───────────────────────────────────────────────────────────
describe("APPLICABLE mode", () => {
  test("interest applies only on remaining principal after partial payment", () => {
    const result = calculateMonthlyInterest({
      remainingPrincipal: 800,
      remInt: 0,
      annualRate: 21,
      interestAfterDays: 15,
      interestActivationMode: "APPLICABLE",
      billDueDate: new Date("2026-04-10"),
      referenceDate: new Date("2026-05-01"),
      interestTriggerTiming: "NEXT_DAY",
    });
    // 800 * 21 / 1200 = 14.00
    expect(result.currInt).toBe(14);
    expect(result.monthInterest).toBe(14);
  });

  test("no interest if reference date within grace period", () => {
    const result = calculateMonthlyInterest({
      remainingPrincipal: 1500,
      remInt: 0,
      annualRate: 21,
      interestAfterDays: 15,
      interestActivationMode: "APPLICABLE",
      billDueDate: new Date("2026-04-10"),
      referenceDate: new Date("2026-04-20"),
      interestTriggerTiming: "NEXT_DAY",
    });
    expect(result.currInt).toBe(0);
  });

  test("interest triggers after exact grace period", () => {
    const result = calculateMonthlyInterest({
      remainingPrincipal: 1200,
      remInt: 0,
      annualRate: 12,
      interestAfterDays: 10,
      interestActivationMode: "APPLICABLE",
      billDueDate: new Date("2026-04-10"),
      referenceDate: new Date("2026-04-21"),
      interestTriggerTiming: "NEXT_DAY",
    });
    // 1200 * 12 / 1200 = 12.00
    expect(result.currInt).toBe(12);
  });
});

// ── No interest on interest ───────────────────────────────────────────────────
describe("no interest on interest", () => {
  test("interest never compounds on remInt", () => {
    const result = calculateMonthlyInterest({
      remainingPrincipal: 1000,
      remInt: 200,
      annualRate: 12,
      interestAfterDays: 0,
      interestActivationMode: "APPLICABLE",
      billDueDate: new Date("2026-04-01"),
      referenceDate: new Date("2026-05-01"),
    });
    // currInt = 1000 * 12 / 1200 = 10
    expect(result.currInt).toBe(10);
    // monthInterest = 200 + 10 = 210
    expect(result.monthInterest).toBe(210);
  });
});

// ── Payment allocation — interest first ──────────────────────────────────────
describe("allocatePaymentInterestFirst", () => {
  test("interest cleared before principal", () => {
    const bills = [
      { _id: "b1", principalBalance: 1000, interestBalance: 50, balanceAmount: 1050, amountPaid: 0, totalAmount: 1050 },
    ];
    const { billUpdates } = allocatePaymentInterestFirst(300, bills);
    expect(parseFloat(billUpdates[0].interestCleared)).toBe(50);
    expect(parseFloat(billUpdates[0].principalCleared)).toBe(250);
    expect(billUpdates[0].newPrincipalBalance).toBe(750);
  });

  test("overpayment capped at bill balance", () => {
    const bills = [
      { _id: "b1", principalBalance: 100, interestBalance: 20, balanceAmount: 120, amountPaid: 0, totalAmount: 120 },
    ];
    const { billUpdates, advanceCredit } = allocatePaymentInterestFirst(500, bills);
    expect(parseFloat(billUpdates[0].interestCleared)).toBe(20);
    expect(parseFloat(billUpdates[0].principalCleared)).toBe(100);
    expect(billUpdates[0].newBalanceAmount).toBe(0);
    expect(advanceCredit).toBe(380);
  });
});

// ── Immutable bill state fields ───────────────────────────────────────────────
describe("immutable bill state formula", () => {
  test("BillPrincipal = openingPrincipal + currentCharges", () => {
    const openingPrincipal = 500;
    const currentCharges = 7118.75;
    const billPrincipal = parseFloat((openingPrincipal + currentCharges).toFixed(2));
    expect(billPrincipal).toBe(7618.75);
  });

  test("BillInterest = openingInterest + currentInterest", () => {
    const openingInterest = 10;
    const currentInterest = 0;
    const billInterest = parseFloat((openingInterest + currentInterest).toFixed(2));
    expect(billInterest).toBe(10);
  });

  test("TotalBillDue = BillPrincipal + BillInterest", () => {
    const billPrincipal = 7618.75;
    const billInterest = 10;
    const total = parseFloat((billPrincipal + billInterest).toFixed(2));
    expect(total).toBe(7628.75);
  });
});

// ── Real-world scenario: May–Jul 2026 ─────────────────────────────────────────
describe("May–Jul 2026 scenario (openingPrincipal=200, openingInterest=85, charges=3427.50, rate=21%)", () => {
  const RATE = 21;
  const CHARGES = 3427.50;
  const GRACE = 1; // interestAfterDays

  // ── MAY bill ──────────────────────────────────────────────────────────────
  test("May: no new interest (generated on due date, within grace)", () => {
    const result = calculateMonthlyInterest({
      remainingPrincipal: 200,
      remInt: 85,
      annualRate: RATE,
      interestAfterDays: GRACE,
      interestActivationMode: "APPLICABLE",
      billDueDate: new Date("2026-05-01"),
      referenceDate: new Date("2026-05-01"),
      interestTriggerTiming: "NEXT_DAY",
    });
    // graceEnd = May 2; ref May 1 is NOT > May 2 → no new interest
    expect(result.currInt).toBe(0);
    expect(result.monthInterest).toBe(85);
  });

  test("May bill immutable fields", () => {
    const openingPrincipal = 200;
    const openingInterest = 85;
    const currentCharges = CHARGES;
    const currentInterest = 0;
    const billPrincipalBalance = parseFloat((openingPrincipal + currentCharges).toFixed(2));
    const billInterestBalance = parseFloat((openingInterest + currentInterest).toFixed(2));
    const totalBillDue = parseFloat((billPrincipalBalance + billInterestBalance).toFixed(2));
    expect(billPrincipalBalance).toBe(3627.50);
    expect(billInterestBalance).toBe(85.00);
    expect(totalBillDue).toBe(3712.50);
  });

  test("May: pay 1000 — clears 85 interest then 915 principal", () => {
    const bills = [
      { _id: "may", principalBalance: 3627.50, interestBalance: 85, balanceAmount: 3712.50, amountPaid: 0, totalAmount: 3712.50 },
    ];
    const { billUpdates } = allocatePaymentInterestFirst(1000, bills);
    expect(parseFloat(billUpdates[0].interestCleared)).toBe(85);
    expect(parseFloat(billUpdates[0].principalCleared)).toBe(915);
    expect(billUpdates[0].newInterestBalance).toBe(0);
    expect(billUpdates[0].newPrincipalBalance).toBe(2712.50);
    expect(billUpdates[0].newBalanceAmount).toBe(2712.50);
  });

  // ── JUN bill ──────────────────────────────────────────────────────────────
  test("Jun: interest on 2712.50 unpaid principal from May", () => {
    const result = calculateMonthlyInterest({
      remainingPrincipal: 2712.50,
      remInt: 0,
      annualRate: RATE,
      interestAfterDays: GRACE,
      interestActivationMode: "APPLICABLE",
      billDueDate: new Date("2026-05-01"), // oldest unpaid bill's dueDate
      referenceDate: new Date("2026-06-01"),
      interestTriggerTiming: "NEXT_DAY",
    });
    // 2712.50 * 21 / 1200 = 47.47
    expect(result.currInt).toBe(47.47);
    expect(result.monthInterest).toBe(47.47);
  });

  test("Jun bill immutable fields", () => {
    const openingPrincipal = 2712.50;
    const openingInterest = 0;
    const currentCharges = CHARGES;
    const currentInterest = 47.47;
    const billPrincipalBalance = parseFloat((openingPrincipal + currentCharges).toFixed(2));
    const billInterestBalance = parseFloat((openingInterest + currentInterest).toFixed(2));
    const totalBillDue = parseFloat((billPrincipalBalance + billInterestBalance).toFixed(2));
    expect(billPrincipalBalance).toBe(6140.00);
    expect(billInterestBalance).toBe(47.47);
    expect(totalBillDue).toBe(6187.47);
  });

  test("Pay 1500 across May+Jun: clears Jun interest first, then May principal", () => {
    const bills = [
      { _id: "may", principalBalance: 2712.50, interestBalance: 0,     balanceAmount: 2712.50, amountPaid: 1000, totalAmount: 3712.50 },
      { _id: "jun", principalBalance: 6140.00, interestBalance: 47.47, balanceAmount: 6187.47, amountPaid: 0,    totalAmount: 6187.47 },
    ];
    const { billUpdates } = allocatePaymentInterestFirst(1500, bills);
    const may = billUpdates[0];
    const jun = billUpdates[1];
    // interest sweep: May has 0, Jun has 47.47 → clears 47.47 from Jun
    expect(parseFloat(jun.interestCleared)).toBe(47.47);
    expect(jun.newInterestBalance).toBe(0);
    // remaining after interest = 1500 - 47.47 = 1452.53
    // principal sweep: May first → 1452.53 off May principal
    expect(parseFloat(may.principalCleared)).toBe(1452.53);
    expect(may.newPrincipalBalance).toBeCloseTo(1259.97, 1);
    // Jun principal untouched
    expect(parseFloat(jun.principalCleared)).toBe(0);
    expect(jun.newPrincipalBalance).toBe(6140.00);
  });

  // ── JUL bill ──────────────────────────────────────────────────────────────
  test("Jul: interest on 7399.97 combined unpaid principal", () => {
    // May remaining principal = 1259.97, Jun = 6140.00
    const prevRemPrincipal = parseFloat((1259.97 + 6140.00).toFixed(2));
    const result = calculateMonthlyInterest({
      remainingPrincipal: prevRemPrincipal,
      remInt: 0,
      annualRate: RATE,
      interestAfterDays: GRACE,
      interestActivationMode: "APPLICABLE",
      billDueDate: new Date("2026-05-01"),
      referenceDate: new Date("2026-07-01"),
      interestTriggerTiming: "NEXT_DAY",
    });
    // 7399.97 * 21 / 1200 = 129.50
    expect(result.currInt).toBe(129.50);
    expect(result.monthInterest).toBe(129.50);
  });

  test("Jul bill immutable fields", () => {
    const openingPrincipal = 7399.97;
    const openingInterest = 0;
    const currentCharges = CHARGES;
    const currentInterest = 129.50;
    const billPrincipalBalance = parseFloat((openingPrincipal + currentCharges).toFixed(2));
    const billInterestBalance = parseFloat((openingInterest + currentInterest).toFixed(2));
    const totalBillDue = parseFloat((billPrincipalBalance + billInterestBalance).toFixed(2));
    expect(billPrincipalBalance).toBe(10827.47);
    expect(billInterestBalance).toBe(129.50);
    expect(totalBillDue).toBe(10956.97);
  });
});
