"use client";

import { useEffect, useState } from "react";

export function StorageStatus() {
  const [status, setStatus] = useState<"saving" | "saved" | "error">("saved");
  useEffect(() => window.electronAPI?.store.onStatus?.(setStatus), []);
  return <span role="status" aria-live="polite" className={`text-sm ${status === "error" ? "font-semibold text-red-700" : "text-zinc-600"}`}>
    {status === "saving" ? "Wird gespeichert …" : status === "error" ? "Speichern fehlgeschlagen – App geöffnet lassen" : "Lokal gespeichert · Offline nutzbar"}
  </span>;
}
