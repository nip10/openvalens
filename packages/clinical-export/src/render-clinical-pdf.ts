// Issue #132 — lays out the clinical PDF document with PDFKit (pure
// JavaScript, built-in Helvetica, no browser or native dependency). The
// output is transient: bytes are produced in memory and handed back to the
// caller; nothing is written to disk or object storage.
import PDFDocument from "pdfkit";

import {
  buildClinicalPdfDocument,
  type ClinicalPdfDocument,
  type ClinicalPdfSection,
} from "./clinical-pdf-document";
import type { ExportPayload } from "./types";

export type ClinicalPdfRenderResult = {
  fileName: string;
  contentType: "application/pdf";
  bytes: Uint8Array;
  pageCount: number;
};

const MARGIN = 48;
const FOOTER_HEIGHT = 28;
const CELL_PADDING = 3;
const COLORS = {
  text: "#111827",
  muted: "#4b5563",
  rule: "#d1d5db",
  headerFill: "#f3f4f6",
  noticeFill: "#f9fafb",
} as const;

type Doc = InstanceType<typeof PDFDocument>;

export async function renderClinicalPdf(payload: ExportPayload): Promise<ClinicalPdfRenderResult> {
  const content = buildClinicalPdfDocument(payload);
  const generated = new Date(content.generatedAt);
  const stamp = Number.isNaN(generated.getTime()) ? new Date(0) : generated;

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN + FOOTER_HEIGHT, left: MARGIN, right: MARGIN },
    bufferPages: true,
    // Metadata is fixed copy only — never workspace names or record values.
    info: {
      Title: content.title,
      Creator: "OpenValens",
      Producer: "OpenValens",
      CreationDate: stamp,
      ModDate: stamp,
    },
  });

  const chunks: Uint8Array[] = [];
  doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  drawHeader(doc, content);
  for (const section of content.sections) drawSection(doc, section);
  const pageCount = drawFooters(doc, content);
  doc.end();
  await finished;

  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { fileName: content.fileName, contentType: "application/pdf", bytes, pageCount };
}

function contentWidth(doc: Doc): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function bottomLimit(doc: Doc): number {
  return doc.page.height - doc.page.margins.bottom;
}

function ensureSpace(doc: Doc, height: number): boolean {
  if (doc.y + height <= bottomLimit(doc)) return false;
  doc.addPage();
  return true;
}

function drawHeader(doc: Doc, content: ClinicalPdfDocument): void {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);

  doc.fillColor(COLORS.text).font("Helvetica-Bold").fontSize(18).text(content.title, left, doc.y);
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted);
  for (const line of [content.generatedLabel, content.sectionsLabel, content.formatLabel]) {
    doc.text(line, left, doc.y, { width });
  }
  doc.moveDown(0.8);

  // "About this document" notice, boxed so it is read before any record.
  doc.font("Helvetica").fontSize(8.5);
  const paragraphGap = 3;
  const innerWidth = width - 16;
  const heading = "About this document";
  const bodyHeight = content.disclaimer.reduce(
    (total, paragraph) =>
      total + doc.heightOfString(paragraph, { width: innerWidth }) + paragraphGap,
    0,
  );
  const boxHeight = 8 + 12 + bodyHeight + 6;
  const top = doc.y;
  doc.save();
  doc.rect(left, top, width, boxHeight).fillAndStroke(COLORS.noticeFill, COLORS.rule);
  doc.restore();
  doc
    .fillColor(COLORS.text)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(heading, left + 8, top + 8, { width: innerWidth });
  doc.font("Helvetica").fontSize(8.5).fillColor(COLORS.text);
  let y = top + 8 + 12;
  for (const paragraph of content.disclaimer) {
    doc.text(paragraph, left + 8, y, { width: innerWidth });
    y += doc.heightOfString(paragraph, { width: innerWidth }) + paragraphGap;
  }
  doc.x = left;
  doc.y = top + boxHeight + 14;
}

