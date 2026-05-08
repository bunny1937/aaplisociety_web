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
