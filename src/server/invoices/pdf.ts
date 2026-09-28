import "server-only";

import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";

import { formatCalendarDate } from "@/lib/calendar-date";
import { formatInvoiceNumber, invoiceDisplayStatus } from "@/lib/invoices";
import { formatAmount, formatPercent, formatQuantity } from "@/lib/money";

import { type getInvoice } from "./service";

type InvoiceForPdf = Awaited<ReturnType<typeof getInvoice>>;

const PAGE = { width: 595.28, height: 841.89, margin: 48 }; // A4
const TEXT = rgb(0.09, 0.09, 0.09);
const MUTED = rgb(0.45, 0.45, 0.45);

/**
 * The standard PDF fonts only encode WinAnsi (Latin-1-like) characters and
 * throw on anything else, so replace characters the font cannot encode.
 */
function encodable(font: PDFFont, text: string): string {
  let result = "";
  for (const char of text.replace(/\r?\n/g, " ")) {
    try {
      font.encodeText(char);
      result += char;
    } catch {
      result += "?";
    }
  }
  return result;
}

/** Truncate to fit `width` with an ellipsis. */
function fit(font: PDFFont, text: string, size: number, width: number): string {
  let value = encodable(font, text);
  if (font.widthOfTextAtSize(value, size) <= width) return value;
  while (value.length > 1 && font.widthOfTextAtSize(`${value}...`, size) > width) {
    value = value.slice(0, -1);
  }
  return `${value}...`;
}

/** Printable A4 PDF of an invoice. Amounts use the currency code (fonts lack some symbols). */
export async function renderInvoicePdf(invoice: InvoiceForPdf, organizationName: string) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${formatInvoiceNumber(invoice.number)} – ${organizationName}`);
  pdf.setProducer("ClientFlow");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - PAGE.margin;
  const right = PAGE.width - PAGE.margin;

  const text = (
    value: string,
    x: number,
    options: {
      size?: number;
      font?: PDFFont;
      color?: ReturnType<typeof rgb>;
      alignRight?: boolean;
    } = {},
  ) => {
    const font = options.font ?? regular;
    const size = options.size ?? 10;
    const safe = encodable(font, value);
    const drawX = options.alignRight ? x - font.widthOfTextAtSize(safe, size) : x;
    page.drawText(safe, { x: drawX, y, size, font, color: options.color ?? TEXT });
  };
  const newPageIfNeeded = (needed: number) => {
    if (y - needed < PAGE.margin) {
      page = pdf.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - PAGE.margin;
    }
  };

  const status = invoiceDisplayStatus(invoice);
  text(fit(bold, organizationName, 16, 300), PAGE.margin, { size: 16, font: bold });
  text(status === "DRAFT" ? "DRAFT INVOICE" : "INVOICE", right, {
    size: 16,
    font: bold,
    alignRight: true,
  });
  y -= 20;
  text(formatInvoiceNumber(invoice.number), right, { alignRight: true, color: MUTED });
  y -= 14;
  text(`Status: ${status}`, right, { alignRight: true, color: MUTED });

  y -= 30;
  text("Bill to", PAGE.margin, { font: bold });
  const dates: [string, string][] = [
    ["Issue date", formatCalendarDate(invoice.issueDate)],
    ["Due date", formatCalendarDate(invoice.dueDate)],
    ["Currency", invoice.currency],
  ];
  const billTo = [
    invoice.client.name,
    invoice.client.company,
    invoice.client.email,
    ...(invoice.client.address ?? "").split(/\r?\n/),
  ].filter((line): line is string => Boolean(line && line.trim()));
  const rows = Math.max(billTo.length, dates.length);
  for (let index = 0; index < rows; index++) {
    y -= 14;
    if (billTo[index]) text(fit(regular, billTo[index], 10, 260), PAGE.margin);
    if (dates[index]) {
      text(dates[index][0], right - 150, { color: MUTED });
      text(dates[index][1], right, { alignRight: true });
    }
  }

  // Line items.
  const columns = {
    description: PAGE.margin,
    quantity: right - 200,
    price: right - 90,
    amount: right,
  };
  y -= 34;
  page.drawLine({
    start: { x: PAGE.margin, y: y + 14 },
    end: { x: right, y: y + 14 },
    color: MUTED,
    thickness: 0.5,
  });
  text("Description", columns.description, { font: bold });
  text("Qty", columns.quantity, { font: bold, alignRight: true });
  text("Unit price", columns.price, { font: bold, alignRight: true });
  text("Amount", columns.amount, { font: bold, alignRight: true });
  y -= 8;
  page.drawLine({
    start: { x: PAGE.margin, y },
    end: { x: right, y },
    color: MUTED,
    thickness: 0.5,
  });
  for (const item of invoice.items) {
    y -= 16;
    newPageIfNeeded(16);
    text(
      fit(regular, item.description, 10, columns.quantity - PAGE.margin - 60),
      columns.description,
    );
    text(formatQuantity(item.quantityMilli), columns.quantity, { alignRight: true });
    text(formatAmount(item.unitPriceCents), columns.price, { alignRight: true });
    text(formatAmount(item.amountCents), columns.amount, { alignRight: true });
  }
  if (invoice.items.length === 0) {
    y -= 16;
    text("No line items", columns.description, { color: MUTED });
  }

  // Totals.
  y -= 12;
  page.drawLine({
    start: { x: right - 220, y },
    end: { x: right, y },
    color: MUTED,
    thickness: 0.5,
  });
  const totals: [string, string, boolean][] = [
    ["Subtotal", formatAmount(invoice.subtotalCents), false],
    [
      `Discount (${formatPercent(invoice.discountBps)}%)`,
      `-${formatAmount(invoice.discountCents)}`,
      false,
    ],
    [`Tax (${formatPercent(invoice.taxBps)}%)`, formatAmount(invoice.taxCents), false],
    [`Total (${invoice.currency})`, formatAmount(invoice.totalCents), true],
  ];
  for (const [label, value, strong] of totals) {
    y -= 16;
    newPageIfNeeded(16);
    text(label, right - 220, { font: strong ? bold : regular, color: strong ? TEXT : MUTED });
    text(value, right, { font: strong ? bold : regular, alignRight: true });
  }
  if (invoice.status === "PAID" && invoice.paidAt) {
    y -= 22;
    text(`Paid on ${formatCalendarDate(invoice.paidAt)}`, right, { font: bold, alignRight: true });
  }

  if (invoice.notes) {
    y -= 34;
    newPageIfNeeded(40);
    text("Notes", PAGE.margin, { font: bold });
    for (const line of invoice.notes.split(/\r?\n/).slice(0, 12)) {
      y -= 14;
      newPageIfNeeded(14);
      text(fit(regular, line, 10, right - PAGE.margin), PAGE.margin, { color: MUTED });
    }
  }

  return pdf.save();
}
