# Billing Validation

## Bill Template Validator (`validateBillRows`)

**Mandatory fields:** `MemberId`, `Month`, `Year`

**Error conditions (row marked red):**
- `MemberId` missing or not in DB
- Duplicate `MemberId` in same upload
- `Month` doesn't match expected billing month
- `Year` doesn't match expected billing year
- Expected column missing from row

**Warning conditions (row marked yellow):**
- Numeric charge column contains non-numeric value (defaults to 0)
- Charge column has negative value

**Read-only columns (shown as-is):** `Wing`, `FlatNo`, `OwnerName`, `DueDate`, `PreviousBalance`, `InterestDue`, `GrandTotal`

## Payment Template Validator (`validatePaymentRows`)

**Mandatory fields:** `MemberId`, `AmountPaid`, `PaymentMethod`, `PaymentDate`

**Error conditions:**
- `MemberId` missing or not in DB
- Duplicate `MemberId` in same upload
- `AmountPaid` missing, non-numeric, or ≤ 0
- `PaymentMethod` not in: Cash, Cheque, Online, NEFT, UPI
- `PaymentDate` missing, invalid format, or future date

**Warning conditions:**
- `AmountPaid` exceeds remaining bill balance (overpayment)

**Accepted date formats:** `YYYY-MM-DD` or `DD-MM-YYYY`

## Validator Location

Both functions exported from `utils/excelValidator.js` — pure functions, no DB calls.
Routes pre-fetch `validMemberIds` (Set) and `existingBillMap` (Map) from DB before calling.
