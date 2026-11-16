import { waitForInvoicePrintReady } from "@/lib/printing";

export type PdfResult = { ok: boolean; canceled?: boolean; message: string };

/**
 * Save the document currently shown in the page's single `.print-area` as a PDF. The desktop app prints it natively
 * and asks where to save; in a browser the system print dialog opens instead. Callers show `message` to the user.
 */
export async function savePrintAreaAsPdf(filename: string): Promise<PdfResult> {
  await waitForInvoicePrintReady();
  const api = window.electronAPI;
  if (!api?.printToPDF) {
    const original = document.title;
    document.title = filename.replace(/\.pdf$/i, "");
    try { window.print(); } finally { document.title = original; }
    return { ok: true, message: "" };
  }
  const bytes = await api.printToPDF({ printBackground: true, preferCSSPageSize: true });
  if (!bytes) throw new Error("Die PDF konnte nicht erstellt werden.");
  if (api.saveDocument) {
    const result = await api.saveDocument({ filename, bytes: new Uint8Array(bytes) });
    if (!result.ok && !result.canceled) throw new Error(result.error || "Speichern fehlgeschlagen.");
    return result.ok ? { ok: true, message: "PDF gespeichert." } : { ok: false, canceled: true, message: "" };
  }
  const copy = new Uint8Array(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { ok: true, message: "PDF gespeichert." };
}

/** File-name safe text for PDFs named after a document number or a customer. */
export function safeFilePart(value: string, fallback: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|\x00-\x1f]+/g, "-").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  return cleaned.slice(0, 80) || fallback;
}
