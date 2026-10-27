"use client";

import { useEffect, useState } from "react";
import { StatusPill } from "@/components/ui/Status";
import type { Language } from "@/lib/domain";

/** Autosave state as a word plus dot (Platform outline StatusPill) in the top bar. Nothing to click: saving is automatic. */
export function StorageStatus({ language = "de" }: { language?: Language }) {
  const [status, setStatus] = useState<"saving" | "saved" | "error">("saved");
  useEffect(() => window.electronAPI?.store.onStatus?.(setStatus), []);
  const de = language === "de";
  const label = status === "saving"
    ? (de ? "Wird gespeichert …" : "Saving …")
    : status === "error"
      ? (de ? "Speichern fehlgeschlagen. App geöffnet lassen." : "Saving failed. Keep the app open.")
      : (de ? "Lokal gespeichert" : "Saved locally");
  return (
    <span role="status" aria-live="polite" title={de ? "Alle Eingaben werden automatisch auf diesem Gerät gespeichert. Offline nutzbar." : "Every input is saved automatically on this device. Works offline."}>
      <StatusPill tone={status === "error" ? "error" : status === "saving" ? "attention" : "success"} className={status === "error" ? "border-danger/40 text-danger" : undefined}>
        {label}
      </StatusPill>
    </span>
  );
}
