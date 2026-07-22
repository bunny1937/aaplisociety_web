// Ledger V2 §6 — invariant checks. Throw on failure; callers reject the write.
const twoDp = (n) => parseFloat((Number(n) || 0).toFixed(2));
const EPS = 0.01;

export class InvariantError extends Error {
  constructor(code, message) {
    super(`[${code}] ${message}`);
    this.code = code;
  }
}

// Bill-level, checked at every write.
export function validateBillInvariants(b) {
  const b1 = twoDp(b.openingPrincipal + b.openingInterest + b.currentCharges + b.currentInterest);
  if (Math.abs(b1 - twoDp(b.totalBillDue)) > EPS)
    throw new InvariantError("B1", `opening+current (${b1}) != totalBillDue (${b.totalBillDue})`);

  const b2 = twoDp(b.closingPrincipal + b.closingInterest);
  if (Math.abs(b2 - twoDp(b.balanceAmount)) > EPS)
    throw new InvariantError("B2", `closingP+closingI (${b2}) != balanceAmount (${b.balanceAmount})`);

  if (b.charges) {
    const sum = twoDp(Object.values(b.charges).reduce((a, v) => a + (Number(v) || 0), 0));
    if (Math.abs(sum - twoDp(b.currentCharges)) > EPS)
      throw new InvariantError("B3", `charges sum (${sum}) != currentCharges (${b.currentCharges})`);
  }
  return true;
}

// Platform-level carry-forward continuity (§6 P1/P5), checked at generation.
export function validateCarryForward(prevBill, nextOpeningPrincipal, nextOpeningInterest, nextPeriodId) {
  if (!prevBill) return true;
  if (Math.abs(twoDp(prevBill.closingPrincipal) - twoDp(nextOpeningPrincipal)) > EPS)
    throw new InvariantError("P1", `openingPrincipal must equal prev.closingPrincipal`);
  if (Math.abs(twoDp(prevBill.closingInterest) - twoDp(nextOpeningInterest)) > EPS)
    throw new InvariantError("P1", `openingInterest must equal prev.closingInterest`);
  if (prevBill.billPeriodId && nextPeriodId <= prevBill.billPeriodId)
    throw new InvariantError("P5", `period ${nextPeriodId} must be > prev ${prevBill.billPeriodId}`);
  return true;
}