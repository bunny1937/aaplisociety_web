import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Phase 2.19 (docs/accounting-system-ARD.md §8): PDF export for Auditor Mode's
// history. Deliberately plain — a paginated text listing, not a styled
// template — reusing the pdf-lib dependency already used elsewhere
// (lib/pdf-generator.js) rather than adding a new PDF library for one report.

const PAGE_SIZE = [595.28, 841.89]; // A4
const MARGIN = 40;
const LINE_HEIGHT = 14;

function wrap(text, font, size, maxWidth) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function generateAuditTrailPdf(entries, { financialYearLabel } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const contentWidth = PAGE_SIZE[0] - MARGIN * 2;

  let page = pdf.addPage(PAGE_SIZE);
  let y = PAGE_SIZE[1] - MARGIN;

  const ensureSpace = (needed) => {
    if (y - needed < MARGIN) {
      page = pdf.addPage(PAGE_SIZE);
      y = PAGE_SIZE[1] - MARGIN;
    }
  };
  const drawLine = (text, { font: f = font, size = 10, color = rgb(0, 0, 0) } = {}) => {
    ensureSpace(LINE_HEIGHT);
    page.drawText(text, { x: MARGIN, y, size, font: f, color });
    y -= LINE_HEIGHT;
  };

  drawLine(`Auditor Mode — Adjustment History${financialYearLabel ? ` (${financialYearLabel})` : ""}`, { font: bold, size: 14 });
  y -= 6;

  if (entries.length === 0) {
    drawLine("No adjustments recorded.");
  }

  for (const e of entries) {
    ensureSpace(LINE_HEIGHT * 4);
    drawLine(`Adjustment Voucher: ${e.adjustmentVoucherNumber || e.adjustmentVoucherId} — Original Voucher: ${e.originalVoucherNumber || e.originalVoucherId}`, { font: bold });
    drawLine(`Date: ${new Date(e.adjustedAt).toISOString().slice(0, 10)}    By: ${e.adjustedByName || e.adjustedBy}`);
    for (const line of wrap(`Reason: ${e.reason}`, font, 10, contentWidth)) {
      drawLine(line);
    }
    y -= 6;
  }

  return pdf.save();
}
