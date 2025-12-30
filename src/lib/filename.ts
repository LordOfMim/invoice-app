import type { Invoice } from "@/lib/domain";

export function buildPdfFilename(pattern: string, invoice: Invoice): string {
  const safe = (value: string) => value.replace(/[\\/:*?"<>|]+/g, "-").trim();

  const replaced = pattern
    .replaceAll("{invoiceNumber}", invoice.invoiceNumber || "")
    .replaceAll("{invoiceDate}", invoice.invoiceDate || "")
    .replaceAll("{dueDate}", invoice.dueDate || "");

  const trimmed = replaced.trim() || "Invoice.pdf";
  const withExt = trimmed.toLowerCase().endsWith(".pdf") ? trimmed : `${trimmed}.pdf`;
  return safe(withExt);
}
