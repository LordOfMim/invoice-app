import type { StorageAdapter } from "@/lib/storage/types";

// Type declaration for the Electron API exposed via preload
declare global {
  interface Window {
    electronAPI?: {
      store: {
        get: (key: string) => Promise<string | null>;
        set: (key: string, value: string) => Promise<boolean>;
        delete: (key: string) => Promise<boolean>;
        clear: () => Promise<boolean>;
      };
      getAppInfo: () => Promise<{ version: string; name: string; path: string }>;
      printToPDF: (options?: object) => Promise<Buffer | null>;
      platform: string;
      isElectron: boolean;
    };
  }
}

// Check if running in Electron
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
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
      const data = await window.electronAPI!.store.get('invoice-app-data');
      if (data) {
        electronCache['invoice-app-data'] = data;
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
