"use client";

import { Component, useRef, useState, type ReactNode } from "react";
import { parsePersistedData } from "@/lib/storage/store";
import { STORAGE_KEY } from "@/lib/storage/keys";
import { Button } from "@/components/ui/Button";

function RecoveryScreen() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);

  async function readOriginal() {
    const api = window.electronAPI?.store;
    const desktop = api ? await api.get(STORAGE_KEY) : null;
    return desktop ?? localStorage.getItem(STORAGE_KEY);
  }

  function originalBytes(original: unknown) {
    if (original === null || original === undefined) return null;
    if (typeof original === "string") return original;
    const serialized = JSON.stringify(original);
    if (serialized === undefined) throw new Error("Die Originaldaten lassen sich nicht sicher sichern. Wiederherstellung abgebrochen.");
    return serialized;
  }

  async function downloadOriginal() {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setMessage("");
    try {
      const original = originalBytes(await readOriginal());
      if (original === null) throw new Error("Keine lesbare Sicherung vorhanden.");
      const url = URL.createObjectURL(new Blob([original], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `Helferlein-Original-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setMessage("Die Originaldatei konnte nicht gelesen werden. Bitte den Helferlein-Datenordner sichern.");
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }

  async function restore(file?: File) {
    if (!file || operation.current) return;
    operation.current = true;
    setBusy(true);
    setMessage("");
    try {
      const raw = await file.text();
      if (!parsePersistedData(raw)) throw new Error("Diese Datei ist keine unterstützte Helferlein-Sicherung.");
      if (!window.confirm("Diese Sicherung wiederherstellen? Die bisherigen Originaldaten werden vorher zusätzlich gesichert.")) return;
      const original = originalBytes(await readOriginal());
      const recoveryKey = `${STORAGE_KEY}:recovery:${new Date().toISOString()}:before-recovery`;
      const api = window.electronAPI?.store as (NonNullable<Window["electronAPI"]>["store"] & { flush?: () => Promise<boolean> }) | undefined;
      if (api) {
        if (!api.flush) throw new Error("Die sichere Wiederherstellung ist noch nicht verfügbar. Bitte die App neu starten.");
        if (original !== null && await api.set(recoveryKey, original) !== true) {
          throw new Error("Die Sicherung der Originaldaten ist fehlgeschlagen. Es wurden keine Ersatzdaten geschrieben.");
        }
        // The original recovery copy must be durable before replacing the primary.
        if (await api.flush() !== true) throw new Error("Die Sicherung der Originaldaten konnte nicht bestätigt werden. Wiederherstellung abgebrochen.");
        if (await api.set(STORAGE_KEY, raw) !== true || await api.flush() !== true) {
          throw new Error("Die Wiederherstellung konnte nicht dauerhaft gespeichert werden. Die Sicherung der Originaldaten bleibt erhalten. Bitte die App geöffnet lassen.");
        }
      } else {
        if (original !== null) localStorage.setItem(recoveryKey, original);
        localStorage.setItem(STORAGE_KEY, raw);
      }
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wiederherstellung fehlgeschlagen. Es wurde keine erfolgreiche Speicherung bestätigt.");
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }

  return <main className="mx-auto flex max-w-[880px] flex-col gap-8 px-4 py-12 sm:px-8">
    <div className="flex flex-col gap-2">
      <h1 className="font-sans text-display font-semibold tracking-snug text-ink">Helferlein konnte die Daten nicht sicher öffnen</h1>
      <p className="max-w-[72ch] font-sans text-lg/6 tracking-snug text-ink-muted">Die vorhandenen Daten werden nicht durch einen leeren Datenbestand ersetzt. Sichern Sie zuerst das Original und stellen Sie anschließend eine bekannte JSON-Sicherung wieder her.</p>
    </div>
    <div><Button variant="primary" disabled={busy} onClick={() => { void downloadOriginal(); }}>Originaldaten sichern</Button></div>
    <label className="flex flex-col gap-2 font-sans text-base font-medium tracking-snug text-ink-secondary">JSON-Sicherung wiederherstellen
      <input type="file" disabled={busy} accept=".json,application/json" className="block w-full font-sans text-base text-ink-secondary file:mr-3 file:h-9 file:cursor-pointer file:rounded-md file:border file:border-line-control file:bg-surface file:px-3.5 file:font-sans file:text-base file:font-medium file:text-ink-secondary hover:file:bg-surface-subtle" onChange={(event) => { void restore(event.target.files?.[0]); event.target.value = ""; }} />
    </label>
    {busy && <p role="status" className="font-sans text-base text-ink-muted">Daten werden gelesen und gesichert …</p>}
    {message && <p role="alert" className="rounded-lg border border-danger/20 bg-danger/6 px-4 py-3 font-sans text-base tracking-snug text-danger">{message}</p>}
    <p className="font-sans text-base tracking-snug text-ink-muted">Auf dem Mac liegt der Datenordner unter Library / Application Support / Helferlein. Bei einer nicht lesbaren Datei bleibt diese am bisherigen Ort erhalten.</p>
  </main>;
}

export class StorageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <RecoveryScreen /> : this.props.children; }
}
