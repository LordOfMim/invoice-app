/** Editor tabs; the hash keeps the open tab across reloads (#vorschau). */
export type EditorTab = "edit" | "preview" | "payments" | "einvoice" | "extras";

export const tabHash: Record<EditorTab, string> = {
  edit: "bearbeiten",
  preview: "vorschau",
  payments: "zahlungen",
  einvoice: "e-rechnung",
  extras: "gestaltung",
};

/** DOM id of the control behind a validation field key such as `lineItems.2.quantity`. */
export function fieldId(field: string) {
  return `f-${field.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}

/**
 * Where a field reported by the E-Rechnung check lives, so a message can lead straight to the control with all
 * inputs kept. Keys come from `prepareEInvoice` in `src/lib/einvoice`.
 */
export function errorTarget(field: string): { tab: EditorTab; id: string; sender?: boolean } {
  if (field === "seller") return { tab: "edit", id: fieldId("sender.name"), sender: true };
  if (field === "buyer") return { tab: "edit", id: fieldId("recipient.name") };
  if (field === "invoiceNumber" || field === "invoiceDate" || field === "dueDate") return { tab: "edit", id: fieldId(field) };
  if (field === "currency") return { tab: "extras", id: fieldId("currency") };
  if (field === "lineItems") return { tab: "edit", id: "positionen-title" };
  if (field.startsWith("lineItems.")) {
    const [, index, prop] = field.split(".");
    return { tab: "edit", id: fieldId(`lineItems.${index}.${prop ?? "description"}`) };
  }
  if (field.startsWith("einvoice.")) return { tab: "einvoice", id: fieldId(field) };
  return { tab: "einvoice", id: "einvoice-messages" };
}
