"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card, PageHeader, Button, Badge, Spinner, Toast, EmptyState,
  Modal, StatCard, tokens, grid,
} from "@/components/visitor/ui";

async function api(url, opts) {
  const res = await fetch(url, {
    credentials: "include",
    headers: opts && opts.body ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || "Request failed");
  return data;
}

const MODES = ["", "Cash", "Cheque", "Online", "UPI", "NEFT", "RTGS", "System"];
const DASH = "\u2014";
const money = (n) => `Rs ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (v) => {
  if (!v) return DASH;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? DASH : d.toLocaleDateString("en-IN");
};

const S = {
  filters: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 },
  fl: { display: "grid", gap: 4 },
  lbl: { fontSize: 11.5, color: tokens.sub, fontWeight: 600 },
  inp: { padding: "7px 10px", borderRadius: 8, border: `1px solid ${tokens.border}`, fontSize: 13 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "10px 8px", borderBottom: `2px solid ${tokens.border}`, color: tokens.sub, fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap" },
  td: { padding: "10px 8px", borderBottom: `1px solid ${tokens.border}`, verticalAlign: "top" },
  num: { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  center: { display: "flex", justifyContent: "center", padding: 48 },
  pager: { display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", marginTop: 14 },
  sub: { fontSize: 11.5, color: tokens.sub },
};

const EMPTY_FILTERS = { paymentMode: "", from: "", to: "", includeReversed: false };

export default function PaymentsReceivedPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), limit: "50" });
      if (filters.paymentMode) p.set("paymentMode", filters.paymentMode);
      if (filters.from) p.set("from", filters.from);
      if (filters.to) p.set("to", filters.to);
      if (filters.includeReversed) p.set("includeReversed", "1");
      setData(await api(`/api/admin/payments/received?${p.toString()}`));
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const list = (data && data.payments) || [];
    const term = q.trim().toLowerCase();
    if (!term) return list;
    return list.filter((r) =>
      [r.transactionId, r.description, r.notes, r.transactionRef, r.chequeNo,
        r.member && r.member.flatNo, r.member && r.member.ownerName]
        .filter(Boolean).join(" ").toLowerCase().includes(term),
    );
  }, [data, q]);

  const summary = (data && data.summary) || { count: 0, amount: 0, interest: 0, principal: 0, advance: 0 };

  async function saveEdit() {
    setSaving(true);
    try {
      await api(`/api/admin/payments/received/${edit._id}`, {
        method: "PATCH",
        body: JSON.stringify({
          paymentMode: edit.paymentMode || "",
          transactionRef: edit.transactionRef || "",
          chequeNo: edit.chequeNo || "",
          bankName: edit.bankName || "",
          upiId: edit.upiId || "",
          notes: edit.notes || "",
          date: edit.date,
        }),
      });
      setToast({ type: "success", message: "Payment updated" });
      setEdit(null);
      load();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function reverse(row) {
    const reason = window.prompt(
      `Reverse ${row.transactionId} (${money(row.amount)})?\n\nThe original stays in the ledger flagged as reversed and a mirror entry cancels it. Reason:`,
      "",
    );
    if (reason === null) return;
    try {
      const res = await api(`/api/admin/payments/received/${row._id}`, {
        method: "POST",
        body: JSON.stringify({ action: "reverse", reason }),
      });
      setToast({ type: "success", message: res.warning || "Payment reversed" });
      load();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    }
  }

  function exportCsv() {
    const head = ["Txn ID", "Date", "Flat", "Owner", "Amount", "Mode", "Interest", "Principal", "Advance", "Reversed", "Notes"];
    const lines = rows.map((r) => [
      r.transactionId, fmtDate(r.date),
      r.member ? `${r.member.wing || ""}${r.member.wing ? "-" : ""}${r.member.flatNo}` : "",
      r.member ? r.member.ownerName : "",
      r.amount, r.paymentMode || "",
      (r.breakdown && r.breakdown.interestCleared) || 0,
      (r.breakdown && r.breakdown.principalCleared) || 0,
      (r.breakdown && r.breakdown.advanceCredit) || 0,
      r.isReversed ? "YES" : "", (r.notes || "").replace(/"/g, "'"),
    ]);
    const csv = [head, ...lines].map((l) => l.map((c) => `"${c === undefined || c === null ? "" : c}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `payments-received-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        title="Payments Received"
        subtitle="Every payment credited to the society, with allocation breakdown, edit and reversal."
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" onClick={exportCsv}>Export CSV</Button>
            <Button variant="ghost" onClick={load}>Refresh</Button>
          </div>
        }
      />

      <div style={{ ...grid(190), marginBottom: 18 }}>
        <StatCard label="Payments" value={summary.count} color={tokens.primary} />
        <StatCard label="Total received" value={money(summary.amount)} color="#16a34a" />
        <StatCard label="Interest cleared" value={money(summary.interest)} color="#d97706" />
        <StatCard label="Principal cleared" value={money(summary.principal)} color="#2563eb" />
        <StatCard label="Advance credit" value={money(summary.advance)} color="#7c3aed" />
      </div>

      <Card>
        <div style={S.filters}>
          <div style={S.fl}>
            <span style={S.lbl}>From</span>
            <input type="date" style={S.inp} value={filters.from}
              onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, from: e.target.value })); }} />
          </div>
          <div style={S.fl}>
            <span style={S.lbl}>To</span>
            <input type="date" style={S.inp} value={filters.to}
              onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, to: e.target.value })); }} />
          </div>
          <div style={S.fl}>
            <span style={S.lbl}>Mode</span>
            <select style={S.inp} value={filters.paymentMode}
              onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, paymentMode: e.target.value })); }}>
              {MODES.map((m) => <option key={m} value={m}>{m || "All modes"}</option>)}
            </select>
          </div>
          <label style={{ ...S.lbl, display: "flex", gap: 6, alignItems: "center", paddingBottom: 8 }}>
            <input type="checkbox" checked={filters.includeReversed}
              onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, includeReversed: e.target.checked })); }} />
            Show reversed
          </label>
          <div style={S.fl}>
            <span style={S.lbl}>Search</span>
            <input style={{ ...S.inp, minWidth: 220 }} value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Txn id, flat, owner, ref..." />
          </div>
          <Button variant="ghost" onClick={() => { setQ(""); setPage(1); setFilters(EMPTY_FILTERS); }}>Clear</Button>
        </div>

        {loading ? (
          <div style={S.center}><Spinner /></div>
        ) : rows.length === 0 ? (
          <EmptyState title="No payments" subtitle="Nothing matches these filters." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Txn</th>
                  <th style={S.th}>Date</th>
                  <th style={S.th}>Flat / owner</th>
                  <th style={{ ...S.th, ...S.num }}>Amount</th>
                  <th style={S.th}>Mode</th>
                  <th style={S.th}>Allocation</th>
                  <th style={S.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const b = r.breakdown || {};
                  return (
                    <tr key={r._id} style={r.isReversed ? { opacity: 0.55 } : undefined}>
                      <td style={S.td}>
                        <div style={{ fontWeight: 700 }}>{r.transactionId}</div>
                        {r.isReversed && <Badge color="#991b1b">Reversed</Badge>}
                        {r.billPeriodId && <div style={S.sub}>{r.billPeriodId}</div>}
                      </td>
                      <td style={S.td}>{fmtDate(r.date)}</td>
                      <td style={S.td}>
                        <div style={{ fontWeight: 600 }}>
                          {r.member ? `${r.member.wing ? `${r.member.wing}-` : ""}${r.member.flatNo || DASH}` : DASH}
                        </div>
                        <div style={S.sub}>{r.member ? r.member.ownerName : ""}</div>
                      </td>
                      <td style={{ ...S.td, ...S.num, fontWeight: 800 }}>{money(r.amount)}</td>
                      <td style={S.td}>
                        <div>{r.paymentMode || DASH}</div>
                        {(r.transactionRef || r.chequeNo) && (
                          <div style={S.sub}>{r.chequeNo || r.transactionRef}</div>
                        )}
                      </td>
                      <td style={S.td}>
                        <div style={S.sub}>Interest {money(b.interestCleared)}</div>
                        <div style={S.sub}>Principal {money(b.principalCleared)}</div>
                        {b.advanceCredit ? <div style={{ ...S.sub, color: "#7c3aed", fontWeight: 700 }}>Advance {money(b.advanceCredit)}</div> : null}
                      </td>
                      <td style={S.td}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <Button size="sm" variant="ghost" disabled={r.isReversed}
                            onClick={() => setEdit({ ...r, date: r.date ? String(r.date).slice(0, 10) : "" })}>Edit</Button>
                          <Button size="sm" variant="ghost" disabled={r.isReversed} onClick={() => reverse(r)}>Reverse</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {data && data.pages > 1 && (
          <div style={S.pager}>
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span style={S.sub}>Page {data.page} of {data.pages}</span>
            <Button size="sm" variant="ghost" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(edit)}
        title={edit ? `Edit ${edit.transactionId}` : ""}
        onClose={() => setEdit(null)}
        width={520}
        footer={
          <div style={{ display: "flex", gap: 8 }}>
            <Button disabled={saving} onClick={saveEdit}>{saving ? "Saving..." : "Save changes"}</Button>
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
          </div>
        }
      >
        {edit && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ padding: 10, borderRadius: 8, background: "#f3f4f6", fontSize: 12.5, color: tokens.sub }}>
              Amount ({money(edit.amount)}) cannot be edited here - changing it would desynchronise
              bill allocation and receipts. Reverse this payment and record a corrected one instead.
            </div>
            <div style={S.fl}>
              <span style={S.lbl}>Value date</span>
              <input type="date" style={S.inp} value={edit.date || ""}
                onChange={(e) => setEdit((s) => ({ ...s, date: e.target.value }))} />
            </div>
            <div style={S.fl}>
              <span style={S.lbl}>Payment mode</span>
              <select style={S.inp} value={edit.paymentMode || ""}
                onChange={(e) => setEdit((s) => ({ ...s, paymentMode: e.target.value }))}>
                {MODES.filter(Boolean).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div style={S.fl}>
              <span style={S.lbl}>Reference / UTR</span>
              <input style={S.inp} value={edit.transactionRef || ""}
                onChange={(e) => setEdit((s) => ({ ...s, transactionRef: e.target.value }))} />
            </div>
            <div style={S.fl}>
              <span style={S.lbl}>Cheque no.</span>
              <input style={S.inp} value={edit.chequeNo || ""}
                onChange={(e) => setEdit((s) => ({ ...s, chequeNo: e.target.value }))} />
            </div>
            <div style={S.fl}>
              <span style={S.lbl}>Bank</span>
              <input style={S.inp} value={edit.bankName || ""}
                onChange={(e) => setEdit((s) => ({ ...s, bankName: e.target.value }))} />
            </div>
            <div style={S.fl}>
              <span style={S.lbl}>UPI id</span>
              <input style={S.inp} value={edit.upiId || ""}
                onChange={(e) => setEdit((s) => ({ ...s, upiId: e.target.value }))} />
            </div>
            <div style={S.fl}>
              <span style={S.lbl}>Notes</span>
              <textarea rows={3} style={S.inp} value={edit.notes || ""}
                onChange={(e) => setEdit((s) => ({ ...s, notes: e.target.value }))} />
            </div>
          </div>
        )}
      </Modal>

      {toast ? <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} /> : null}
    </div>
  );
}
