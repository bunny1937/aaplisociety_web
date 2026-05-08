# Billing Engine Rules

## Source of Truth

These rules are immutable. No route may deviate.

1. Unpaid principal carries forward every month.
2. Interest applies ONLY on remaining unpaid principal. Never on previous interest.
3. Interest formula: `remainingPrincipal × annualRate / 1200` (monthly rate = annual / 12 / 100)
4. Payment allocation order: interest first, then principal.
5. If partial payment before threshold: interest applies only on remaining unpaid principal.
6. Immutable bill fields set at creation: `openingPrincipal`, `openingInterest`, `currentCharges`, `currentInterest`, `billPrincipalBalance`, `billInterestBalance`, `totalBillDue`.
7. Closing balances derived after payments (not stored at generation time).
8. Ledger shows: total due, total paid, remaining balance (not cumulative additions).

## VIEW Mode

- Interest not added during current cycle.
- Member sees warning after `interestAfterDays`.
- Interest carried (`remInt`) passes through unchanged.
- Interest added at NEXT bill generation cycle.

## APPLICABLE Mode

- After `interestAfterDays` from bill due date, unpaid principal becomes interest-eligible.
- Partial payment before threshold: interest only on remaining unpaid principal.
- `currInt = remainingPrincipal × annualRate / 1200`
- `monthInterest = remInt + currInt`

## Key Functions

| Function | File | Purpose |
|----------|------|---------|
| `calculateMonthlyInterest` | `utils/interestUtils.js:36` | Single source of truth for interest calculation |
| `allocatePaymentInterestFirst` | `utils/interestUtils.js:180` | Payment distribution — interest before principal |
| `roundInterest` | `utils/interestUtils.js:13` | Society rounding config (TWO_DECIMAL / ROUND_UP) |
| `getOldestDueDate` | `utils/interestUtils.js:103` | Anchor date for interest calculation |

## Immutable Field Formulas

```
billPrincipalBalance = openingPrincipal + currentCharges
billInterestBalance  = openingInterest + currentInterest
totalBillDue         = billPrincipalBalance + billInterestBalance
principalBalance     = billPrincipalBalance   (starts equal, decreases with payments)
interestBalance      = billInterestBalance    (starts equal, decreases with payments)
balanceAmount        = totalBillDue           (starts equal, decreases with payments)
```
