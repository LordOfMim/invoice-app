import { isFileRef } from "../../electron/file-refs.cjs";
import type { DeclarationDefaults } from "@/lib/documents";
import type { AppSettings, FileRef, Invoice } from "@/lib/domain";
import { getCurrentData } from "@/lib/storage/store";
import type { StorageAdapter } from "@/lib/storage/types";

/*
 * Standard values for new contractor declarations plus the signature or stamp image that every declaration prints.
 * They live beside the main data under their own key, as they did before declarations were saved per project.
 */

export const DECLARATION_DEFAULTS_KEY = "fachunternehmer-defaults";

/**
 * The signature or stamp is a stored file (`signatureFile`, desktop app) or a data URL (`signatureImage`: data from
 * versions up to 1.3 until it is moved into a file, and the browser).
 */
export type StoredDeclarationDefaults = DeclarationDefaults & { signatureImage: string | null; signatureFile?: FileRef };

const EMPTY: StoredDeclarationDefaults = {
  senderAddress: "",
  recipientName: "",
  recipientAddress: "",
  kommission: "",
  signatureName: "",
  signatureImage: null,
};

/**
 * What the declaration page showed before anyone saved standard values (versions up to 1.2). They are the details
 * of the one business the app was first written for. That installation keeps them until it saves its own standard
 * values; every other installation starts empty and takes its sender from the settings (see `isOriginalInstallation`).
 */
const BUILT_IN: StoredDeclarationDefaults = {
  senderAddress: "Fa.Dembiany Schwirrammerweg 39 13129 Berlin",
  recipientName: "Fa.Germerott\nInnenausbau Gmbh & Co KG",
  recipientAddress: "Robert-Bosch-Strasse 3\n30989 Gehrden",
  kommission: "",
  signatureName: "Fa.Dembiany",
  signatureImage: null,
};

type InstallationData = { settings?: Pick<AppSettings, "defaultSender">; invoices?: readonly Pick<Invoice, "sender">[] };

/**
 * True only for the installation the built-in values belong to: its own sender, in the settings or on one of its
 * invoices, is that business. Every other installation, including a fresh one, gets empty standard values.
 */
function isOriginalInstallation(data: InstallationData | null | undefined): boolean {
  const mentions = (party: { name?: string; address?: string } | undefined) => !!party && /dembiany/i.test(`${party.name ?? ""}\n${party.address ?? ""}`);
  return mentions(data?.settings?.defaultSender) || (data?.invoices ?? []).some((invoice) => mentions(invoice.sender));
}

export function loadDeclarationDefaults(adapter: StorageAdapter, data: InstallationData | null | undefined = getCurrentData()): StoredDeclarationDefaults {
  try {
    const stored = adapter.getItem(DECLARATION_DEFAULTS_KEY);
    if (stored === null || stored === "") return isOriginalInstallation(data) ? BUILT_IN : EMPTY;
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
      ...(isFileRef(record.signatureFile) ? { signatureFile: record.signatureFile } : {}),
    };
  } catch {
    return EMPTY;
  }
}

/** Throws when the storage refuses the value; callers tell the user. */
export function saveDeclarationDefaults(adapter: StorageAdapter, defaults: StoredDeclarationDefaults): void {
  adapter.setItem(DECLARATION_DEFAULTS_KEY, JSON.stringify(defaults));
}
