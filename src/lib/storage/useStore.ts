"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AppSettings } from "@/lib/domain";
import { getBrowserLocalStorageAdapter } from "@/lib/storage/localStorageAdapter";
import { clearDataCache, getCurrentData, loadData, parsePersistedData, primeDataCache, subscribe } from "@/lib/storage/store";
import { createDataPatches, type DataPatch } from "@/lib/storage/patches";
import type { StorageAdapter } from "@/lib/storage/types";
import { STORAGE_KEY } from "@/lib/storage/keys";

type ElectronAPI = {
  store: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<boolean>;
    onStatus?: (callback: (status: "saving" | "saved" | "error") => void) => () => void;
    getCached?: (key: string) => unknown;
    setCached?: (key: string, value: string) => boolean;
    getSync?: (key: string) => unknown;
    setSync?: (key: string, value: unknown) => boolean;
    applyPatches?: (patches: DataPatch[]) => boolean;
    flush?: () => Promise<boolean>;
  };
  platform?: string;
  isElectron: boolean;
};

// Check if running in Electron
function isElectron(): boolean {
  return typeof window !== "undefined" &&
    !!(window as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron;
}

// Get electron API safely
function getElectronAPI(): ElectronAPI | null {
  if (typeof window === "undefined") return null;
  return (window as { electronAPI?: ElectronAPI }).electronAPI ?? null;
}

const RECOVERY_KEY_PREFIX = `${STORAGE_KEY}:recovery`;
const AUX_KEY = "fachunternehmer-defaults";

function recoveryKey(reason: string) {
  return `${RECOVERY_KEY_PREFIX}:${new Date().toISOString()}:${reason}`;
}

async function backupElectronData(api: ElectronAPI, value: string | null, reason: string) {
  if (!value) return;
  try {
    if (await api.store.set(recoveryKey(reason), value) !== true) throw new Error("Originalsicherung nicht bestätigt.");
  } catch (err) {
    throw new Error("Sicherung der Desktop-Daten fehlgeschlagen", { cause: err });
  }
}

async function writeElectronStore(value: string): Promise<boolean> {
  const api = getElectronAPI();
  if (!api) return false;

  const synced = await api.store.set(STORAGE_KEY, value);
  return synced;
}

async function adoptAuxiliaryDefaults(api: ElectronAPI) {
  const nativeAux = await api.store.get(AUX_KEY);
  if (nativeAux !== undefined && nativeAux !== null && typeof nativeAux !== "string") throw new Error("Unbekannte Desktop-Standardwerte; Original bleibt erhalten.");
  if (nativeAux === undefined || nativeAux === null) {
    const oldAux = localStorage.getItem(AUX_KEY);
    if (oldAux !== null && await api.store.set(AUX_KEY, oldAux) !== true) throw new Error("Alte Standardwerte konnten nicht übernommen werden.");
  }
}

// Load from electron-store on startup (only once)
let electronStoreLoaded = false;
let electronLoadPromise: Promise<void> | null = null;
let storageBlocked: Error | null = null;
let electronWriteQueue: Promise<boolean> = Promise.resolve(true);
async function loadFromElectronStore(): Promise<void> {
  if (!isElectron() || electronStoreLoaded) return;
  if (electronLoadPromise) return electronLoadPromise;
  electronLoadPromise = reconcileElectronStore();
  return electronLoadPromise;
}

async function reconcileElectronStore(): Promise<void> {

  try {
    const api = getElectronAPI();
    if (!api) return;

    const electronData = api.store.getCached ? api.store.getCached(STORAGE_KEY) : await api.store.get(STORAGE_KEY);
    if (electronData != null && typeof electronData !== "string") throw new Error("Unbekanntes Desktop-Datenformat; Original bleibt erhalten.");
    const electronRaw = typeof electronData === "string" ? electronData : null;
    const electronParsed = parsePersistedData(electronRaw);

    if (electronData != null && !electronParsed) {
      throw new Error("Die Desktop-Daten sind ungültig. Die Originaldaten bleiben unverändert; bitte eine Sicherung wiederherstellen.");
    }
    // Presence, not collection counts, determines authority. An intentionally
    // empty desktop snapshot must never resurrect stale browser invoices.
    if (electronParsed) {
      // Only a cold bootstrap serializes the canonical migration once. Future
      // keystrokes send small patches; the background worker owns disk writes.
      if (api.store.applyPatches) {
        const canonical = JSON.stringify(electronParsed);
        if (canonical !== electronRaw) {
          await backupElectronData(api, electronRaw, "before-schema-adoption");
          if (!await writeElectronStore(canonical)) throw new Error("Migration konnte nicht sicher gespeichert werden.");
        }
      }
      await adoptAuxiliaryDefaults(api);
      electronStoreLoaded = true;
      clearDataCache();
      primeDataCache(electronParsed);
      return;
    }

    const localRaw = localStorage.getItem(STORAGE_KEY);
    const localParsed = parsePersistedData(localRaw);
    if (localRaw && !localParsed) throw new Error("Die lokalen Altdaten sind ungültig. Original bleibt erhalten.");

    if (electronData == null && localParsed && localRaw) {
      await backupElectronData(api, localRaw, "before-local-migration");
      const adopted = api.store.applyPatches ? JSON.stringify(localParsed) : localRaw;
      if (!await writeElectronStore(adopted)) throw new Error("Übernahme der lokalen Daten wurde nicht bestätigt.");
      if (!api.store.applyPatches) api.store.setSync?.(STORAGE_KEY, localRaw);
    }
    await adoptAuxiliaryDefaults(api);
    if (electronData == null && localParsed && localRaw) {
      clearDataCache();
      primeDataCache(localParsed);
    }
    electronStoreLoaded = true;
  } catch (err) {
    storageBlocked = err instanceof Error ? err : new Error(String(err));
    window.alert(`Daten konnten nicht sicher geladen werden. Es werden keine Daten überschrieben.\n${storageBlocked.message}`);
  }
}

export async function flushElectronStoreSync(value?: string): Promise<boolean> {
  if (!isElectron()) return true;

  if (storageBlocked) return false;
  const api = getElectronAPI();
  if (api?.store.flush) {
    try { return await api.store.flush(); }
    catch { return false; }
  }
  const data = value ?? (api?.store.getCached ? api.store.getCached(STORAGE_KEY) as string | null : localStorage.getItem(STORAGE_KEY));
  if (!data) return false;

  if (api?.store.setSync) {
    try {
      return api.store.setSync(STORAGE_KEY, data);
    } catch (err) {
      console.error("Failed to synchronously flush electron-store:", err);
      return false;
    }
  }

  electronWriteQueue = electronWriteQueue
    .catch(() => false)
    .then(() => writeElectronStore(data))
    .catch((err) => {
      console.error("Failed to flush electron-store:", err);
      return false;
    });

  return electronWriteQueue;
}

// Create a wrapped adapter that syncs to electron-store
function createHybridAdapter(): StorageAdapter | null {
  const baseAdapter = getBrowserLocalStorageAdapter();
  if (!baseAdapter) return null;
  const api = getElectronAPI();
  const hasSyncElectronStore = isElectron() && !!api?.store.getSync && !!api.store.setSync;

  return {
    getItem: (key: string) => {
      if (key === STORAGE_KEY && hasSyncElectronStore) {
        if (storageBlocked) throw storageBlocked;
        // This uncommon read is used for a pre-import recovery copy. Include
        // all accepted edits, not the stale bootstrap string in preload.
        const current = api!.store.applyPatches ? getCurrentData() : null;
        if (current) return JSON.stringify(current);
        const value = (api!.store.getCached ?? api!.store.getSync!)(key);
        return typeof value === "string" ? value : null;
      }
      if ((key === AUX_KEY || key.startsWith(`${RECOVERY_KEY_PREFIX}:`)) && hasSyncElectronStore) {
        const value = (api!.store.getCached ?? api!.store.getSync!)(key);
        return typeof value === "string" ? value : null;
      }
      return baseAdapter.getItem(key);
    },
    setItem: (key: string, value: string) => {
      if (key === STORAGE_KEY) {
        if (hasSyncElectronStore) {
          if (storageBlocked) throw storageBlocked;
          if ((api!.store.setCached ?? api!.store.setSync!)(key, value) !== true) throw new Error("Speichern wurde nicht angenommen.");
          return;
        }
        baseAdapter.setItem(key, value);
        if (!hasSyncElectronStore) {
          void flushElectronStoreSync(value);
        }
        return;
      }
      if ((key === AUX_KEY || key.startsWith(`${RECOVERY_KEY_PREFIX}:`)) && hasSyncElectronStore) {
        if (api!.store.setSync!(key, value) !== true) throw new Error("Speichern wurde nicht bestätigt.");
        return;
      }
      baseAdapter.setItem(key, value);
    },
    ...(hasSyncElectronStore && api?.store.applyPatches ? {
      persistData: (next, previous) => {
        if (storageBlocked) throw storageBlocked;
        if (!previous) {
          if ((api.store.setCached ?? api.store.setSync!)(STORAGE_KEY, JSON.stringify(next)) !== true) throw new Error("Speichern wurde nicht angenommen.");
          return;
        }
        const patches = createDataPatches(previous, next);
        if (patches.length && api.store.applyPatches!(patches) !== true) throw new Error("Änderungen konnten nicht vorgemerkt werden.");
      },
    } satisfies Partial<StorageAdapter> : {}),
  };
}

function subscribeStorage(adapter: StorageAdapter | null, listener: () => void) {
  if (!adapter || typeof window === "undefined") return () => {};

  const unsubscribe = subscribe(listener);
  const unsubscribeStatus = getElectronAPI()?.store.onStatus?.((status) => {
    window.dispatchEvent(new CustomEvent("invoice-storage-status", { detail: { status } }));
  });
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    if (isElectron()) return; // A browser-origin event must never replace native authority.
    clearDataCache();
    listener();
    void flushElectronStoreSync(event.newValue ?? undefined);
  };

  window.addEventListener("storage", onStorage);
  return () => {
    unsubscribe();
    unsubscribeStatus?.();
    window.removeEventListener("storage", onStorage);
  };
}