function drawSection(doc: Doc, section: ClinicalPdfSection): void {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);

  doc.font("Helvetica-Bold").fontSize(12);
  const titleHeight = doc.heightOfString(section.title, { width });
  doc.font("Helvetica").fontSize(8);
  const provenanceHeight = doc.heightOfString(section.provenance, { width });
  // Keep the heading with its provenance and at least one row.
  ensureSpace(doc, titleHeight + provenanceHeight + 40);

  doc
    .fillColor(COLORS.text)
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(section.title, left, doc.y, { width });
  doc.moveDown(0.2);
  doc
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .fontSize(8)
    .text(section.provenance, left, doc.y, { width });
  doc.moveDown(0.4);

  if (section.rows.length === 0) {
    doc
      .fillColor(COLORS.muted)
      .font("Helvetica-Oblique")
      .fontSize(9)
      .text(section.emptyText, left, doc.y, { width });
    doc.moveDown(1.2);
    return;
  }

  const totalWeight = section.columns.reduce((total, column) => total + column.weight, 0);
  const widths = section.columns.map((column) => (column.weight / totalWeight) * width);
  const labels = section.columns.map((column) => column.label);

  drawRow(doc, labels, widths, { header: true });
  for (const row of section.rows) {
    const height = rowHeight(doc, row, widths, false);
    if (ensureSpace(doc, height)) {
      doc
        .fillColor(COLORS.muted)
        .font("Helvetica-Oblique")
        .fontSize(8)
        .text(`${section.title} (continued)`, left, doc.y, { width });
      doc.moveDown(0.2);
      drawRow(doc, labels, widths, { header: true });
    }
    drawRow(doc, row, widths, { header: false });
  }

  if (section.totalCount > section.rows.length) {
    doc.moveDown(0.3);
    doc
      .fillColor(COLORS.muted)
      .font("Helvetica-Oblique")
      .fontSize(8)
      .text(
        `Showing the ${section.rows.length} most recent of ${section.totalCount} stored records. Use the CSV export for the full list.`,
        left,
        doc.y,
        { width },
      );
  }
  doc.x = left;
  doc.moveDown(1.2);
}

function rowHeight(doc: Doc, cells: readonly string[], widths: number[], header: boolean): number {
  doc.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(8);
  let tallest = 0;
  cells.forEach((cell, index) => {
    const cellWidth = (widths[index] ?? 0) - CELL_PADDING * 2;
    tallest = Math.max(tallest, doc.heightOfString(cell || " ", { width: cellWidth }));
  });
  return tallest + CELL_PADDING * 2;
}

function drawRow(
  doc: Doc,
  cells: readonly string[],
  widths: number[],
  options: { header: boolean },
): void {
  const left = doc.page.margins.left;
  const height = rowHeight(doc, cells, widths, options.header);
  const top = doc.y;

  doc.save();
  let x = left;
  widths.forEach((cellWidth) => {
    if (options.header)
      doc.rect(x, top, cellWidth, height).fillAndStroke(COLORS.headerFill, COLORS.rule);
    else doc.rect(x, top, cellWidth, height).lineWidth(0.5).stroke(COLORS.rule);
    x += cellWidth;
  });
  doc.restore();

  doc
    .fillColor(COLORS.text)
    .font(options.header ? "Helvetica-Bold" : "Helvetica")
    .fontSize(8);
  x = left;
  cells.forEach((cell, index) => {
    const cellWidth = widths[index] ?? 0;
    doc.text(cell, x + CELL_PADDING, top + CELL_PADDING, {
      width: cellWidth - CELL_PADDING * 2,
      lineBreak: true,
    });
    x += cellWidth;
  });
  doc.x = left;
  doc.y = top + height;
}

function drawFooters(doc: Doc, content: ClinicalPdfDocument): number {
  const range = doc.bufferedPageRange();
  const pageCount = range.count;
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const left = doc.page.margins.left;
    const width = contentWidth(doc);
    const y = doc.page.height - MARGIN - 10;
    // Drawing inside the bottom margin must not trigger an automatic page.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .fillColor(COLORS.muted)
      .font("Helvetica")
      .fontSize(7.5)
      .text(
        `${content.title} - ${content.generatedLabel.replace("Generated: ", "generated ")} - ${content.footerNote} - Page ${index - range.start + 1} of ${pageCount}`,
        left,
        y,
        { width, align: "center", lineBreak: false },
      );
    doc.page.margins.bottom = bottom;
  }
  return pageCount;
}
