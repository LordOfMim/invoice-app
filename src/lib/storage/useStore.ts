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

function backupLocalData(value: string | null, reason: string) {
  if (!value || typeof window === "undefined") return;
  try {
    localStorage.setItem(recoveryKey(reason), value);
  } catch (err) {
    console.error("Failed to create local recovery copy:", err);
  }
}

async function backupElectronData(api: ElectronAPI, value: string | null, reason: string) {
  if (!value) return;
  try {
    await api.store.set(recoveryKey(reason), value);
  } catch (err) {
    console.error("Failed to create electron-store recovery copy:", err);
  }
}

function dataIsEmpty(raw: string | null): boolean {
  const data = parsePersistedData(raw);
  if (!data) return true;
  return (
    data.invoices.length === 0 &&
    data.customers.length === 0 &&
    data.products.length === 0 &&
    data.tags.length === 0 &&
    data.creditNotes.length === 0 &&
    data.recurringInvoices.length === 0 &&
    data.templateVariants.length === 0
  );
}

function dataFreshness(raw: string | null): number {
  const data = parsePersistedData(raw);
  if (!data) return 0;
  const dates = [
    data.settings.lastBackupDate,
    ...data.invoices.flatMap((item) => [item.createdAt, item.updatedAt]),
    ...data.customers.flatMap((item) => [item.createdAt, item.updatedAt]),
    ...data.products.flatMap((item) => [item.createdAt, item.updatedAt]),
    ...data.creditNotes.flatMap((item) => [item.createdAt, item.updatedAt]),
    ...data.recurringInvoices.flatMap((item) => [item.createdAt, item.updatedAt]),
    ...data.templateVariants.flatMap((item) => [item.createdAt, item.updatedAt]),
  ].filter(Boolean) as string[];
  return dates.reduce((latest, value) => Math.max(latest, Date.parse(value) || 0), 0);
}

async function writeElectronStore(value: string): Promise<boolean> {
  const api = getElectronAPI();
  if (!api) return false;

  const synced = await api.store.set(STORAGE_KEY, value);
  return synced;
}

// Load from electron-store on startup (only once)
let electronStoreLoaded = false;
async function loadFromElectronStore(): Promise<void> {
  if (!isElectron() || electronStoreLoaded) return;
  electronStoreLoaded = true;

  try {
    const api = getElectronAPI();
    if (!api) return;

    const electronData = await api.store.get(STORAGE_KEY);
    const electronRaw = typeof electronData === "string" ? electronData : null;
    const localRaw = localStorage.getItem(STORAGE_KEY);
    const electronParsed = parsePersistedData(electronRaw);
    const localParsed = parsePersistedData(localRaw);

    if (electronRaw && !electronParsed) {
      await backupElectronData(api, electronRaw, "invalid-electron");
    }
    if (localRaw && !localParsed) {
      backupLocalData(localRaw, "invalid-local");
    }

    if (electronParsed && !localParsed) {
      backupLocalData(localRaw, "before-electron-restore");
      localStorage.setItem(STORAGE_KEY, electronRaw!);
      clearDataCache();
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
      return;
    }

    if (!electronParsed && localParsed && localRaw) {
      await writeElectronStore(localRaw);
      return;
    }

    if (electronParsed && localParsed && electronRaw && localRaw && electronRaw !== localRaw) {
      const preferElectron =
        (dataIsEmpty(localRaw) && !dataIsEmpty(electronRaw)) ||
        (!dataIsEmpty(electronRaw) && dataFreshness(electronRaw) > dataFreshness(localRaw));

      if (preferElectron) {
        backupLocalData(localRaw, "before-electron-newer-restore");
        localStorage.setItem(STORAGE_KEY, electronRaw);
        clearDataCache();
        window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
      } else {
        await backupElectronData(api, electronRaw, "before-local-newer-sync");
        await writeElectronStore(localRaw);
      }
    }
  } catch (err) {
    console.error("Failed to load from electron-store:", err);
  }
}

export async function flushElectronStoreSync(): Promise<boolean> {
  if (!isElectron()) return true;

  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return false;

  try {
    return await writeElectronStore(data);
  } catch (err) {
    console.error("Failed to flush electron-store:", err);
    return false;
  }
}

// Create a wrapped adapter that syncs to electron-store
function createHybridAdapter(): StorageAdapter | null {
  const baseAdapter = getBrowserLocalStorageAdapter();
  if (!baseAdapter) return null;

  return {
    getItem: (key: string) => baseAdapter.getItem(key),
    setItem: (key: string, value: string) => {
      baseAdapter.setItem(key, value);
      void flushElectronStoreSync();
    },
  };
}

export function useStorageAdapter() {
  return useMemo(() => createHybridAdapter(), []);
}

export function usePersistedData() {
  const adapter = useStorageAdapter();
  const [electronReady, setElectronReady] = useState(false);

  const getSnapshot = () => {
    if (!adapter || !electronReady) return null;
    return loadData(adapter);
  };

  const data = useSyncExternalStore(
    (listener) => {
      if (!adapter) return () => {};
      return subscribe(listener);
    },
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
    (listener) => {
      if (!adapter) return () => {};
      return subscribe(listener);
    },
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
