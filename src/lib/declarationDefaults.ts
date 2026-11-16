import type { DeclarationDefaults } from "@/lib/documents";
import type { StorageAdapter } from "@/lib/storage/types";

/*
 * Standard values for new contractor declarations plus the signature or stamp image that every declaration prints.
 * They live beside the main data under their own key, as they did before declarations were saved per project.
 */

export const DECLARATION_DEFAULTS_KEY = "fachunternehmer-defaults";

export type StoredDeclarationDefaults = DeclarationDefaults & { signatureImage: string | null };

const EMPTY: StoredDeclarationDefaults = {
  senderAddress: "",
  recipientName: "",
  recipientAddress: "",
  kommission: "",
  signatureName: "",
  signatureImage: null,
};

/**
 * What the declaration page showed before anyone saved standard values (versions up to 1.2). An installation that
 * relied on these keeps them; saving standard values replaces them.
 */
const BUILT_IN: StoredDeclarationDefaults = {
  senderAddress: "Fa.Dembiany Schwirrammerweg 39 13129 Berlin",
  recipientName: "Fa.Germerott\nInnenausbau Gmbh & Co KG",
  recipientAddress: "Robert-Bosch-Strasse 3\n30989 Gehrden",
  kommission: "",
  signatureName: "Fa.Dembiany",
  signatureImage: null,
};

export function loadDeclarationDefaults(adapter: StorageAdapter): StoredDeclarationDefaults {
  try {
    const stored = adapter.getItem(DECLARATION_DEFAULTS_KEY);
    if (stored === null || stored === "") return BUILT_IN;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return EMPTY;
    const record = parsed as Record<string, unknown>;
    const text = (key: keyof DeclarationDefaults) => (typeof record[key] === "string" ? (record[key] as string) : "");
    return {
      senderAddress: text("senderAddress"),
      recipientName: text("recipientName"),
      recipientAddress: text("recipientAddress"),
      kommission: text("kommission"),
      signatureName: text("signatureName"),
      signatureImage: typeof record.signatureImage === "string" && record.signatureImage ? record.signatureImage : null,
    };
  } catch {
    return EMPTY;
  }
}

/** Throws when the storage refuses the value; callers tell the user. */
export function saveDeclarationDefaults(adapter: StorageAdapter, defaults: StoredDeclarationDefaults): void {
  adapter.setItem(DECLARATION_DEFAULTS_KEY, JSON.stringify(defaults));
}
