import { PDFDocument as PDFLibDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "fs";
import { PDF_FIELD_POSITIONS, TABLE_CONFIG } from "./pdf-fields-config";
export class FlexiblePDFGenerator {
  constructor(templatePath) {
    this.templatePath = templatePath;
  }
  async generateBill(billData) {
    try {
      // Read existing PDF template
      const templateBuffer = fs.readFileSync(this.templatePath);
      const pdfDoc = await PDFLibDocument.load(templateBuffer);
      const form = pdfDoc.getForm();
      const fields = form.getFields();
      if (fields.length > 0 && billData.formFieldData) {
        this._fillFormFields(form, billData.formFieldData);
        form.flatten();
        return await pdfDoc.save();
      }
      // Get first page
      const pages = pdfDoc.getPages();
      const firstPage = pages[0];
      const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      // Add text fields
      this._addTextField(
        firstPage,
        "companyName",
        billData.companyName,
        fontRegular,
        fontBold,
      );
      this._addTextField(
        firstPage,
        "invoiceNumber",
        billData.invoiceNumber,
        fontRegular,
        fontBold,
      );
      this._addTextField(
        firstPage,
        "customerName",
        billData.customerName,
        fontRegular,
        fontBold,
      );
      this._addTextField(
        firstPage,
        "customerAddress",
        billData.customerAddress,
        fontRegular,
        fontBold,
      );
      this._addTextField(
        firstPage,
        "customerPhone",
        billData.customerPhone,
        fontRegular,
        fontBold,
      );
      this._addTextField(
        firstPage,
        "billDate",
        billData.billDate,
        fontRegular,
        fontBold,
      );
      this._addTextField(
        firstPage,
        "dueDate",
        billData.dueDate,
        fontRegular,
        fontBold,
      );
      // Add table
      if (billData.items && billData.items.length > 0) {
        this._addTable(firstPage, billData.items, fontRegular, fontBold);
      }
      // Add amounts
      this._addTextField(
        firstPage,
        "subtotal",
        `₹ ${billData.subtotal}`,
        fontRegular,
        fontBold,
      );
      this._addTextField(
        firstPage,
        "tax",
        `₹ ${billData.tax || 0}`,
        fontRegular,
        fontBold,
      );
      this._addTextField(
        firstPage,
        "total",
        `₹ ${billData.total}`,
        fontRegular,
        fontBold,
      );
      // Add payment details
      if (billData.paymentDetails) {
        this._addTextField(
          firstPage,
          "paymentDetails",
          billData.paymentDetails,
          fontRegular,
          fontBold,
        );
      }
      // Save final PDF
      const finalBuffer = await pdfDoc.save();
      return finalBuffer;
    } catch (error) {
      console.error("PDF Generation Error:", error);
      throw error;
    }
  }
  _toPdfY(page, topY, fontSize) {
    const { height } = page.getSize();
    return height - topY - fontSize;
  }
  _normalizeText(value) {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) {
      return this._sanitizeWinAnsi(
        value.toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
      );
    }
    return this._sanitizeWinAnsi(String(value));
  }
  _sanitizeWinAnsi(text) {
    return String(text)
      .replace(/₹/g, "Rs.")
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"');
  }
  _fillFormFields(form, fieldData) {
    const entries = Object.entries(fieldData || {});
    const fields = form.getFields();
    const normalize = (s) =>
      String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
    const fieldMap = new Map();
    fields.forEach((f) => fieldMap.set(normalize(f.getName()), f));
    for (const [key, rawValue] of entries) {
      if (rawValue === undefined || rawValue === null || rawValue === "")
        continue;
      const value = this._normalizeText(rawValue);
      const direct = fields.find((f) => f.getName() === key);
      const fuzzy = fieldMap.get(normalize(key));
      const target = direct || fuzzy;
      if (!target) continue;
      try {
        target.setText(String(value));
      } catch {
        // Ignore non-text/incompatible fields safely.
      }
    }
  }
  _addTextField(page, fieldKey, value, fontRegular, fontBold) {
    const config = PDF_FIELD_POSITIONS[fieldKey];
    if (!config || !value) return;
    const text = this._normalizeText(value);
    const size = config.fontSize || 11;
    const font = config.fontWeight === "bold" ? fontBold : fontRegular;
    const maxWidth = config.maxWidth || 250;
    const textWidth = font.widthOfTextAtSize(text, size);
    let x = config.x;
    if (config.align === "right") {
      x = config.x - maxWidth + Math.max(0, maxWidth - textWidth);
    } else if (config.align === "center") {
      x = config.x + Math.max(0, (maxWidth - textWidth) / 2);
    }
    page.drawText(text, {
      x,
      y: this._toPdfY(page, config.y, size),
      size,
      font,
      color: rgb(0, 0, 0),
      maxWidth,
    });
  }
  _addTable(page, items, fontRegular, fontBold) {
    const tableConfig = TABLE_CONFIG;
    const startPos = PDF_FIELD_POSITIONS.tableStart;
    const tableWidth = tableConfig.columns.reduce(
      (sum, col) => sum + col.width,
      0,
    );
    const startX = startPos.x;
    let currentY = startPos.y;
    // Draw header
    this._drawTableHeader(
      page,
      currentY,
      tableConfig,
      fontBold,
      tableWidth,
      startX,
    );
    currentY += tableConfig.headerHeight;
    // Draw rows
    items.forEach((item, index) => {
      this._drawTableRow(
        page,
        currentY,
        item,
        tableConfig,
        index + 1,
        fontRegular,
        startX,
      );
      currentY += tableConfig.rowHeight;
    });
    const totalHeight =
      tableConfig.headerHeight + items.length * tableConfig.rowHeight;
    page.drawRectangle({
      x: startX,
      y: this._toPdfY(page, startPos.y, 0) - totalHeight,
      width: tableWidth,
      height: totalHeight,
      borderColor: rgb(0.78, 0.78, 0.78),
      borderWidth: 0.5,
      color: rgb(1, 1, 1),
      opacity: 0,
      borderOpacity: 1,
    });
  }
  _drawTableHeader(page, y, config, fontBold, tableWidth, startX) {
    let x = startX;
    config.columns.forEach((col) => {
      page.drawText(col.header, {
        x: x + 4,
        y: this._toPdfY(page, y, config.headerFontSize || 11),
        size: config.headerFontSize || 11,
        font: fontBold,
        color: rgb(0, 0, 0),
        maxWidth: col.width - 8,
      });
      x += col.width;
    });
    page.drawRectangle({
      x: startX,
      y: this._toPdfY(page, y, 0) - config.headerHeight,
      width: tableWidth,
      height: config.headerHeight,
      borderColor: rgb(0.78, 0.78, 0.78),
      borderWidth: 0.5,
      color: rgb(1, 1, 1),
      opacity: 0,
      borderOpacity: 1,
    });
  }
  _drawTableRow(page, y, item, config, rowNumber, fontRegular, startX) {
    let x = startX;
    const columns = [
      rowNumber.toString(),
      item.description || "",
      item.hsnCode || "",
      String(item.quantity || ""),
      item.rate ? `₹ ${item.rate}` : "",
      item.amount ? `₹ ${item.amount}` : "",
    ];
    config.columns.forEach((col, idx) => {
      const text = this._normalizeText(columns[idx] || "");
      const size = config.fontSize || 10;
      const width = fontRegular.widthOfTextAtSize(text, size);
      let textX = x + 4;
      if (col.align === "right") {
        textX = x + col.width - width - 4;
      } else if (col.align === "center") {
        textX = x + (col.width - width) / 2;
      }
      page.drawText(text, {
        x: textX,
        y: this._toPdfY(page, y, size),
        size,
        font: fontRegular,
        color: rgb(0, 0, 0),
        maxWidth: col.width - 8,
      });
      page.drawRectangle({
        x,
        y: this._toPdfY(page, y, 0) - config.rowHeight,
        width: col.width,
        height: config.rowHeight,
        borderColor: rgb(0.85, 0.85, 0.85),
        borderWidth: 0.4,
        color: rgb(1, 1, 1),
        opacity: 0,
        borderOpacity: 1,
      });
      x += col.width;
    });
  }
}
