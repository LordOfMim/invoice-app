import type { StorageAdapter } from "@/lib/storage/types";

export function getBrowserLocalStorageAdapter(): StorageAdapter | null {
  if (typeof window === "undefined") return null;
  return {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
  };
}
