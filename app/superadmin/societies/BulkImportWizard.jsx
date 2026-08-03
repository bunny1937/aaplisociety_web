"use client";

// app/superadmin/societies/BulkImportWizard.jsx
//
// Native 6-sheet society import. Replaces the download-template /
// fill-in-Excel / upload / read-errors / re-upload loop entirely.
//
// Network budget for a whole import session:
//   1x GET  /api/admin/bulk-import/schema?probe=1   on open
//   1x POST /api/admin/bulk-import                  on submit, only when clean
//
// That is it. Every keystroke is validated locally by lib/import/
// validateWorkbook.js - the same module the server re-runs on submit, so the
// browser cannot show a green state the server would reject.
//
// Keyboard model matches the collections grid so the two screens feel like one
// product: Enter / arrows move, Tab moves, Cmd+Enter submits.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import {
  Building2,
  Users,
  IdCard,
  Car,
  Heart,
  History,
  KeyRound,
  Plus,
  Trash2,
  ClipboardPaste,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  X,
  ArrowRight,
} from "lucide-react";
import {
  validateWorkbook,
  collectWarnings,
  validateCell,
  isBlankRow,
} from "@/lib/import/validateWorkbook";
import styles from "@/styles/BulkImportWizard.module.css";

const ICONS = {
  building: Building2,
  users: Users,
  idcard: IdCard,
  car: Car,
  family: Heart,
  history: History,
  key: KeyRound,
};

function emptyRow(sheet) {
  const r = {};
  for (const c of sheet.columns) r[c.key] = "";
  return r;
}

/** Parse clipboard TSV into rows aligned to the sheet's columns. */
function parseClipboard(text, sheet, startColIdx) {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.length);
  return lines.map((line) => {
    const cells = line.split("\t");
    const row = emptyRow(sheet);
    cells.forEach((cell, i) => {
      const col = sheet.columns[startColIdx + i];
      if (col) row[col.key] = cell.trim();
    });
    return row;
  });
}

