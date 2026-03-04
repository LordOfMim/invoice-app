"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { AppSettings } from "@/lib/domain";
import { getBrowserLocalStorageAdapter } from "@/lib/storage/localStorageAdapter";
import { loadData, subscribe } from "@/lib/storage/store";
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

// Sync localStorage to electron-store (debounced)
const ELECTRON_SYNC_DEBOUNCE_MS = 1500;
let syncTimeout: ReturnType<typeof setTimeout> | null = null;
let lastSyncedValue: string | null = null;

function runWhenIdle(task: () => void) {
  if (typeof window === "undefined") {
    task();
    return;
  }

  const win = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };

  if (typeof win.requestIdleCallback === "function") {
    win.requestIdleCallback(task, { timeout: 2000 });
  } else {
    setTimeout(task, 0);
  }
}

function syncToElectronStore() {
  if (!isElectron()) return;

  if (syncTimeout) clearTimeout(syncTimeout);

  syncTimeout = setTimeout(async () => {
    runWhenIdle(async () => {
      try {
        const api = getElectronAPI();
        const data = localStorage.getItem(STORAGE_KEY);
        if (!api || !data || data === lastSyncedValue) return;

        const synced = await api.store.set(STORAGE_KEY, data);
        if (synced) {
          lastSyncedValue = data;
        }
      } catch (err) {
        console.error("Failed to sync to electron-store:", err);
      }
    });
  }, ELECTRON_SYNC_DEBOUNCE_MS);
}

// Load from electron-store on startup (only once)
let electronStoreLoaded = false;
async function loadFromElectronStore(): Promise<void> {
  if (!isElectron() || electronStoreLoaded) return;
  electronStoreLoaded = true;

  try {
    const api = getElectronAPI();
    if (!api) return;

    const data = await api.store.get(STORAGE_KEY);
    if (data && typeof data === "string") {
      // Only load from electron-store if localStorage is empty
      const localData = localStorage.getItem(STORAGE_KEY);
      if (!localData) {
        localStorage.setItem(STORAGE_KEY, data);
        lastSyncedValue = data;
        // Trigger storage event for React to pick up
        window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
      }
    }
  } catch (err) {
    console.error("Failed to load from electron-store:", err);
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
      syncToElectronStore();
    },
  };
}

export function useStorageAdapter() {
  return useMemo(() => createHybridAdapter(), []);
}

export function usePersistedData() {
  const adapter = useStorageAdapter();

  const getSnapshot = () => {
    if (!adapter) return null;
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
    loadFromElectronStore();
  }, []);

  // Ensure we initialize storage on first client render.
  useEffect(() => {
    if (!adapter) return;
    loadData(adapter);
  }, [adapter]);

  return { adapter, data };
}

export function usePersistedSettings() {
  const adapter = useStorageAdapter();

  const settings = useSyncExternalStore(
    (listener) => {
      if (!adapter) return () => {};
      return subscribe(listener);
    },
    () => (adapter ? loadData(adapter).settings : null),
    () => null
  ) as AppSettings | null;

  useEffect(() => {
    loadFromElectronStore();
  }, []);

  useEffect(() => {
    if (!adapter) return;
    loadData(adapter);
  }, [adapter]);

  return { adapter, settings };
}
