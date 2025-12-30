"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getBrowserLocalStorageAdapter } from "@/lib/storage/localStorageAdapter";
import { loadData, subscribe } from "@/lib/storage/store";

export function useStorageAdapter() {
  return useMemo(() => getBrowserLocalStorageAdapter(), []);
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

  // Ensure we initialize storage on first client render.
  useEffect(() => {
    if (!adapter) return;
    loadData(adapter);
  }, [adapter]);

  return { adapter, data };
}
