# Society Billing Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `app/admin/generate-bills/page.js` into a complete, self-contained society billing lifecycle with member selection, two distinct Excel lifecycles (bill generation + payment collection), dynamic billing config, receipt-linked next-month PDFs, and full DB persistence — all admin-only, no member self-payments.

**Architecture:** Single page (`generate-bills/page.js`) owns the entire lifecycle. Two independent Excel flows share the page: Flow 1 (generate bills) and Flow 2 (collect payments). All APIs already exist; this plan wires them into the correct UI sections and fixes structural mismatches. Member selection gates both flows before preview.

**Tech Stack:** Next.js App Router, React (useState/useQuery/useMutation), @tanstack/react-query, xlsx (server-side), MongoDB/Mongoose, JWT auth, CSS Modules (`GenerateBills.module.css`).

---

## Current State (read before starting)

- `app/admin/generate-bills/page.js` — 1600+ line monolith with mixed flows, no member selector, wrong template wired
- `app/api/billing/excel-template/route.js` — Bill Generation Template (pre-fills charges + interest from billing engine) ✅ working
- `app/api/billing/payment-template/route.js` — Payment Collection Template (pre-fills bill snapshot data) ✅ working
- `app/api/billing/validate-excel/route.js` — validates bill generation upload ✅
- `app/api/billing/upload-payments/route.js` — preview+confirm for payment collection ✅
- `app/api/bills/generate-final/route.js` — generates bills + PDFs ✅
- `app/api/member/pay/route.js` — already disabled with 403 ✅
- `app/member/my-bills/page.js` — payment buttons already removed ✅
- `lib/bill-renderer.js` — interest bug fixed (uses `prevRemPrincipal`) ✅

## What is NOT Done

1. Member selector UI before preview
2. Page structured into 4 explicit sections (bill gen template download/upload + payment template download/upload)
3. Dynamic billing run config (due date, grace period etc.) moved from society-config into generate-bills page as per-run overrides
4. Payment collection template download wired to correct section (currently buried in wrong UI)
5. Receipt-to-next-month PDF linkage verification
6. Society config billing settings removed from society-config page

---

## File Map

| File | Change |
|------|--------|
| `app/admin/generate-bills/page.js` | Major restructure — member selector, 4 sections, dynamic config |
| `app/api/billing/excel-template/route.js` | Add `memberIds` filter query param support |
| `app/api/billing/payment-template/route.js` | Add `memberIds` filter query param support |
| `app/api/bills/generate-final/route.js` | Accept `dueDate` + dynamic config overrides already present ✅ |
| `app/api/billing/validate-excel/route.js` | Read to understand validation shape |
| `app/admin/society-config/page.js` | Remove billing-specific fields (grace period, due day, etc.) |
| `app/api/society/config/route.js` | Verify config fields still returned (used for defaults) |
| `lib/bill-renderer.js` | Verify receipt attachment from prior month in PDF output |
| `app/api/bills/download/route.js` | Verify it fetches and attaches Receipt for prior period |

---

## Task 1: Read Current Validation API Shape

**Files:**
- Read: `app/api/billing/validate-excel/route.js`
- Read: `app/api/bills/get-previous-balances/route.js`

- [ ] **Step 1: Read validate-excel route**

```bash
cat app/api/billing/validate-excel/route.js
```

Note the exact response shape: what fields are in `issues[]`, what `canProceed` means, what columns it expects.

- [ ] **Step 2: Read get-previous-balances route**

```bash
cat app/api/bills/get-previous-balances/route.js
```

Note what `balances[memberId]` contains: `balance`, `principalBalance`, `daysOverdue`, `oldestUnpaidDate`, `unpaidBills`, `recentTransactions`.

- [ ] **Step 3: Commit nothing** — this is a read-only task.

---

## Task 2: Add `memberIds` Filter to Both Template Routes

Both `/api/billing/excel-template` and `/api/billing/payment-template` currently return ALL members. When admin selects specific members, templates must only include selected members.

**Files:**
- Modify: `app/api/billing/excel-template/route.js:32-47`
- Modify: `app/api/billing/payment-template/route.js:35-42`

- [ ] **Step 1: Add memberIds filter to excel-template route**

In `app/api/billing/excel-template/route.js`, after parsing `month` and `year` from searchParams, add:

```js
const memberIdsParam = searchParams.get("memberIds");
const filterMemberIds = memberIdsParam
  ? memberIdsParam.split(",").filter(Boolean)
  : null;
```

Then modify the `Member.find(...)` query (currently at line ~37):

```js
const memberQuery = {
  societyId: decoded.societyId,
  isDeleted: { $ne: true },
};
if (filterMemberIds && filterMemberIds.length > 0) {
  memberQuery._id = { $in: filterMemberIds };
}
// Replace Member.find({ societyId: decoded.societyId, isDeleted: { $ne: true } })
// with:
Member.find(memberQuery)
```

- [ ] **Step 2: Add memberIds filter to payment-template route**

Same change in `app/api/billing/payment-template/route.js` at the Member.find call (~line 36):

```js
const memberIdsParam = searchParams.get("memberIds");
const filterMemberIds = memberIdsParam
  ? memberIdsParam.split(",").filter(Boolean)
  : null;

const memberQuery = {
  societyId: decoded.societyId,
  isDeleted: { $ne: true },
};
if (filterMemberIds && filterMemberIds.length > 0) {
  memberQuery._id = { $in: filterMemberIds };
}
```

Then replace the `Member.find(...)` call to use `memberQuery`.

- [ ] **Step 3: Commit**

```bash
git add app/api/billing/excel-template/route.js app/api/billing/payment-template/route.js
git commit -m "feat: add memberIds filter to both template download routes"
```

---

## Task 3: Member Selector Component Logic (State + Search)

Add member selection state and search/filter logic to `generate-bills/page.js`. This is pure state — no UI yet.

**Files:**
- Modify: `app/admin/generate-bills/page.js` (state + hooks section, ~lines 1–70)

