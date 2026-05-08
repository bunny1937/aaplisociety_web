# Excel Preview Validation Grid

## Component: `ExcelPreviewGrid`

**File:** `app/components/ExcelPreviewGrid.js`

Spreadsheet-style validation grid with sticky headers, horizontal scroll, per-cell error highlighting, and row status badges.

## Props

```js
{
  columns: string[],           // ordered column headers
  rows: Array<{
    rowNum: number,            // Excel row number (starts at 2)
    status: "valid" | "warning" | "error",
    cells: Record<colName, {
      value: any,
      status?: "valid" | "warning" | "error",
      message?: string         // shown below cell value
    }>
  }>,
  title?: string,              // grid heading
  onReupload: () => void,      // Re-upload button handler
  onContinue: (validRows) => void,  // Continue With Valid Rows handler
  onCancel: () => void,        // Cancel Upload handler
  summary?: { valid, warning, error }  // optional (grid computes internally)
}
```

## Visual Behavior

| Status | Row background | Cell border | Badge |
|--------|---------------|-------------|-------|
| valid | transparent | grey | ✓ Valid (green) |
| warning | #fffbeb (yellow-50) | #fde68a | ⚠ Warn (yellow) |
| error | #fef2f2 (red-50) | #fca5a5 | ✗ Error (red) |

- **Sticky headers:** Table header row stays visible while scrolling vertically
- **Max height:** 440px with overflow-y scroll
- **Horizontal scroll:** Full-width overflow-x with `width: max-content`
- **Row numbers:** First column shows Excel row number (grey text)
- **Continue button:** Disabled when 0 valid rows; label shows count

## Usage

```jsx
import ExcelPreviewGrid from "@/components/ExcelPreviewGrid";

<ExcelPreviewGrid
  title="Bill Template Preview — 2026-05"
  columns={data.gridColumns}
  rows={data.gridRows}
  onReupload={() => resetUpload()}
  onContinue={(validRows) => proceed(validRows)}
  onCancel={() => resetUpload()}
/>
```

## Data Source

Grid data comes from API routes that call `validateBillRows` or `validatePaymentRows`:
- `POST /api/billing/validate-excel` → `{ gridRows, gridColumns, gridSummary }`
- `POST /api/billing/upload-payments?action=preview` → `{ gridRows, gridColumns, gridSummary }`
