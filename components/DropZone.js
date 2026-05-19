"use client";

import { useRef, useState } from "react";
import { Upload, FileSpreadsheet, X } from "lucide-react";

export default function DropZone({
  accept = ".xlsx,.xls",
  onFile,
  file,
  onClear,
  label = "Click or drag & drop Excel file here",
  hint = ".xlsx or .xls — max 5MB",
  icon,
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

  const baseStyle = {
    border: `2px dashed ${
      dragOver ? "#6b8eef" : file ? "#10b981" : "#cbd5e1"
    }`,
    borderRadius: 14,
    padding: "28px 32px",
    textAlign: "center",
    background: dragOver
      ? "rgba(107, 142, 239, 0.06)"
      : file
        ? "rgba(16, 185, 129, 0.05)"
        : "#f4faff",
    cursor: file ? "default" : "pointer",
    transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
    boxShadow: dragOver
      ? "0 0 0 4px rgba(107, 142, 239, 0.15)"
      : "none",
    transform: dragOver ? "scale(1.01)" : "scale(1)",
    ...style,
  };

  return (
    <div
      style={baseStyle}
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
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: "rgba(16, 185, 129, 0.1)",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <FileSpreadsheet size={24} color="#059669" />
          </div>
          <div style={{ fontWeight: 700, color: "#065f46", fontSize: 14 }}>
            {file.name}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            {(file.size / 1024).toFixed(1)} KB
          </div>
          {onClear && (
            <button
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              style={{
                marginTop: 4,
                padding: "5px 14px",
                fontSize: 12,
                fontWeight: 600,
                background: "transparent",
                border: "1.5px solid #d1d5db",
                borderRadius: 8,
                cursor: "pointer",
                color: "#6b7280",
                display: "flex",
                alignItems: "center",
                gap: 5,
                transition: "all 0.15s",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = "#ef4444";
                e.currentTarget.style.color = "#ef4444";
                e.currentTarget.style.background = "#fee2e2";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = "#d1d5db";
                e.currentTarget.style.color = "#6b7280";
                e.currentTarget.style.background = "transparent";
              }}
            >
              <X size={12} /> Remove
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: dragOver ? "rgba(107, 142, 239, 0.15)" : "rgba(30, 58, 138, 0.07)",
            border: "1px solid rgba(30, 58, 138, 0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.2s",
          }}>
            <Upload size={22} color={dragOver ? "#6b8eef" : "#1e3a8a"} />
          </div>
          <div style={{ fontWeight: 600, color: "#1e3a8a", fontSize: 14 }}>{label}</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>{hint}</div>
        </div>
      )}
    </div>
  );
}