- [ ] **Step 1: Add member selector state variables**

After the existing state declarations (after line ~46 `const [payResults, setPayResults] = useState(null);`), add:

```js
// Member selector
const [memberSearch, setMemberSearch] = useState("");
const [memberWingFilter, setMemberWingFilter] = useState("all");
const [selectedMembers, setSelectedMembers] = useState(new Set()); // Set of memberId strings
const [selectorExpanded, setSelectorExpanded] = useState(true);
```

- [ ] **Step 2: Add derived member filter logic**

After the state block, add:

```js
const allMembers = membersData?.members || [];
const allWings = [...new Set(allMembers.map(m => m.wing).filter(Boolean))].sort();

const filteredMembers = allMembers.filter(m => {
  const searchLower = memberSearch.toLowerCase();
  const matchSearch = !memberSearch ||
    (m.ownerName || "").toLowerCase().includes(searchLower) ||
    (m.flatNo || "").toLowerCase().includes(searchLower) ||
    (m.wing || "").toLowerCase().includes(searchLower);
  const matchWing = memberWingFilter === "all" || m.wing === memberWingFilter;
  return matchSearch && matchWing;
});

const toggleMember = (id) => {
  setSelectedMembers(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
};

const selectAllFiltered = () => {
  setSelectedMembers(prev => {
    const next = new Set(prev);
    filteredMembers.forEach(m => next.add(m._id));
    return next;
  });
};

const deselectAllFiltered = () => {
  setSelectedMembers(prev => {
    const next = new Set(prev);
    filteredMembers.forEach(m => next.delete(m._id));
    return next;
  });
};
```

- [ ] **Step 3: Update generatePreview to use selectedMembers**

Find the line in `generatePreview` that does:
```js
const members = membersData.members;
```

Replace with:
```js
const members = membersData.members.filter(m =>
  selectedMembers.size === 0 || selectedMembers.has(m._id)
);
if (members.length === 0) {
  alert("❌ No members selected. Please select at least one member.");
  return;
}
```

- [ ] **Step 4: Commit**

```bash
git add app/admin/generate-bills/page.js
git commit -m "feat: add member selector state and filter logic to generate-bills"
```

---

## Task 4: Member Selector UI (Section 0)

Render the searchable multi-select member panel at the top of the page, before the billing period form.

**Files:**
- Modify: `app/admin/generate-bills/page.js` (JSX return section, ~line 953)

- [ ] **Step 1: Insert Member Selector section into JSX**

After the stats banner (`{/* Stats Banner */}` block, after the closing `)}`) and before `{/* Form */}`, insert:

```jsx
{/* ── SECTION 0: Member Selector ────────────────────────────── */}
<div style={{ background: "#fff", border: "2px solid #e5e7eb", borderRadius: 12, padding: "1.25rem", marginBottom: "1.5rem" }}>
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: selectorExpanded ? "1rem" : 0 }}>
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
      <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "#1e40af" }}>👥 Select Members</span>
      <span style={{ background: selectedMembers.size > 0 ? "#dbeafe" : "#f3f4f6", color: selectedMembers.size > 0 ? "#1e40af" : "#6b7280", padding: "2px 10px", borderRadius: 20, fontSize: "0.8rem", fontWeight: 700 }}>
        {selectedMembers.size} / {allMembers.length} selected
      </span>
    </div>
    <button
      onClick={() => setSelectorExpanded(e => !e)}
      style={{ background: "none", border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: "0.85rem", color: "#6b7280" }}
    >
      {selectorExpanded ? "▲ Collapse" : "▼ Expand"}
    </button>
  </div>

  {selectorExpanded && (
    <>
      {/* Search + Wing Filter */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        <input
          placeholder="Search by name, flat, wing…"
          value={memberSearch}
          onChange={e => setMemberSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: "0.5rem 0.75rem", border: "1px solid #d1d5db", borderRadius: 7, fontSize: "0.875rem" }}
        />
        <select
          value={memberWingFilter}
          onChange={e => setMemberWingFilter(e.target.value)}
          style={{ padding: "0.5rem 0.75rem", border: "1px solid #d1d5db", borderRadius: 7, fontSize: "0.875rem" }}
        >
          <option value="all">All Wings</option>
          {allWings.map(w => <option key={w} value={w}>Wing {w}</option>)}
        </select>
        <button className="btn btn-secondary" style={{ fontSize: "0.8rem" }} onClick={selectAllFiltered}>
          Select All ({filteredMembers.length})
        </button>
        <button className="btn btn-secondary" style={{ fontSize: "0.8rem" }} onClick={deselectAllFiltered}>
          Deselect All
        </button>
      </div>

      {/* Member Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0.5rem", maxHeight: 300, overflowY: "auto", padding: "0.25rem" }}>
        {filteredMembers.map(m => {
          const isSelected = selectedMembers.has(m._id);
          return (
            <div
              key={m._id}
              onClick={() => toggleMember(m._id)}
              style={{
                border: `2px solid ${isSelected ? "#1e40af" : "#e5e7eb"}`,
                borderRadius: 8,
                padding: "0.5rem 0.75rem",
                cursor: "pointer",
                background: isSelected ? "#eff6ff" : "#fafafa",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                userSelect: "none",
              }}
            >
              <input type="checkbox" readOnly checked={isSelected} style={{ pointerEvents: "none" }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "#1f2937" }}>{m.wing}-{m.flatNo}</div>
                <div style={{ fontSize: "0.75rem", color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{m.ownerName}</div>
              </div>
            </div>
          );
        })}
        {filteredMembers.length === 0 && (
          <div style={{ gridColumn: "1/-1", textAlign: "center", color: "#9ca3af", padding: "1.5rem" }}>
            No members match the search/filter
          </div>
        )}
      </div>

      {selectedMembers.size === 0 && (
        <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.75rem", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 6, fontSize: "0.8rem", color: "#92400e" }}>
          ⚠️ No members selected. Select at least one to download templates or generate bills.
        </div>
      )}
    </>
  )}
</div>
```

