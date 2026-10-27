"use client";

import { Component, useState, type ReactNode } from "react";
import { parsePersistedData } from "@/lib/storage/store";
import { STORAGE_KEY } from "@/lib/storage/keys";
import { Button } from "@/components/ui/Button";

function RecoveryScreen() {
  const [message, setMessage] = useState("");

  function readOriginal() {
    const desktop = window.electronAPI?.store.getCached
      ? window.electronAPI.store.getCached(STORAGE_KEY)
      : null;
    return desktop ?? localStorage.getItem(STORAGE_KEY);
  }

  function originalBytes(original: unknown) {
    if (original === null || original === undefined) return null;
    if (typeof original === "string") return original;
    const serialized = JSON.stringify(original);
    if (serialized === undefined) throw new Error("Die Originaldaten lassen sich nicht sicher sichern. Wiederherstellung abgebrochen.");
    return serialized;
  }

  function downloadOriginal() {
    try {
      const original = originalBytes(readOriginal());
      if (original === null) throw new Error("Keine lesbare Sicherung vorhanden.");
      const url = URL.createObjectURL(new Blob([original], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `Helferlein-Original-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setMessage("Die Originaldatei konnte nicht gelesen werden. Bitte den Helferlein-Datenordner sichern.");
    }
  }

  async function restore(file?: File) {
    if (!file) return;
    try {
      const raw = await file.text();
      if (!parsePersistedData(raw)) throw new Error("Diese Datei ist keine unterstützte Helferlein-Sicherung.");
      if (!window.confirm("Diese Sicherung wiederherstellen? Die bisherigen Originaldaten werden vorher zusätzlich gesichert.")) return;
      const original = originalBytes(readOriginal());
      const recoveryKey = `${STORAGE_KEY}:recovery:${new Date().toISOString()}:before-recovery`;
      if (window.electronAPI?.store.setSync) {
        if (original !== null) window.electronAPI.store.setSync(recoveryKey, original);
        window.electronAPI.store.setSync(STORAGE_KEY, raw);
      } else {
        if (original !== null) localStorage.setItem(recoveryKey, original);
        localStorage.setItem(STORAGE_KEY, raw);
      }
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wiederherstellung fehlgeschlagen. Originaldaten bleiben erhalten.");
    }
  }

  return <main className="mx-auto max-w-2xl space-y-6 p-8">
    <h1 className="text-2xl font-semibold">Helferlein konnte die Daten nicht sicher öffnen</h1>
    <p>Die vorhandenen Daten werden nicht durch einen leeren Datenbestand ersetzt. Sichern Sie zuerst das Original und stellen Sie anschließend eine bekannte JSON-Sicherung wieder her.</p>
    <Button onClick={downloadOriginal}>Originaldaten sichern</Button>
    <label className="block space-y-3 font-medium">JSON-Sicherung wiederherstellen
      <input type="file" accept=".json,application/json" className="block w-full text-base" onChange={(event) => { void restore(event.target.files?.[0]); event.target.value = ""; }} />
    </label>
    {message && <p role="alert" className="text-red-700">{message}</p>}
    <p className="text-sm text-zinc-600">Auf dem Mac liegt der Datenordner unter Library / Application Support / Helferlein. Bei einer nicht lesbaren Datei bleibt diese am bisherigen Ort erhalten.</p>
  </main>;
}

export class StorageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <RecoveryScreen /> : this.props.children; }
}