export default function BulkImportWizard({ open, onClose, onImported }) {
  const [schema, setSchema] = useState(null);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [schemaError, setSchemaError] = useState(null);
  const [takenEmails, setTakenEmails] = useState(() => new Set());

  const [activeSheet, setActiveSheet] = useState("society");
  const [data, setData] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverResult, setServerResult] = useState(null);
  const [focused, setFocused] = useState({ row: 0, col: 0 });

  const shellRef = useRef(null);
  const scrimRef = useRef(null);
  const cellRefs = useRef(new Map()); // "sheetId:row:colKey" -> input el

  // ── Schema: fetched once per mount ─────────────────────────────────────
  useEffect(() => {
    if (!open || schema || loadingSchema) return;
    setLoadingSchema(true);
    setSchemaError(null);

    fetch("/api/admin/bulk-import/schema?probe=1", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((payload) => {
        setSchema(payload);
        setTakenEmails(new Set(payload.probe?.takenEmails || []));
        // Seed one blank row per sheet so the grid is immediately usable.
        const seeded = {};
        for (const s of payload.sheets) {
          seeded[s.id] = s.mode === "single" ? [emptyRow(s)] : [emptyRow(s)];
        }
        setData(seeded);
      })
      .catch((e) => setSchemaError(e.message))
      .finally(() => setLoadingSchema(false));
  }, [open, schema, loadingSchema]);

  // ── Entrance morph ───────────────────────────────────────────────────
  // transform + opacity only. Animating width/height here would reflow a grid
  // that can hold a few hundred rows, on every frame.
  useEffect(() => {
    if (!open || !shellRef.current) return;
    const shell = shellRef.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      gsap.set(shell, { opacity: 1, scale: 1, y: 0 });
      return;
    }
    const tl = gsap.timeline();
    gsap.set(scrimRef.current, { opacity: 0 });
    gsap.set(shell, { opacity: 0, scaleX: 0.86, scaleY: 0.6, y: 28 });
    tl.to(scrimRef.current, { opacity: 1, duration: 0.18, ease: "none" }, 0)
      .to(shell, { opacity: 1, duration: 0.14, ease: "none" }, 0)
      .to(shell, { scaleX: 1, duration: 0.42, ease: "power3.out" }, 0)
      .to(shell, { scaleY: 1, y: 0, duration: 0.5, ease: "back.out(1.2)" }, 0.12)
      .to(
        shell.querySelectorAll("[data-stagger]"),
        { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", stagger: { amount: 0.2 } },
        0.3,
      )
      .set(shell, { clearProps: "transform" });
    return () => tl.kill();
  }, [open, schema]);

  // ── Validation: recomputed locally, never on the server ─────────────────────
  const verdict = useMemo(() => {
    if (!schema) return { ok: false, cellErrors: {}, sheetErrors: {}, counts: {}, totalErrors: 0 };
    return validateWorkbook(data);
  }, [schema, data]);

  const warnings = useMemo(
    () => (schema ? collectWarnings(data) : []),
    [schema, data],
  );

  // Advisory email check layered on top - not part of validateWorkbook because
  // it depends on server state the isomorphic validator must not know about.
  const emailAdvisories = useMemo(() => {
    if (!schema) return {};
    const out = {};
    (data.basicInfo || []).forEach((row, i) => {
      const e = String(row["emailPrimary*"] || "").trim().toLowerCase();
      if (e && takenEmails.has(e)) {
        out[i] = `${e} is already registered on the platform. The import will be rejected.`;
      }
    });
    const adminEmail = String((data.society || [])[0]?.["Admin Email"] || "")
      .trim()
      .toLowerCase();
    if (adminEmail && takenEmails.has(adminEmail)) out.admin = `${adminEmail} is already registered.`;
    return out;
  }, [schema, data, takenEmails]);

  const blockedByAdvisory = Object.keys(emailAdvisories).length > 0;
  const canSubmit = verdict.ok && !blockedByAdvisory && !submitting;

  // ── Editing ──────────────────────────────────────────────────────────
  const setCell = useCallback((sheetId, rowIdx, colKey, value) => {
    setData((prev) => {
      const rows = [...(prev[sheetId] || [])];
      rows[rowIdx] = { ...rows[rowIdx], [colKey]: value };
      return { ...prev, [sheetId]: rows };
    });
  }, []);

  const addRow = useCallback(
    (sheet, count = 1) => {
      setData((prev) => ({
        ...prev,
        [sheet.id]: [
          ...(prev[sheet.id] || []),
          ...Array.from({ length: count }, () => emptyRow(sheet)),
        ],
      }));
    },
    [],
  );

  const removeRow = useCallback((sheetId, rowIdx) => {
    setData((prev) => {
      const rows = (prev[sheetId] || []).filter((_, i) => i !== rowIdx);
      return { ...prev, [sheetId]: rows.length ? rows : prev[sheetId] };
    });
  }, []);

  // ── Keyboard grid navigation ───────────────────────────────────────────
  const focusCell = useCallback((sheetId, rowIdx, colIdx, sheet) => {
    const col = sheet.columns[colIdx];
    if (!col) return;
    const el = cellRefs.current.get(`${sheetId}:${rowIdx}:${col.key}`);
    if (el) {
      el.focus();
      if (el.select) el.select();
      setFocused({ row: rowIdx, col: colIdx });
    }
  }, []);

  const onCellKeyDown = useCallback(
    (e, sheet, rowIdx, colIdx) => {
      const rows = data[sheet.id] || [];
      const lastCol = sheet.columns.length - 1;
      const el = e.target;
      const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
      const atEnd =
        el.selectionStart === (el.value?.length ?? 0) &&
        el.selectionEnd === (el.value?.length ?? 0);

      const go = (r, c) => {
        e.preventDefault();
        focusCell(sheet.id, r, c, sheet);
      };

      switch (e.key) {
        case "Enter":
          if (e.metaKey || e.ctrlKey) return; // reserved for submit
          e.preventDefault();
          if (rowIdx === rows.length - 1) {
            // Enter on the final row grows the sheet, like Excel.
            addRow(sheet, 1);
            requestAnimationFrame(() => focusCell(sheet.id, rowIdx + 1, colIdx, sheet));
          } else {
            focusCell(sheet.id, rowIdx + 1, colIdx, sheet);
          }
          break;
        case "ArrowDown":
          if (rowIdx < rows.length - 1) go(rowIdx + 1, colIdx);
          break;
        case "ArrowUp":
          if (rowIdx > 0) go(rowIdx - 1, colIdx);
          break;
        case "ArrowRight":
          // Only leave the cell when the caret is already at the end, so
          // arrowing through text still works.
          if (atEnd && colIdx < lastCol) go(rowIdx, colIdx + 1);
          break;
        case "ArrowLeft":
          if (atStart && colIdx > 0) go(rowIdx, colIdx - 1);
          break;
        case "Backspace":
          if (
            (e.metaKey || e.ctrlKey) &&
            rows.length > 1 &&
            isBlankRow(rows[rowIdx], sheet.columns)
          ) {
            e.preventDefault();
            removeRow(sheet.id, rowIdx);
          }
          break;
        default:
          break;
      }
    },
    [data, addRow, removeRow, focusCell],
  );

  const onPaste = useCallback(
    (e, sheet, rowIdx, colIdx) => {
      const text = e.clipboardData?.getData("text/plain") || "";
      if (!text.includes("\t") && !text.includes("\n")) return; // single cell
      e.preventDefault();
      const pasted = parseClipboard(text, sheet, colIdx);
      setData((prev) => {
        const rows = [...(prev[sheet.id] || [])];
        pasted.forEach((pRow, i) => {
          const target = rowIdx + i;
          const base = rows[target] ? { ...rows[target] } : emptyRow(sheet);
          for (const c of sheet.columns) {
            if (pRow[c.key] !== "") base[c.key] = pRow[c.key];
          }
          rows[target] = base;
        });
        return { ...prev, [sheet.id]: rows };
      });
    },
    [],
  );

  // ── Submit: the one and only POST ──────────────────────────────────────
  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setServerResult(null);

    // Strip blank rows before sending. The grid keeps trailing blanks for
    // usability; the server should never see them.
    const cleaned = {};
    for (const sheet of schema.sheets) {
      cleaned[sheet.id] = (data[sheet.id] || []).filter(
        (r) => !isBlankRow(r, sheet.columns),
      );
    }

    try {
      const res = await fetch("/api/admin/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          schemaVersion: schema.schemaVersion,
          data: cleaned,
        }),
      });
      const json = await res.json();
      setServerResult({ ok: res.ok, ...json });
      if (res.ok && json.success) onImported?.(json);
    } catch (err) {
      setServerResult({ ok: false, error: err.message });
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, schema, data, onImported]);

  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submit();
      }
      if (e.key === "Escape" && !submitting) onClose?.();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, submit, submitting, onClose]);

  if (!open) return null;

  // ── Render ──────────────────────────────────────────────────────────
  const sheet = schema?.sheets.find((s) => s.id === activeSheet);
  const rows = data[activeSheet] || [];
  const sheetCellErrors = verdict.cellErrors[activeSheet] || {};

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div ref={scrimRef} className={styles.scrim} onClick={() => !submitting && onClose?.()} />

      <div ref={shellRef} className={styles.shell}>
        {/* Header */}
        <header className={styles.header} data-stagger>
          <div>
            <h2 className={styles.title}>Import a society</h2>
            <p className={styles.subtitle}>
              Six sheets, one submission. Everything is checked here in the
              browser — nothing is sent until all of it is valid.
            </p>
          </div>
          <button className={styles.iconBtn} onClick={onClose} disabled={submitting} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {loadingSchema && (
          <div className={styles.centerState}>
            <Loader2 className={styles.spin} size={22} />
            <p>Loading the import schema…</p>
          </div>
        )}

        {schemaError && (
          <div className={styles.centerState}>
            <AlertTriangle size={22} className={styles.errIcon} />
            <p>Could not load the schema: {schemaError}</p>
          </div>
        )}

        {schema && !serverResult?.success && (
          <>
            {/* Sheet tabs */}
            <nav className={styles.tabs} data-stagger>
              {schema.sheets.map((s) => {
                const Icon = ICONS[s.icon] || Users;
                const c = verdict.counts[s.id] || { rows: 0, errors: 0 };
                const isActive = s.id === activeSheet;
                return (
                  <button
                    key={s.id}
                    className={`${styles.tab} ${isActive ? styles.tabActive : ""} ${
                      c.errors ? styles.tabError : ""
                    }`}
                    onClick={() => setActiveSheet(s.id)}
                  >
                    <Icon size={15} />
                    <span className={styles.tabLabel}>{s.title}</span>
                    {c.errors > 0 ? (
                      <span className={styles.badgeErr}>{c.errors}</span>
                    ) : c.rows > 0 ? (
                      <span className={styles.badgeOk}>{c.rows}</span>
                    ) : null}
                  </button>
                );
              })}
            </nav>

            {/* Sheet body */}
            <div className={styles.body} data-stagger>
              <div className={styles.sheetHead}>
                <div>
                  <h3 className={styles.sheetTitle}>{sheet.title}</h3>
                  <p className={styles.sheetSub}>{sheet.subtitle}</p>
                </div>
                {sheet.mode === "grid" && (
                  <div className={styles.sheetActions}>
                    <span className={styles.hint}>
                      <ClipboardPaste size={13} /> paste a block from Excel to fill many rows
                    </span>
                    <button className={styles.ghostBtn} onClick={() => addRow(sheet, 1)}>
                      <Plus size={14} /> Row
                    </button>
                    <button className={styles.ghostBtn} onClick={() => addRow(sheet, 10)}>
                      <Plus size={14} /> 10 rows
                    </button>
                  </div>
                )}
              </div>

              {(verdict.sheetErrors[activeSheet] || []).map((m, i) => (
                <div key={i} className={styles.sheetErrorBar}>
                  <AlertTriangle size={14} /> {m}
                </div>
              ))}

              {/* Society = form, everything else = grid */}
              {sheet.mode === "single" ? (
                <div className={styles.form}>
                  {sheet.columns.map((col) => {
                    const value = rows[0]?.[col.key] ?? "";
                    const error = sheetCellErrors[0]?.[col.key];
                    const advisory = col.key === "Admin Email" ? emailAdvisories.admin : null;
                    return (
                      <label
                        key={col.key}
                        className={`${styles.field} ${error || advisory ? styles.fieldErr : ""}`}
                      >
                        <span className={styles.fieldLabel}>
                          {col.label}
                          {col.required && <em className={styles.req}>*</em>}
                        </span>
                        {col.type === "select" ? (
                          <select
                            value={value}
                            onChange={(e) => setCell(sheet.id, 0, col.key, e.target.value)}
                          >
                            <option value="">—</option>
                            {(schema.enums[col.options] || []).map((o) => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={col.type === "date" ? "date" : "text"}
                            inputMode={
                              ["number", "money", "area", "phone"].includes(col.type)
                                ? "decimal"
                                : undefined
                            }
                            value={value}
                            placeholder={col.help || ""}
                            onChange={(e) => setCell(sheet.id, 0, col.key, e.target.value)}
                          />
                        )}
                        {(error || advisory) && (
                          <span className={styles.fieldMsg}>{advisory || error}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.thIndex}>#</th>
                        {sheet.columns.map((col) => (
                          <th
                            key={col.key}
                            style={{ width: col.width }}
                            title={col.help || ""}
                          >
                            {col.label}
                            {col.required && <em className={styles.req}>*</em>}
                          </th>
                        ))}
                        <th className={styles.thDel} />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, rIdx) => {
                        const rowErrs = sheetCellErrors[rIdx] || {};
                        const advisory =
                          activeSheet === "basicInfo" ? emailAdvisories[rIdx] : null;
                        const blank = isBlankRow(row, sheet.columns);
                        const bad = Object.keys(rowErrs).length > 0 || advisory;
                        return (
                          <tr
                            key={rIdx}
                            className={`${bad ? styles.rowErr : ""} ${
                              blank ? styles.rowBlank : ""
                            }`}
                          >
                            <td className={styles.tdIndex}>{rIdx + 1}</td>
                            {sheet.columns.map((col, cIdx) => {
                              const err = rowErrs[col.key];
                              const val = row[col.key] ?? "";
                              return (
                                <td
                                  key={col.key}
                                  className={err ? styles.cellErr : ""}
                                  title={err || ""}
                                >
                                  {col.type === "select" ? (
                                    <select
                                      ref={(el) => {
                                        const k = `${sheet.id}:${rIdx}:${col.key}`;
                                        el ? cellRefs.current.set(k, el) : cellRefs.current.delete(k);
                                      }}
                                      value={val}
                                      onChange={(e) => setCell(sheet.id, rIdx, col.key, e.target.value)}
                                      onKeyDown={(e) => onCellKeyDown(e, sheet, rIdx, cIdx)}
                                    >
                                      <option value="">—</option>
                                      {(schema.enums[col.options] || []).map((o) => (
                                        <option key={o} value={o}>{o}</option>
                                      ))}
                                    </select>
                                  ) : (
                                    <input
                                      ref={(el) => {
                                        const k = `${sheet.id}:${rIdx}:${col.key}`;
                                        el ? cellRefs.current.set(k, el) : cellRefs.current.delete(k);
                                      }}
                                      type="text"
                                      value={val}
                                      onChange={(e) => setCell(sheet.id, rIdx, col.key, e.target.value)}
                                      onKeyDown={(e) => onCellKeyDown(e, sheet, rIdx, cIdx)}
                                      onPaste={(e) => onPaste(e, sheet, rIdx, cIdx)}
                                    />
                                  )}
                                </td>
                              );
                            })}
                            <td className={styles.tdDel}>
                              {rows.length > 1 && (
                                <button
                                  className={styles.delBtn}
                                  onClick={() => removeRow(sheet.id, rIdx)}
                                  aria-label={`Delete row ${rIdx + 1}`}
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Footer */}
            <footer className={styles.footer} data-stagger>
              <div className={styles.status}>
                {verdict.totalErrors > 0 ? (
                  <span className={styles.statusErr}>
                    <AlertTriangle size={15} />
                    {verdict.totalErrors} problem{verdict.totalErrors === 1 ? "" : "s"} to fix
                  </span>
                ) : blockedByAdvisory ? (
                  <span className={styles.statusErr}>
                    <AlertTriangle size={15} />
                    An email is already registered
                  </span>
                ) : (
                  <span className={styles.statusOk}>
                    <CheckCircle2 size={15} />
                    All {verdict.counts.basicInfo?.rows || 0} flats valid — ready to import
                  </span>
                )}

                {warnings.length > 0 && (
                  <details className={styles.warnBox}>
                    <summary>{warnings.length} note{warnings.length === 1 ? "" : "s"}</summary>
                    <ul>
                      {warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>

              <button
                className={styles.submitBtn}
                disabled={!canSubmit}
                onClick={submit}
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className={styles.spin} /> Importing…
                  </>
                ) : (
                  <>
                    Import society <ArrowRight size={16} />
                  </>
                )}
              </button>
            </footer>
          </>
        )}

        {/* Server rejection */}
        {serverResult && !serverResult.success && (
          <div className={styles.serverErr}>
            <AlertTriangle size={16} />
            <div>
              <strong>The server rejected this import.</strong>
              {serverResult.serverRejectedClientValidated && (
                <p className={styles.mismatch}>
                  This should not happen — the browser and server ran the same
                  rules. Reload the page; the import format was probably updated
                  mid-session.
                </p>
              )}
              <ul>
                {(serverResult.errors || [serverResult.error || "Unknown error"])
                  .slice(0, 12)
                  .map((e, i) => (
                    <li key={i}>{typeof e === "string" ? e : e.label}</li>
                  ))}
              </ul>
            </div>
          </div>
        )}

        {/* Success */}
        {serverResult?.success && (
          <div className={styles.centerState}>
            <CheckCircle2 size={30} className={styles.okIcon} />
            <h3>Society imported</h3>
            <p>
              {serverResult.memberCount ?? 0} flats created.{" "}
              {serverResult.emailsQueued ?? 0} onboarding email
              {serverResult.emailsQueued === 1 ? "" : "s"} queued.
            </p>
            <p className={styles.smallNote}>
              Owners holding several flats receive one email that activates all
              of their flats.
            </p>
            <button className={styles.submitBtn} onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
