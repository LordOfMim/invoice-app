"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AppSettings } from "@/lib/domain";
import { getBrowserLocalStorageAdapter } from "@/lib/storage/localStorageAdapter";
import { clearDataCache, loadData, parsePersistedData, subscribe } from "@/lib/storage/store";
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

function recoveryKey(reason: string) {
  return `${RECOVERY_KEY_PREFIX}:${new Date().toISOString()}:${reason}`;
}

async function backupElectronData(api: ElectronAPI, value: string | null, reason: string) {
  if (!value) return;
  try {
    await api.store.set(recoveryKey(reason), value);
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
    const localRaw = localStorage.getItem(STORAGE_KEY);
    const electronParsed = parsePersistedData(electronRaw);
    const localParsed = parsePersistedData(localRaw);

    if (electronData != null && !electronParsed) {
      throw new Error("Die Desktop-Daten sind ungültig. Die Originaldaten bleiben unverändert; bitte eine Sicherung wiederherstellen.");
    }
    if (localRaw && !localParsed && !electronParsed) {
      throw new Error("Die lokalen Altdaten sind ungültig. Original bleibt erhalten.");
    }

    // Presence, not collection counts, determines authority. An intentionally
    // empty desktop snapshot must never resurrect stale browser invoices.
    if (electronParsed) {
      electronStoreLoaded = true;
      clearDataCache();
      return;
    }

    if (electronData == null && localParsed && localRaw) {
      await backupElectronData(api, localRaw, "before-local-migration");
      await writeElectronStore(localRaw);
      api.store.setSync?.(STORAGE_KEY, localRaw);
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
        const value = (api!.store.getCached ?? api!.store.getSync!)(key);
        return typeof value === "string" ? value : null;
      }
      return baseAdapter.getItem(key);
    },
    setItem: (key: string, value: string) => {
      if (key === STORAGE_KEY) {
        if (hasSyncElectronStore) {
          if (storageBlocked) throw storageBlocked;
          (api!.store.setCached ?? api!.store.setSync!)(key, value);
          return;
        }
        baseAdapter.setItem(key, value);
        if (!hasSyncElectronStore) {
          void flushElectronStoreSync(value);
        }
        return;
      }
      if (hasSyncElectronStore) {
        api!.store.setSync!(key, value);
        return;
      }
      baseAdapter.setItem(key, value);
    },
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
