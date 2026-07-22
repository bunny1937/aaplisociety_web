// Ledger V2 §4/§8 — PURE payment allocation. Interest is ALWAYS cleared first;
// there is no allocation policy toggle (amended per owner decision). No DB, no
// side effects — deterministic given the same inputs.
const twoDp = (n) => parseFloat((Number(n) || 0).toFixed(2));

export function allocatePayment({ closingPrincipal, closingInterest, payment }) {
  const pay = twoDp(payment);
  if (pay < 0) {
    const e = new Error("Payment cannot be negative");
    e.code = "NEGATIVE_PAYMENT";
    throw e;
  }
  let ci = twoDp(closingInterest);
  let cp = twoDp(closingPrincipal);
  let rem = pay;

  const interestPaid = twoDp(Math.min(rem, ci));
  ci = twoDp(ci - interestPaid);
  rem = twoDp(rem - interestPaid);

  const principalPaid = twoDp(Math.min(rem, cp));
  cp = twoDp(cp - principalPaid);
  rem = twoDp(rem - principalPaid);

  const advanceCredit = twoDp(rem);
  const appliedToBill = twoDp(interestPaid + principalPaid);
  const balanceAmount = twoDp(cp + ci);

  return {
    closingPrincipal: cp,
    closingInterest: ci,
    balanceAmount,
    interestPaid,
    principalPaid,
    appliedToBill,
    advanceCredit,
  };
}

export function deriveStatus({ balanceAmount, amountPaid }) {
  if (twoDp(balanceAmount) <= 0.001) return "Paid";
  if (twoDp(amountPaid) > 0) return "Partial";
  return "Unpaid";
}