- [ ] **Step 2: Verify render — open generate-bills page in browser**

Check:
- Member cards appear
- Search filters by name/flat/wing
- Wing dropdown shows all wings
- Clicking a card toggles selection
- Count badge updates correctly
- Collapse/expand works

- [ ] **Step 3: Commit**

```bash
git add app/admin/generate-bills/page.js
git commit -m "feat: add searchable multi-select member selector to generate-bills"
```

---

## Task 5: Dynamic Billing Run Configuration Section

Replace the hardcoded due-date field with a full Billing Run Configuration panel that overrides society defaults per-run.

**Files:**
- Modify: `app/admin/generate-bills/page.js` (state + form section)

- [ ] **Step 1: Add dynamic config state**

In the state block, replace the existing `const [dueDate, setDueDate] = useState("");` and surrounding fields with:

```js
// Billing run configuration (per-run overrides — do not persist to DB)
const [billDueDay, setBillDueDay] = useState(10);
const [gracePeriodDays, setGracePeriodDays] = useState(0);
const [billPayFinalDay, setBillPayFinalDay] = useState(0);
const [billVisibleFromDay, setBillVisibleFromDay] = useState(1);
const [dueDate, setDueDate] = useState("");
```

- [ ] **Step 2: Populate defaults from society config when data loads**

Add a `useEffect` that syncs with `societyData`:

```js
useEffect(() => {
  const config = societyData?.society?.config || {};
  if (config.billDueDay) setBillDueDay(config.billDueDay);
  if (config.gracePeriodDays !== undefined) setGracePeriodDays(config.gracePeriodDays);
  if (config.billPayFinalDay !== undefined) setBillPayFinalDay(config.billPayFinalDay);
  if (config.billVisibleFromDay !== undefined) setBillVisibleFromDay(config.billVisibleFromDay);
}, [societyData]);
```

- [ ] **Step 3: Replace the form card JSX**

Find `{/* Form */}` block and replace the entire card content with:

```jsx
{/* ── SECTION 1: Billing Period + Run Config ─────────────────── */}
<div className={styles.formCard}>
  <h2>📅 Billing Run Configuration</h2>
  <p style={{ color: "#6b7280", fontSize: "0.875rem", marginTop: -4, marginBottom: "1.25rem" }}>
    These settings apply only to this billing run and are not saved globally.
  </p>
  <div className={styles.formGrid}>
    <div className={styles.formGroup}>
      <label>Bill Month</label>
      <select value={billMonth} onChange={e => setBillMonth(parseInt(e.target.value))} className={styles.select}>
        {Array.from({ length: 12 }, (_, i) => {
          const isPast = billYear < CUR_YEAR || (billYear === CUR_YEAR && i < CUR_MONTH);
          return (
            <option key={i} value={i} disabled={isPast}>
              {new Date(2000, i).toLocaleString("default", { month: "long" })}
              {isPast ? " (past)" : ""}
            </option>
          );
        })}
      </select>
    </div>
    <div className={styles.formGroup}>
      <label>Bill Year</label>
      <input type="number" value={billYear} min={CUR_YEAR} max={2035}
        onChange={e => {
          const y = parseInt(e.target.value);
          setBillYear(y);
          if (y === CUR_YEAR && billMonth < CUR_MONTH) setBillMonth(CUR_MONTH);
        }}
      />
    </div>
    <div className={styles.formGroup}>
      <label>Due Date</label>
      <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={styles.input} />
    </div>
    <div className={styles.formGroup}>
      <label>Bill Due Day (default)</label>
      <input type="number" value={billDueDay} min={1} max={31}
        onChange={e => setBillDueDay(parseInt(e.target.value) || 10)}
      />
    </div>
    <div className={styles.formGroup}>
      <label>Interest Grace Period (days)</label>
      <input type="number" value={gracePeriodDays} min={0} max={60}
        onChange={e => setGracePeriodDays(parseInt(e.target.value) || 0)}
      />
    </div>
    <div className={styles.formGroup}>
      <label>Payment Window Closes (day of month, 0=never)</label>
      <input type="number" value={billPayFinalDay} min={0} max={31}
        onChange={e => setBillPayFinalDay(parseInt(e.target.value) || 0)}
      />
    </div>
    <div className={styles.formGroup}>
      <label>Bills Visible To Members From (day)</label>
      <input type="number" value={billVisibleFromDay} min={1} max={31}
        onChange={e => setBillVisibleFromDay(parseInt(e.target.value) || 1)}
      />
    </div>
  </div>
</div>
```

- [ ] **Step 4: Pass dynamic config to `generatePreview`**

In `generatePreview`, update the `calculateInterest` call to use local state vars:

```js
const interestAmount = calculateInterest(
  prevData.principalBalance ?? prevData.balance,
  prevData.daysOverdue,
  interestRate,
  interestMethod,
  gracePeriodDays,   // now from local state, not config
  interestBasis,
);
```

Also pass `billDueDay` and `gracePeriodDays` in the `generateMutation` payload to `/api/bills/generate-final` so server uses them:

In `generateMutation.mutationFn`, add to the bills payload:
```js
gracePeriodDays,
billDueDay,
billPayFinalDay,
```

- [ ] **Step 5: Commit**

```bash
git add app/admin/generate-bills/page.js
git commit -m "feat: add dynamic per-run billing configuration to generate-bills page"
```

---

## Task 6: Remove Billing Settings from Society Config Page

**Files:**
- Read first: `app/admin/society-config/page.js`
- Modify: `app/admin/society-config/page.js`

- [ ] **Step 1: Read society-config page to find billing fields**

```bash
grep -n "billDueDay\|gracePeriodDays\|billPayFinalDay\|billVisibleFromDay\|billGenerationDay" app/admin/society-config/page.js | head -30
```