function subscribeClientReady(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  const timeoutId = window.setTimeout(listener, 0);
  return () => window.clearTimeout(timeoutId);
}

function useClientReady() {
  return useSyncExternalStore(
    subscribeClientReady,
    () => typeof window !== "undefined",
    () => false
  );
}

export function useStorageAdapter() {
  const clientReady = useClientReady();
  return useMemo(() => (clientReady ? createHybridAdapter() : null), [clientReady]);
}

export function usePersistedData() {
  const adapter = useStorageAdapter();
  const [electronReady, setElectronReady] = useState(false);

  const getSnapshot = () => {
    if (!adapter || !electronReady) return null;
    return loadData(adapter);
  };

  const data = useSyncExternalStore(
    (listener) => subscribeStorage(adapter, listener),
    getSnapshot,
    () => null
  );

  // Load from electron-store on first client render
  useEffect(() => {
    let cancelled = false;
    loadFromElectronStore().finally(() => {
      if (!cancelled) setElectronReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Ensure we initialize storage on first client render.
  useEffect(() => {
    if (!adapter || !electronReady) return;
    loadData(adapter);
  }, [adapter, electronReady]);

  return { adapter, data };
}

export function usePersistedSettings() {
  const adapter = useStorageAdapter();
  const [electronReady, setElectronReady] = useState(false);

  const settings = useSyncExternalStore(
    (listener) => subscribeStorage(adapter, listener),
    () => (adapter && electronReady ? loadData(adapter).settings : null),
    () => null
  ) as AppSettings | null;

  useEffect(() => {
    let cancelled = false;
    loadFromElectronStore().finally(() => {
      if (!cancelled) setElectronReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!adapter || !electronReady) return;
    loadData(adapter);
  }, [adapter, electronReady]);

  return { adapter, settings };
}
