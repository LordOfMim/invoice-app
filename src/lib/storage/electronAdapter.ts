import type { StorageAdapter } from "@/lib/storage/types";
import { STORAGE_KEY } from "@/lib/storage/keys";

// Type declaration for the Electron API exposed via preload
declare global {
  interface Window {
    electronAPI?: {
      store: {
        get: (key: string) => Promise<string | null>;
        set: (key: string, value: string) => Promise<boolean>;
        onStatus?: (callback: (status: "saving" | "saved" | "error") => void) => () => void;
        getCached?: (key: string) => string | null;
        setCached?: (key: string, value: string) => boolean;
        getSync?: (key: string) => string | null;
        setSync?: (key: string, value: string) => boolean;
        applyPatches?: (patches: import("./patches").DataPatch[]) => boolean;
        flush?: () => Promise<boolean>;
        listRecoveries?: () => Promise<Array<{ id: string; label: string; createdAt: string; size: number; kind: "upgrade" | "last-good" | "recovery" | "automatic" }>>;
        getRecovery?: (id: string) => Promise<string>;
        delete: (key: string) => Promise<boolean>;
        clear: () => Promise<boolean>;
      };
      getAppInfo: () => Promise<{ version: string; name: string; path: string }>;
      printToPDF: (options?: object) => Promise<Buffer | null>;
      saveDocument?: (payload: { filename: string; bytes: Uint8Array }) => Promise<{ ok: boolean; canceled?: boolean; error?: string }>;
      saveTextFile?: (payload: { filename: string; extension: "json" | "csv"; text: string }) => Promise<{ ok: boolean; canceled?: boolean; error?: string }>;
      backup?: {
        getFolder: () => Promise<{ ok: boolean; folder: string | null; available: boolean; error?: string }>;
        chooseFolder: () => Promise<{ ok: boolean; canceled?: boolean; folder?: string | null; available?: boolean; error?: string }>;
        clearFolder: () => Promise<{ ok: boolean; error?: string }>;
        openFolder: () => Promise<{ ok: boolean; error?: string }>;
        write: (json: string) => Promise<{ ok: boolean; file?: string; folder?: string; files?: number; missingFiles?: number; error?: string }>;
        /** One ZIP with the data and its attachments, saved through the system dialog. */
        saveArchive?: (json: string, filename: string) => Promise<{ ok: boolean; canceled?: boolean; file?: string; files?: number; missingFiles?: number; error?: string }>;
        /** Pick a ZIP or JSON backup; its attachments are taken over and the data is returned for the import. */
        open?: () => Promise<{ ok: boolean; canceled?: boolean; json?: string; missingFiles?: number; error?: string }>;
      };
      files?: import("@/lib/storage/files").FilesApi;
      exportArchive?: {
        begin: (filename: string) => Promise<{ ok: boolean; canceled?: boolean; error?: string }>;
        addPdf: (name: string) => Promise<{ ok: boolean; name?: string; error?: string }>;
        addText: (name: string, extension: "csv" | "txt", text: string) => Promise<{ ok: boolean; name?: string; error?: string }>;
        finish: (options?: { cancel?: boolean; reveal?: boolean }) => Promise<{ ok: boolean; canceled?: boolean; count?: number; file?: string; error?: string }>;
      };
      emailInvoiceWithPdf?: (payload: {
        to?: string;
        subject: string;
        body: string;
        filename: string;
      }) => Promise<{ ok: boolean; error?: string }>;
      mail?: import("@/lib/mail").MailApi;
      platform: string;
      isElectron: boolean;
    };
  }
}

// Check if running in Electron
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
}

/**
 * Save a backup (JSON) or a list (CSV). The desktop app asks where to save and reports whether the file was written
 * ("saved") or the dialog was closed ("canceled"). A browser can only start a download ("download"): whether and
 * where that file ends up is not known to the page, so callers must not call it saved.
 */
export async function saveTextFile(filename: string, extension: "json" | "csv", text: string): Promise<"saved" | "canceled" | "download"> {
  const save = typeof window !== "undefined" ? window.electronAPI?.saveTextFile : undefined;
  if (save) {
    const result = await save({ filename, extension, text });
    if (result.ok) return "saved";
    if (result.canceled) return "canceled";
    throw new Error(result.error || "Die Datei konnte nicht gespeichert werden.");
  }
  const url = URL.createObjectURL(new Blob([text], { type: extension === "csv" ? "text/csv;charset=utf-8" : "application/json" }));
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return "download";
}

// In-memory cache for synchronous access (Electron storage is async)
let electronCache: Record<string, string> = {};
let cacheInitialized = false;
let cacheInitPromise: Promise<void> | null = null;

// Initialize cache from Electron store
async function initializeCache(): Promise<void> {
  if (cacheInitialized || !isElectron()) return;
  
  if (cacheInitPromise) {
    return cacheInitPromise;
  }
  
  cacheInitPromise = (async () => {
    try {
      const data = await window.electronAPI!.store.get(STORAGE_KEY);
      if (data) {
        electronCache[STORAGE_KEY] = data;
      }
      cacheInitialized = true;
    } catch (error) {
      console.error('Failed to initialize Electron cache:', error);
      cacheInitialized = true; // Mark as initialized to prevent retries
    }
  })();
  
  return cacheInitPromise;
}

// Get Electron storage adapter (with sync interface backed by async operations)
export function getElectronStorageAdapter(): StorageAdapter | null {
  if (!isElectron()) return null;
  
  // Start initializing cache
  initializeCache();
  
  return {
    getItem: (key: string): string | null => {
      // Return from cache for synchronous access
      return electronCache[key] ?? null;
    },
    
    setItem: (key: string, value: string): void => {
      // Update cache immediately
      electronCache[key] = value;
      
      // Persist to Electron store asynchronously
      window.electronAPI!.store.set(key, value).catch(error => {
        console.error('Failed to persist to Electron store:', error);
      });
    }
  };
}

// Initialize Electron storage (call this early in app lifecycle)
export async function initializeElectronStorage(): Promise<void> {
  if (!isElectron()) return;
  await initializeCache();
}

// Get app info (version, paths, etc.)
export async function getElectronAppInfo() {
  if (!isElectron()) return null;
  return window.electronAPI!.getAppInfo();
}

// Print current page to PDF
export async function electronPrintToPDF(options?: object): Promise<Buffer | null> {
  if (!isElectron()) return null;
  return window.electronAPI!.printToPDF(options);
}