- [ ] **Step 2: Remove billing-specific config fields from society-config form**

Remove input fields for: `billDueDay`, `gracePeriodDays`, `billPayFinalDay`, `billVisibleFromDay`, `billGenerationDay` from the UI only. Do NOT change the API or model — defaults still come from DB.

If these fields are in a dedicated "Billing Settings" section, remove the entire section. If mixed into a general config form, remove only the billing-specific inputs.

- [ ] **Step 3: Add a note in society-config**

In place of removed fields, add:

```jsx
<div style={{ padding: "1rem", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, fontSize: "0.875rem", color: "#1e40af" }}>
  💡 Billing-specific settings (due day, grace period, payment window) are now configured per billing run on the <strong>Generate Bills</strong> page.
</div>
```

- [ ] **Step 4: Commit**

```bash
git add app/admin/society-config/page.js
git commit -m "chore: remove billing-specific settings from society-config (now in generate-bills)"
```

---

## Task 7: Restructure Page into 4 Explicit Workflow Sections

Replace the confusing "Auto Generate / Excel Upload" tab toggle with 4 clearly named, always-visible workflow sections.

**Files:**
- Modify: `app/admin/generate-bills/page.js` (main JSX, ~lines 1120–1600)

The 4 sections:
1. **📥 Download Bill Generation Template** — calls `/api/billing/excel-template` with selected memberIds
2. **📤 Upload Bill Generation Template** — validate + compare + generate bills
3. **📥 Download Payment Collection Template** — calls `/api/billing/payment-template` with selected memberIds (only after bills exist)
4. **📤 Upload Payment Collection** — validate + preview + confirm payments

- [ ] **Step 1: Remove the generation mode toggle JSX**

Delete the entire `{/* Generation Mode Toggle */}` block (the `auto` / `excel` tab toggle div at ~lines 1120–1168).

Also delete the `{/* EXCEL MODE */}` conditional block that wraps everything (~lines 1170–1334 for step 1, and continuing for steps 2-3).

Keep:
- The auto-preview panel (`{showPreview && ...}`) — it still works for "generate from preview"
- The generatePreview button in the form card (moved below Billing Run Config section)

- [ ] **Step 2: Replace with 4-section layout**

After the form card closing tag, insert this 4-section layout:

```jsx
{/* ── FLOW 1: Bill Generation ────────────────────────────────── */}
<div style={{ marginBottom: "2rem" }}>
  <h2 style={{ borderBottom: "3px solid #1e40af", paddingBottom: "0.5rem", color: "#1e40af", marginBottom: "1.25rem" }}>
    📋 Flow 1 — Bill Generation
  </h2>

  {/* Section 1A: Download Bill Generation Template */}
  <div style={{ background: "#eff6ff", border: "2px solid #bfdbfe", borderRadius: 12, padding: "1.25rem", marginBottom: "1rem" }}>
    <h3 style={{ margin: "0 0 0.5rem", color: "#1e40af" }}>📥 Step 1: Download Bill Generation Template</h3>
    <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "#374151", lineHeight: 1.6 }}>
      Pre-filled with current charges and interest calculated from billing engine.
      Edit charge amounts if needed, then upload in Step 2.
      <br /><strong>Columns:</strong> MemberId · Wing · FlatNo · OwnerName · Month · Year · DueDate · [Charge heads] · PreviousBalance · InterestDue · GrandTotal
    </p>
    <button
      className="btn btn-primary"
      disabled={selectedMembers.size === 0}
      onClick={async () => {
        if (selectedMembers.size === 0) { alert("Select at least one member first"); return; }
        try {
          const period = `${billYear}-${String(billMonth + 1).padStart(2, "0")}`;
          const ids = [...selectedMembers].join(",");
          const res = await fetch(
            `/api/billing/excel-template?month=${billMonth + 1}&year=${billYear}&memberIds=${encodeURIComponent(ids)}`,
            { credentials: "include" }
          );
          if (!res.ok) { const e = await res.json(); alert(e.error || "Failed"); return; }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `BillGenTemplate_${period}.xlsx`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (e) { alert("Download failed: " + e.message); }
      }}
    >
      📥 Download Bill Generation Template ({selectedMembers.size} members)
    </button>
    {selectedMembers.size === 0 && (
      <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: "#9ca3af" }}>Select members above first</p>
    )}
  </div>

  {/* Section 1B: Upload Bill Generation Template */}
  <div style={{ background: "#fff", border: "2px solid #e5e7eb", borderRadius: 12, padding: "1.25rem", marginBottom: "1rem" }}>
    <h3 style={{ margin: "0 0 0.5rem", color: "#374151" }}>📤 Step 2: Upload Bill Generation Template</h3>
    <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "#6b7280", lineHeight: 1.6 }}>
      Upload the edited template. System validates member IDs, amounts, duplicates, and compares against calculated values.
      Bills are generated after approval.
    </p>

    {/* File Drop Zone */}
    <div
      style={{
        border: "2px dashed #d1d5db", borderRadius: 10, padding: "2rem",
        textAlign: "center", background: excelFile ? "#f0fdf4" : "#fafafa",
        marginBottom: "1rem", cursor: "pointer"
      }}
      onClick={() => document.getElementById("billGenUpload").click()}
    >
      {excelFile ? (
        <>
          <div style={{ fontSize: "2rem" }}>✅</div>
          <div style={{ fontWeight: 600, color: "#059669" }}>{excelFile.name}</div>
          <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>{(excelFile.size / 1024).toFixed(1)} KB</div>
          <button
            style={{ marginTop: "0.5rem", background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "2px 10px", cursor: "pointer", fontSize: "0.8rem", color: "#6b7280" }}
            onClick={e => { e.stopPropagation(); setExcelFile(null); setExcelValidation(null); }}
          >Remove</button>
        </>
      ) : (
        <>
          <div style={{ fontSize: "2rem" }}>📂</div>
          <div style={{ fontWeight: 600, color: "#374151" }}>Click to select Excel file</div>
          <div style={{ fontSize: "0.8rem", color: "#9ca3af" }}>.xlsx or .xls</div>
        </>
      )}
      <input id="billGenUpload" type="file" accept=".xlsx,.xls" style={{ display: "none" }}
        onChange={e => { setExcelFile(e.target.files[0] || null); setExcelValidation(null); }} />
    </div>

    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
      <button
        className="btn btn-primary"
        disabled={!excelFile || excelValidating}
        onClick={async () => {
          setExcelValidating(true);
          setExcelValidation(null);
          try {
            const formData = new FormData();
            formData.append("file", excelFile);
            formData.append("month", String(billMonth + 1));
            formData.append("year", String(billYear));
            formData.append("dueDate", dueDate);
            const res = await fetch("/api/billing/validate-excel", { method: "POST", body: formData, credentials: "include" });
            const data = await res.json();
            setExcelValidation(data);
            setApprovedDiffs(new Set());
            if (data.canProceed) setExcelStep(3);
          } catch (e) { alert("Validation error: " + e.message); }
          finally { setExcelValidating(false); }
        }}
      >
        {excelValidating ? "⏳ Validating…" : "✓ Validate Template"}
      </button>

      {excelValidation?.canProceed && (
        <button
          className="btn btn-success"
          disabled={!canGenerate || excelImporting}
          onClick={async () => {
            if (!confirm(`Generate bills from this Excel for ${billYear}-${String(billMonth + 1).padStart(2, "0")}?`)) return;
            setExcelImporting(true);
            try {
              const formData = new FormData();
              formData.append("file", excelFile);
              formData.append("month", String(billMonth + 1));
              formData.append("year", String(billYear));
              formData.append("dueDate", dueDate);
              const res = await fetch("/api/billing/import", { method: "POST", body: formData, credentials: "include" });
              const data = await res.json();
              if (!data.success) throw new Error(data.error || "Import failed");
              alert(`✅ Generated ${data.count || data.billsGenerated || 0} bills successfully!`);
              setExcelFile(null);
              setExcelValidation(null);
              queryClient.invalidateQueries(["bills-list"]);
            } catch (e) { alert("Generation failed: " + e.message); }
            finally { setExcelImporting(false); }
          }}
        >
          {excelImporting ? "⏳ Generating…" : "⚡ Generate Bills from Excel"}
        </button>
      )}
    </div>

    {/* Validation Results */}
    {excelValidation && !excelValidation.canProceed && (
      <div style={{ marginTop: "1rem", background: "#fef2f2", border: "2px solid #fca5a5", borderRadius: 10, padding: "1.25rem" }}>
        <h4 style={{ color: "#dc2626", margin: "0 0 0.75rem" }}>❌ Fix these issues before generating</h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.5rem", marginBottom: "1rem" }}>
          {[["Errors", "#dc2626", excelValidation.errorCount], ["Warnings", "#d97706", excelValidation.warningCount], ["Duplicates", "#7c3aed", excelValidation.duplicateCount]].map(([l, c, v]) => (
            <div key={l} style={{ textAlign: "center", padding: "0.5rem", borderRadius: 8, background: "white", border: `2px solid ${c}` }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: c }}>{v}</div>
              <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{l}</div>
            </div>
          ))}
        </div>
        <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.8rem", color: "#7f1d1d" }}>
          {excelValidation.issues?.slice(0, 10).map((iss, i) => (
            <li key={i}>Row {iss.row || iss.rowNum}: {iss.message || iss.error || JSON.stringify(iss)}</li>
          ))}
          {(excelValidation.issues?.length || 0) > 10 && <li>… and {excelValidation.issues.length - 10} more</li>}
        </ul>
      </div>
    )}

    {excelValidation?.canProceed && (
      <div style={{ marginTop: "1rem", padding: "0.75rem 1rem", background: "#f0fdf4", border: "2px solid #86efac", borderRadius: 8, fontSize: "0.875rem", color: "#166534" }}>
        ✅ Validation passed — {excelValidation.validRows || excelValidation.rowCount} rows valid.
        {diffIssues.length > 0 && ` ${diffIssues.length - approvedDiffs.size} difference(s) need approval.`}
      </div>
    )}
  </div>
</div>

{/* Auto-generate preview (unchanged existing flow) */}
<div style={{ marginBottom: "2rem" }}>
  <h3 style={{ color: "#374151", fontSize: "1rem", marginBottom: "0.75rem" }}>
    Or: Auto-generate from billing engine (preview then confirm)
  </h3>
  <button
    onClick={generatePreview}
    disabled={isPreviewing || selectedMembers.size === 0}
    className="btn btn-primary"
    style={{ minWidth: 260, position: "relative" }}
  >
    {isPreviewing ? (
      <span style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <span className="loading-spinner" />
        {previewProgress.label === "fetching"
          ? `⏳ Fetching balances for ${selectedMembers.size} members…`
          : `⚙️ Calculating ${previewProgress.current}/${previewProgress.total}`}
      </span>
    ) : (
      `👁️ Preview Bills for ${selectedMembers.size} Selected Member(s)`
    )}
  </button>
</div>

{/* ── FLOW 2: Payment Collection ──────────────────────────────── */}
<div style={{ marginBottom: "2rem" }}>
  <h2 style={{ borderBottom: "3px solid #059669", paddingBottom: "0.5rem", color: "#059669", marginBottom: "1.25rem" }}>
    💰 Flow 2 — Payment Collection
  </h2>

  {/* Section 2A: Download Payment Collection Template */}
  <div style={{ background: "#f0fdf4", border: "2px solid #86efac", borderRadius: 12, padding: "1.25rem", marginBottom: "1rem" }}>
    <h3 style={{ margin: "0 0 0.5rem", color: "#166534" }}>📥 Step 3: Download Payment Collection Template</h3>
    <p style={{ margin: "0 0 0.5rem", fontSize: "0.875rem", color: "#374151", lineHeight: 1.6 }}>
      Download after bills are generated. Pre-filled with bill balances, opening principal/interest, and last receipt info.
      Admin fills only: <strong>AmountPaid · PaymentMethod · PaymentDate · Remarks</strong>
    </p>
    <p style={{ margin: "0 0 1rem", fontSize: "0.8rem", color: "#6b7280" }}>
      Columns: MemberId · Wing · FlatNo · OwnerName · Month · Year · BillId · TotalBillDue · AlreadyPaid · RemainingDue · AmountPaid · PaymentMethod · PaymentDate · Remarks · LastReceiptNo · LastPaymentDate
    </p>
    <button
      className="btn btn-success"
      disabled={selectedMembers.size === 0}
      onClick={async () => {
        if (selectedMembers.size === 0) { alert("Select at least one member first"); return; }
        try {
          const period = `${billYear}-${String(billMonth + 1).padStart(2, "0")}`;
          const ids = [...selectedMembers].join(",");
          const res = await fetch(
            `/api/billing/payment-template?month=${billMonth + 1}&year=${billYear}&memberIds=${encodeURIComponent(ids)}`,
            { credentials: "include" }
          );
          if (!res.ok) { const e = await res.json(); alert(e.error || "Failed"); return; }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `PaymentCollection_${period}.xlsx`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (e) { alert("Download failed: " + e.message); }
      }}
    >
      📥 Download Payment Collection Template ({selectedMembers.size} members)
    </button>
  </div>

  {/* Section 2B: Upload Payment Collection */}
  <div style={{ background: "#fff", border: "2px solid #e5e7eb", borderRadius: 12, padding: "1.25rem" }}>
    <h3 style={{ margin: "0 0 0.5rem", color: "#374151" }}>📤 Step 4: Upload Payment Collection</h3>
    <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "#6b7280", lineHeight: 1.6 }}>
      Upload the filled payment collection sheet. System validates, allocates interest-first, updates closing balances, creates receipts, and updates ledger.
    </p>

    <div
      style={{
        border: "2px dashed #d1d5db", borderRadius: 10, padding: "2rem",
        textAlign: "center", background: payFile ? "#f0fdf4" : "#fafafa",
        marginBottom: "1rem", cursor: "pointer"
      }}
      onClick={() => document.getElementById("payCollUpload").click()}
    >
      {payFile ? (
        <>
          <div style={{ fontSize: "2rem" }}>✅</div>
          <div style={{ fontWeight: 600, color: "#059669" }}>{payFile.name}</div>
          <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>{(payFile.size / 1024).toFixed(1)} KB</div>
          <button
            style={{ marginTop: "0.5rem", background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "2px 10px", cursor: "pointer", fontSize: "0.8rem", color: "#6b7280" }}
            onClick={e => { e.stopPropagation(); setPayFile(null); setPayPreview(null); setPayBatchKey(null); setPayResults(null); }}
          >Remove</button>
        </>
      ) : (
        <>
          <div style={{ fontSize: "2rem" }}>📂</div>
          <div style={{ fontWeight: 600, color: "#374151" }}>Click to select filled payment Excel</div>
          <div style={{ fontSize: "0.8rem", color: "#9ca3af" }}>.xlsx or .xls</div>
        </>
      )}
      <input id="payCollUpload" type="file" accept=".xlsx,.xls" style={{ display: "none" }}
        onChange={e => { setPayFile(e.target.files[0] || null); setPayPreview(null); setPayBatchKey(null); setPayResults(null); }} />
    </div>

    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
      <button className="btn btn-primary" disabled={!payFile || payPreviewing} onClick={handlePayPreview}>
        {payPreviewing ? "⏳ Validating…" : "✓ Validate Payments"}
      </button>
      {payBatchKey && payPreview?.validRows > 0 && (
        <button className="btn btn-success" disabled={payConfirming} onClick={handlePayConfirm}>
          {payConfirming ? "⏳ Processing…" : `✅ Confirm & Process ${payPreview.validRows} Payment(s)`}
        </button>
      )}
    </div>

    {/* Preview table */}
    {payPreview && (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "0.5rem", marginBottom: "1rem" }}>
          {[
            ["Total Rows", "#374151", payPreview.totalRows],
            ["Valid", "#059669", payPreview.validRows],
            ["Failed", "#dc2626", payPreview.failedRows],
            ["Total Amount", "#1e40af", `₹${(payPreview.totalAmount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`],
          ].map(([l, c, v]) => (
            <div key={l} style={{ textAlign: "center", padding: "0.75rem", borderRadius: 8, background: "white", border: `2px solid ${c}20` }}>
              <div style={{ fontSize: "1.25rem", fontWeight: 700, color: c }}>{v}</div>
              <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{l}</div>
            </div>
          ))}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
            <thead>
              <tr style={{ background: "#f3f4f6" }}>
                {["Row", "Flat", "Member", "Period", "Bill Due", "Already Paid", "Paying", "Status"].map(h => (
                  <th key={h} style={{ padding: "6px 10px", textAlign: "left", border: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payPreview.preview?.map((row, i) => (
                <tr key={i} style={{ background: row.status === "Failed" ? "#fef2f2" : i % 2 === 0 ? "#fff" : "#f9fafb" }}>
                  <td style={{ padding: "6px 10px", border: "1px solid #e5e7eb" }}>{row.rowNum}</td>
                  <td style={{ padding: "6px 10px", border: "1px solid #e5e7eb" }}>{row.flat}</td>
                  <td style={{ padding: "6px 10px", border: "1px solid #e5e7eb", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.memberName}</td>
                  <td style={{ padding: "6px 10px", border: "1px solid #e5e7eb" }}>{row.billPeriodId}</td>
                  <td style={{ padding: "6px 10px", border: "1px solid #e5e7eb", textAlign: "right" }}>₹{(row.billDue || 0).toLocaleString("en-IN")}</td>
                  <td style={{ padding: "6px 10px", border: "1px solid #e5e7eb", textAlign: "right" }}>₹{(row.alreadyPaid || 0).toLocaleString("en-IN")}</td>
                  <td style={{ padding: "6px 10px", border: "1px solid #e5e7eb", textAlign: "right", fontWeight: 700, color: "#1e40af" }}>₹{(row.amountPaid || 0).toLocaleString("en-IN")}</td>
                  <td style={{ padding: "6px 10px", border: "1px solid #e5e7eb" }}>
                    {row.status === "Failed"
                      ? <span style={{ color: "#dc2626", fontWeight: 600 }}>❌ {row.errors?.join(", ")}</span>
                      : row.willOverpay
                        ? <span style={{ color: "#d97706", fontWeight: 600 }}>⚠️ Overpay</span>
                        : <span style={{ color: "#059669", fontWeight: 600 }}>✅ Valid</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )}

    {/* Results after confirm */}
    {payResults && (
      <div style={{ marginTop: "1rem", padding: "1.25rem", background: "#f0fdf4", border: "2px solid #86efac", borderRadius: 10 }}>
        <h4 style={{ color: "#166534", margin: "0 0 0.75rem" }}>✅ Payments Processed</h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.5rem", marginBottom: "1rem" }}>
          {[
            ["Processed", "#059669", payResults.successRows],
            ["Failed", "#dc2626", payResults.failedRows],
            ["Total Amount", "#1e40af", `₹${(payResults.totalAmountProcessed || 0).toLocaleString("en-IN")}`],
          ].map(([l, c, v]) => (
            <div key={l} style={{ textAlign: "center", padding: "0.5rem", borderRadius: 8, background: "white", border: `2px solid ${c}30` }}>
              <div style={{ fontSize: "1.25rem", fontWeight: 700, color: c }}>{v}</div>
              <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{l}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: "0.8rem", color: "#374151" }}>
          Interest cleared: ₹{(payResults.totalInterestCleared || 0).toLocaleString("en-IN")} · Principal cleared: ₹{(payResults.totalPrincipalCleared || 0).toLocaleString("en-IN")}
        </div>
        {payResults.results?.filter(r => r.status === "Failed").length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <h5 style={{ color: "#dc2626", margin: "0 0 0.5rem" }}>Failed rows:</h5>
            <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.8rem", color: "#7f1d1d" }}>
              {payResults.results.filter(r => r.status === "Failed").map((r, i) => (
                <li key={i}>{r.flat} ({r.memberName}): {r.errorMessage}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )}
  </div>
</div>
```

- [ ] **Step 5: Verify in browser**

Open generate-bills page and verify:
1. Flow 1 section visible with blue border
2. Flow 2 section visible with green border
3. Download bill gen template button present (disabled without member selection)
4. Upload bill gen template with validate button
5. Download payment template button present
6. Upload payment collection with validate + confirm buttons
7. Old mode toggle gone

- [ ] **Step 6: Commit**

```bash
git add app/admin/generate-bills/page.js
git commit -m "feat: restructure generate-bills into 4-section billing workflow (bill gen + payment collection)"
```

---

## Task 8: Verify Receipt Attachment in Next-Month PDFs

This is a verification task. Read the PDF download route and bill-renderer to confirm that when June PDF downloads, May's payment receipt is attached.

**Files:**
- Read: `app/api/bills/download/route.js`
- Read: `lib/bill-renderer.js` (lines 1–100)

- [ ] **Step 1: Read download route**

```bash
cat app/api/bills/download/route.js
```

Look for:
- Does it query `Receipt.findOne({ billId, ... })` for the bill being downloaded?
- Does it query `Receipt.findOne({ billPeriodId: prevPeriodId, memberId })` for the previous month?
- Does it compose a multi-page PDF or HTML output?

- [ ] **Step 2: Read bill-renderer**

```bash
cat lib/bill-renderer.js | head -150
```

Look for receipt attachment logic. If none exists:

- [ ] **Step 3: Add receipt lookup to download route**

If the download route does NOT attach prior receipt, add this to the bill download response:

In `app/api/bills/download/route.js`, after fetching the bill:

```js
// Fetch receipt for this bill (payment made for this period)
const thisReceipt = await Receipt.findOne({
  billId: bill._id,
  societyId: decoded.societyId,
  status: "Generated",
}).sort({ paidAt: -1 }).lean();

// Fetch prior month receipt (to attach as page 2 of next month's bill)
// Convention: the bill for month M may include a receipt from month M-1
const prevDate = new Date(bill.billYear, bill.billMonth - 2, 1); // M-1
const prevPeriodId = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
const priorReceipt = await Receipt.findOne({
  memberId: bill.memberId,
  societyId: decoded.societyId,
  billPeriodId: prevPeriodId,
  status: "Generated",
}).sort({ paidAt: -1 }).lean();
```

Then pass `priorReceipt` to the bill renderer so it can append a receipt section.

- [ ] **Step 4: Add receipt section to bill-renderer.js**

In `lib/bill-renderer.js`, after the main bill HTML, if `data.priorReceipt` exists, append:

```js
if (data.priorReceipt) {
  html += `
    <div style="page-break-before: always; padding: 40px; font-family: Arial, sans-serif;">
      <h2 style="color: #059669; border-bottom: 2px solid #059669; padding-bottom: 10px;">
        Payment Receipt — ${data.priorReceipt.billPeriodId}
      </h2>
      <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
        <tr><td style="padding: 8px; border: 1px solid #e5e7eb; color: #6b7280;">Receipt No.</td><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 600;">${data.priorReceipt.receiptNo}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #e5e7eb; color: #6b7280;">Period</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${data.priorReceipt.billPeriodId}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #e5e7eb; color: #6b7280;">Amount Paid</td><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 700; color: #059669;">₹${data.priorReceipt.amount?.toLocaleString("en-IN")}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #e5e7eb; color: #6b7280;">Payment Mode</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${data.priorReceipt.paymentMode}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #e5e7eb; color: #6b7280;">Date</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${new Date(data.priorReceipt.paidAt).toLocaleDateString("en-IN")}</td></tr>
      </table>
    </div>
  `;
}
```

- [ ] **Step 5: Commit**

```bash
git add app/api/bills/download/route.js lib/bill-renderer.js
git commit -m "feat: attach prior month payment receipt to next month bill PDF"
```

---

## Task 9: E2E Lifecycle Verification

Manual verification checklist. Do not mark complete until every item is tested against a real dev DB.

**Files:** None changed — this is a verification task.

- [ ] **Step 1: Select members**
  - Open generate-bills page
  - Search + filter members
  - Select 2–3 specific members
  - Verify count badge shows correct count

- [ ] **Step 2: Download Bill Generation Template**
  - Click "Download Bill Generation Template"
  - Open the XLSX
  - Verify: only selected members appear
  - Verify: PreviousBalance column is non-zero if member has outstanding bills
  - Verify: InterestDue is calculated on PRINCIPAL only (not total balance)
  - Verify: GrandTotal = PreviousBalance + InterestDue + [charge subtotal]

- [ ] **Step 3: Upload Bill Generation Template**
  - Upload the downloaded file unchanged (no edits)
  - Validate — should pass with 0 errors
  - Click "Generate Bills from Excel"
  - Verify: success message with bill count
  - Check DB: `db.bills.find({ billPeriodId: "YYYY-MM" })` — bills should exist

- [ ] **Step 4: Download Payment Collection Template**
  - Click "Download Payment Collection Template"
  - Open the XLSX
  - Verify: TotalBillDue, AlreadyPaid, RemainingDue pre-filled from generated bills
  - Verify: LastReceiptNo and LastPaymentDate populated if prior payments exist
  - Verify: BillStatus shows "Unpaid" (not "No Bill")

- [ ] **Step 5: Fill and upload payments**
  - Fill AmountPaid for 2 members (one full, one partial)
  - Set PaymentMethod = "Cash"
  - Set PaymentDate = today
  - Upload → Validate → review preview table
  - Confirm — verify success count

- [ ] **Step 6: Verify DB state**
  ```
  db.bills.find({ billPeriodId: "YYYY-MM" }) → check closingPrincipal, closingInterest set
  db.receipts.find({ billPeriodId: "YYYY-MM" }) → receipts exist with correct amounts
  db.transactions.find({ billPeriodId: "YYYY-MM" }) → transactions with paymentBreakdown
  ```

- [ ] **Step 7: Generate next month bills**
  - Switch billing period to next month
  - Select same members
  - Preview bills
  - Verify: openingPrincipal = prior month's closingPrincipal (not openingBalance)
  - Verify: interest calculated on principal only

- [ ] **Step 8: Download next month bill PDF**
  - Generate bills for next month
  - Download a bill PDF for a member who made a partial payment last month
  - Verify: PDF page 2 shows prior month receipt
  - Verify: receipt shows correct amount, date, receipt number

---

## Task 10: Cleanup and Dead Code Removal

- [ ] **Step 1: Remove the auto/excel mode toggle state variables**

After restructure in Task 7, these state vars are unused:
```js
const [genMode, setGenMode] = useState("auto");
const [excelStep, setExcelStep] = useState(1);
```

Remove them from the state block. Fix any remaining references.

- [ ] **Step 2: Verify no member payment buttons remain**

```bash
grep -n "pay\|Pay\|payment" app/member/my-bills/page.js | grep -i "button\|onClick"
```

Should return zero results (payment buttons already removed in prior session).

- [ ] **Step 3: Verify member pay API still returns 403**

```bash
curl -X POST http://localhost:3000/api/member/pay -H "Content-Type: application/json" -d '{}' 2>/dev/null | python -m json.tool
```

Should return `{ "error": "Online payment is not available..." }` with status 403.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: cleanup dead state vars and verify member payment disabled"
```

---

## Self-Review Against Spec

| Requirement | Task |
|-------------|------|
| Member selector with search/name/flat/wing | Task 3, 4 |
| Multi-select + select all + deselect all | Task 3, 4 |
| Selected count badge | Task 4 |
| Flow 1: Download Bill Generation Template (pre-filled) | Task 7 (Section 1A) |
| Flow 1: Upload + Validate + Generate Bills | Task 7 (Section 1B) |
| Flow 2: Download Payment Collection Template (post-bills) | Task 7 (Section 2A) |
| Flow 2: Upload + Validate + Confirm Payments | Task 7 (Section 2B) |
| Dynamic billing run config (due day, grace period, etc.) | Task 5 |
| Remove billing settings from society-config | Task 6 |
| Receipt attached to next-month PDF | Task 8 |
| No member self-payments anywhere | Verified in Task 10 |
| Interest on principal only (not total balance) | Fixed in prior session (generate-bills line 204, bill-renderer) |
| Full E2E lifecycle test | Task 9 |
| memberIds filter on template downloads | Task 2 |
| Receipts created on payment upload | Already done in upload-payments route |
| closingPrincipal/closingInterest set on bill update | Already done in upload-payments confirm |

---

## Known Gaps / Risks

1. **`/api/billing/import` route** — Task 7 Step 2B references this for "Generate Bills from Excel". Verify this route exists. If not, use `/api/billing/generate` (which accepts auto-mode bills). Read the existing validate-excel flow to confirm import endpoint name.

2. **`excelStep` state** — After Task 7, the `excelStep` state variable driving the old 3-step wizard becomes dead. Remove in Task 10.

3. **Society config page** — Read the actual file in Task 6 before editing. The fields may be inside a larger form component.

4. **PDF multi-page output** — The current renderer returns HTML. If there's no page-break support, the receipt "attachment" will just be a scrollable second section in the same HTML. This is acceptable for the MVP. True PDF multi-page requires puppeteer/pdfkit, which is out of scope.
