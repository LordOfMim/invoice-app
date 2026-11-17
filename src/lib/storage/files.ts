import { embeddedFiles, externalizeFiles } from "../../../electron/file-refs.cjs";
import type { AppSettings, Attachment, FileRef, Invoice } from "@/lib/domain";

/*
 * Attachments, logos and the signature image. In the desktop app their bytes are files in the folder "attachments"
 * beside the data file and the data holds a reference (`FileRef`); the data file stays small however many files
 * there are. Data from versions up to 1.3 and the browser carry the bytes as base64 data URLs in the data itself.
 * Everything here accepts both forms.
 */

export type FilePutResult = { ok: boolean; file?: FileRef; error?: string };
export type FilesApi = {
  /** Store the content of a base64 data URL as a file and return its reference. */
  put: (dataUrl: string) => Promise<FilePutResult>;
  /** The stored file as a data URL, or null when it is missing or damaged. */
  dataUrlSync: (file: FileRef) => string | null;
  /** Save a copy through the system dialog. */
  save: (file: FileRef, name: string) => Promise<{ ok: boolean; canceled?: boolean; error?: string }>;
};

function filesApi(): FilesApi | null {
  if (typeof window === "undefined") return null;
  return (window as { electronAPI?: { files?: FilesApi } }).electronAPI?.files ?? null;
}

// One read per file and session; `null` remembers a missing file so a preview does not ask again on every render.
const urls = new Map<string, string | null>();

/** A stored file as a data URL for an image, or undefined when it cannot be read. */
export function fileUrl(file: FileRef | null | undefined): string | undefined {
  if (!file) return undefined;
  const known = urls.get(file.id);
  if (known !== undefined) return known ?? undefined;
  const api = filesApi();
  if (!api) return undefined;
  let url: string | null = null;
  try { url = api.dataUrlSync(file); } catch { url = null; }
  urls.set(file.id, url);
  return url ?? undefined;
}

/** The address of an image that is a data URL (older data, browser) or a stored file. */
export function imageUrl(file: FileRef | null | undefined, dataUrl: string | null | undefined): string | undefined {
  return dataUrl || fileUrl(file);
}

/** The logo an invoice or quote prints: its own, otherwise the one from the settings. */
export function logoUrl(
  invoice: Pick<Invoice, "logoFile" | "logoDataUrl">,
  settings: Pick<AppSettings, "defaultLogoFile" | "defaultLogoDataUrl"> | null | undefined,
): string | undefined {
  // An own logo that cannot be read prints no logo; it is never replaced silently by a different one.
  if (invoice.logoDataUrl || invoice.logoFile) return imageUrl(invoice.logoFile, invoice.logoDataUrl);
  return settings ? imageUrl(settings.defaultLogoFile, settings.defaultLogoDataUrl) : undefined;
}

/** Read a chosen file as a base64 data URL. */
export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Die Datei konnte nicht gelesen werden.")));
    reader.onerror = () => reject(new Error("Die Datei konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

/**
 * Keep newly chosen content. The desktop app stores a file and returns its reference; the browser, or a desktop
 * app whose disk refuses the file, keeps the data URL in the data as before (the next start tries again).
 */
export async function keepFile(dataUrl: string): Promise<{ file: FileRef; dataUrl?: undefined } | { file?: undefined; dataUrl: string }> {
  const api = filesApi();
  if (api) {
    try {
      const result = await api.put(dataUrl);
      if (result.ok && result.file) return { file: result.file };
    } catch { /* Fall back to the embedded form below. */ }
  }
  return { dataUrl };
}

/** Save a copy of an attachment that is a stored file. Throws with a message for the user when it fails. */
export async function saveStoredAttachment(attachment: Pick<Attachment, "file" | "name">): Promise<"saved" | "canceled"> {
  const api = filesApi();
  if (!api || !attachment.file) throw new Error("Die Datei ist nicht mehr vorhanden.");
  const result = await api.save(attachment.file, attachment.name);
  if (result.ok) return "saved";
  if (result.canceled) return "canceled";
  throw new Error(result.error || "Die Datei konnte nicht gespeichert werden.");
}

/**
 * Move the files that older data carries as data URLs into the file store and return the data with references in
 * their place. A file the store does not confirm stays embedded, so nothing is dropped from the data before its
 * file is safely on disk. Returns the same object when nothing was moved.
 */
export async function moveEmbeddedFiles<T>(data: T, put: FilesApi["put"]): Promise<T> {
  const refs = new Map<string, FileRef>();
  for (const dataUrl of embeddedFiles(data)) {
    try {
      const result = await put(dataUrl);
      if (result.ok && result.file) refs.set(dataUrl, result.file);
    } catch { /* This file stays embedded. */ }
  }
  return externalizeFiles(data, refs);
}
