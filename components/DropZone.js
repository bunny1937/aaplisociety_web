"use client";

import { useRef, useState } from "react";

/**
 * Drag-and-drop file input zone.
 *
 * Props:
 *   accept     — string passed to <input accept>, e.g. ".xlsx,.xls"
 *   onFile     — (File) => void  called when a file is picked or dropped
 *   file       — File | null     currently selected file (controlled)
 *   onClear    — () => void      called when user clicks ✕ to remove file
 *   label      — string          label shown when empty (default "Click or drag & drop Excel file here")
 *   hint       — string          sub-hint (default ".xlsx or .xls — max 5MB")
 *   icon       — string          emoji icon (default "📂")
 *   style      — object          extra styles for the outer div
 */
export default function DropZone({
  accept = ".xlsx,.xls",
  onFile,
  file,
  onClear,
  label = "Click or drag & drop Excel file here",
  hint = ".xlsx or .xls — max 5MB",
  icon = "📂",
  style = {},
}) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onFile(dropped);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOver(false);
    }
  };

  const handleInputChange = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      onFile(f);
      e.target.value = "";
    }
  };

  const base = {
    border: `2px dashed ${dragOver ? "#6366f1" : file ? "#10b981" : "#d1d5db"}`,
    borderRadius: 10,
    padding: "1.75rem 2rem",
    textAlign: "center",
    background: dragOver ? "#eef2ff" : file ? "#f0fdf4" : "#fafafa",
    cursor: "pointer",
    transition: "border-color 0.15s, background 0.15s",
    ...style,
  };

  return (
    <div
      style={base}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => !file && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={handleInputChange}
      />

      {file ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
          }}
        >
          <div style={{ fontSize: "1.8rem" }}>📄</div>
          <div
            style={{ fontWeight: 600, color: "#065f46", fontSize: "0.95rem" }}
          >
            {file.name}
          </div>
          <div style={{ fontSize: "0.78rem", color: "#6b7280" }}>
            {(file.size / 1024).toFixed(1)} KB
          </div>
          {onClear && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              style={{
                marginTop: 4,
                padding: "2px 12px",
                fontSize: "0.75rem",
                background: "transparent",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                cursor: "pointer",
                color: "#6b7280",
              }}
            >
              ✕ Remove
            </button>
          )}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
          }}
        >
          <div style={{ fontSize: "2rem" }}>{icon}</div>
          <div
            style={{ fontWeight: 600, color: "#374151", fontSize: "0.9rem" }}
          >
            {label}
          </div>
          <div style={{ fontSize: "0.78rem", color: "#9ca3af" }}>{hint}</div>
        </div>
      )}
    </div>
  );
}
