import ExcelJS from "exceljs";
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  WidthType,
} from "docx";
import PDFDocument from "pdfkit";
import JSZip from "jszip";
import { createHash } from "node:crypto";

/**
 * Builds a retention export in memory.
 *
 * ## Called at DOWNLOAD time, not on a schedule
 *
 * Nothing here runs unless a logged-in admin has actually pressed a button.
 * The output is streamed straight to their browser and then discarded — it is
 * never uploaded to R2 or written to disk. See the comment block in
 * models/RetentionArchive.js for why the pre-build-and-store design was
 * dropped.
 *
 * `only` lets a single-format request skip the other four builders entirely,
 * so "just give me the Excel" costs a fraction of the full zip.
 */

// Above this, a single bundle stops being useful (Excel itself struggles) and
// the memory cost on a serverless instance gets risky. The scan caps archives
// at 25k ids for the same reason.
export const MAX_ROWS_PER_BUNDLE = 50000;

function cell(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function toRows(docs, columns) {
  const cols =
    columns?.length ? columns : [...new Set(docs.flatMap((d) => Object.keys(d)))];
  return {
    cols,
    rows: docs.map((d) => cols.map((c) => cell(d[c]))),
  };
}

function buildCsv(cols, rows) {
  const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [cols.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

async function buildXlsx(cols, rows, sheetName) {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  ws.addRow(cols);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  rows.forEach((r) => ws.addRow(r));
  ws.columns.forEach((c, i) => {
    const longest = Math.max(
      cols[i]?.length ?? 10,
      ...rows.slice(0, 200).map((r) => (r[i] ?? "").length),
    );
    c.width = Math.min(60, Math.max(10, longest + 2));
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function buildDocx(cols, rows, title, subtitle) {
  // Word tables past a few thousand rows produce a file no one can open.
  const LIMIT = 1000;
  const shown = rows.slice(0, LIMIT);
  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ text: subtitle }),
    new Paragraph({ text: "" }),
  ];
  if (rows.length > LIMIT) {
    children.push(
      new Paragraph({
        text: `Showing the first ${LIMIT} of ${rows.length} records. The Excel, CSV and JSON files in this bundle contain all ${rows.length}.`,
      }),
      new Paragraph({ text: "" }),
    );
  }
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: cols.map(
            (c) => new TableCell({ children: [new Paragraph({ text: c, bold: true })] }),
          ),
        }),
        ...shown.map(
          (r) =>
            new TableRow({
              children: r.map(
                (v) =>
                  new TableCell({
                    children: [new Paragraph({ text: v.slice(0, 300) })],
                  }),
              ),
            }),
        ),
      ],
    }),
  );
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

function buildPdf(cols, rows, title, subtitle) {
  return new Promise((resolve, reject) => {
    const LIMIT = 2000;
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 30 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text(title);
    doc.fontSize(9).fillColor("#666").text(subtitle);
    if (rows.length > LIMIT) {
      doc.text(
        `Showing the first ${LIMIT} of ${rows.length} records. The Excel, CSV and JSON files contain all ${rows.length}.`,
      );
    }
    doc.moveDown(0.5).fillColor("#000");

    const usable = doc.page.width - 60;
    const colWidth = usable / cols.length;
    const line = (values, bold) => {
      if (doc.y > doc.page.height - 40) doc.addPage();
      const y = doc.y;
      doc.fontSize(7).font(bold ? "Helvetica-Bold" : "Helvetica");
      values.forEach((v, i) => {
        doc.text(String(v).slice(0, 60), 30 + i * colWidth, y, {
          width: colWidth - 4,
          ellipsis: true,
          lineBreak: false,
        });
      });
      doc.y = y + 11;
    };

    line(cols, true);
    rows.slice(0, LIMIT).forEach((r) => line(r, false));
    doc.end();
  });
}

/**
 * @param only - null for the full zip, or one of
 *               "xlsx" | "csv" | "json" | "docx" | "pdf" to build just that.
 * @returns { buffer, sha256, filename, formats }
 */
export async function buildRetentionBundle({
  policy,
  societyName,
  runDate,
  cutoff,
  docs,
  only = null,
}) {
  const capped = docs.slice(0, MAX_ROWS_PER_BUNDLE);
  const { cols, rows } = toRows(capped, policy.columns);

  const safeSociety = String(societyName).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const base = `${safeSociety}-${policy.id}-${runDate}`;
  const title = `${societyName} — ${policy.label}`;
  const subtitle = `Archive ${runDate} · ${capped.length.toLocaleString("en-IN")} records · all dated before ${new Date(cutoff).toLocaleDateString("en-IN")}`;

  const sha = (buf) => createHash("sha256").update(buf).digest("hex");

  // Single-format path: build exactly one thing.
  if (only) {
    let buffer;
    if (only === "json") buffer = Buffer.from(JSON.stringify(capped, null, 2), "utf8");
    else if (only === "csv") buffer = Buffer.from(buildCsv(cols, rows), "utf8");
    else if (only === "xlsx") buffer = await buildXlsx(cols, rows, policy.label);
    else if (only === "docx") buffer = await buildDocx(cols, rows, title, subtitle);
    else if (only === "pdf") buffer = await buildPdf(cols, rows, title, subtitle);
    else throw new Error(`Unsupported format: ${only}`);
    return {
      buffer,
      sha256: sha(buffer),
      filename: `${base}.zip`, // caller rewrites the extension
      formats: [only],
    };
  }

  const [xlsx, docx, pdf] = await Promise.all([
    buildXlsx(cols, rows, policy.label),
    buildDocx(cols, rows, title, subtitle),
    buildPdf(cols, rows, title, subtitle),
  ]);

  const zip = new JSZip();
  zip.file(`${base}.json`, JSON.stringify(capped, null, 2));
  zip.file(`${base}.csv`, buildCsv(cols, rows));
  zip.file(`${base}.xlsx`, xlsx);
  zip.file(`${base}.docx`, docx);
  zip.file(`${base}.pdf`, pdf);
  zip.file(
    "README.txt",
    [
      title,
      subtitle,
      "",
      `Policy: ${policy.id}`,
      `Records: ${capped.length}${docs.length > capped.length ? ` (capped from ${docs.length})` : ""}`,
      `Generated: ${new Date().toISOString()}`,
      "",
      policy.purgeable
        ? "These records may be deleted from the live system after this download,"
        : "These records are NOT deleted from the live system — this is a convenience copy.",
      policy.purgeable ? "if your society has enabled automatic deletion. Keep this file." : "",
      "",
      "The .xlsx, .csv and .json files contain every record.",
      "The .docx and .pdf are readable summaries and may be truncated for large archives.",
      policy.redact?.length
        ? `\nOmitted fields (large or sensitive): ${policy.redact.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return {
    buffer,
    sha256: sha(buffer),
    filename: `${base}.zip`,
    formats: ["json", "csv", "xlsx", "docx", "pdf"],
  };
}
