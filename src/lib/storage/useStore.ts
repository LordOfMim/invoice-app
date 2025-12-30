"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getBrowserLocalStorageAdapter } from "@/lib/storage/localStorageAdapter";
import { loadData, subscribe } from "@/lib/storage/store";
import type { StorageAdapter } from "@/lib/storage/types";
import { STORAGE_KEY } from "@/lib/storage/keys";

// Check if running in Electron
function isElectron(): boolean {
  return typeof window !== 'undefined' && 
    !!(window as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron;
}

// Get electron API safely
function getElectronAPI() {
  if (typeof window === 'undefined') return null;
  return (window as { electronAPI?: { 
    store: { 
      get: (key: string) => Promise<unknown>; 
      set: (key: string, value: unknown) => Promise<boolean>;
    };
    isElectron: boolean;
  } }).electronAPI ?? null;
}

// Sync localStorage to electron-store (debounced)
let syncTimeout: ReturnType<typeof setTimeout> | null = null;
function syncToElectronStore() {
  if (!isElectron()) return;
  
  // Debounce to avoid too many writes
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    try {
      const api = getElectronAPI();
      const data = localStorage.getItem(STORAGE_KEY);
      if (data && api) {
        await api.store.set(STORAGE_KEY, data);
      }
    } catch (err) {
      console.error('Failed to sync to electron-store:', err);
    }
  }, 500);
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
    if (data && typeof data === 'string') {
      // Only load from electron-store if localStorage is empty
      const localData = localStorage.getItem(STORAGE_KEY);
      if (!localData) {
        localStorage.setItem(STORAGE_KEY, data);
        // Trigger storage event for React to pick up
        window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
      }
    }
  } catch (err) {
    console.error('Failed to load from electron-store:', err);
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
    }
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
