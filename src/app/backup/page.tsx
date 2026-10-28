"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { FormPage } from "@/components/ui/FormLayout";
import { KeyFigures, Page, PageHeader, Section, StatusNote } from "@/components/ui/Layout";
import { StatusPill } from "@/components/ui/Status";
import { t } from "@/lib/i18n";
import { todayLocalISO } from "@/lib/date";
import { flushElectronStoreSync, usePersistedData } from "@/lib/storage/useStore";
import { isElectron } from "@/lib/storage/electronAdapter";
import { exportData, flushPendingPersist, importData } from "@/lib/storage/store";

type RecoveryEntry = { id: string; label: string; createdAt: string; size: number; kind: "upgrade" | "last-good" | "recovery" | "automatic" };
type RecoveryStore = NonNullable<Window["electronAPI"]>["store"] & {
  listRecoveries?: () => Promise<RecoveryEntry[]>;
  getRecovery?: (id: string) => Promise<string>;
};

function downloadJson(json: string, filename: string) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

const noSubscribe = () => () => {};

export default function BackupPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const de = language === "de";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<"idle" | "success" | "error">("idle");
  const [exportWarning, setExportWarning] = useState("");
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const reloadScheduled = useRef(false);
  const [recoveries, setRecoveries] = useState<RecoveryEntry[]>([]);
  const [recoveryLimit, setRecoveryLimit] = useState(20);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const desktop = useSyncExternalStore(noSubscribe, () => isElectron(), () => false);

  const loadRecoveries = useCallback(async () => {
    const api = window.electronAPI?.store as RecoveryStore | undefined;
    if (!api?.listRecoveries) return;
    try {
      setRecoveries(await api.listRecoveries());
      setRecoveryMessage("");
    } catch {
      setRecoveryMessage("Lokale Sicherungen konnten nicht gelesen werden. Vorhandene Dateien werden nicht verändert.");
    }
  }, []);

  useEffect(() => { if (desktop) void loadRecoveries(); }, [desktop, loadRecoveries]);

  async function importSnapshot(raw: string) {
    const pending: unknown = await Promise.resolve(flushPendingPersist());
    if (pending === false) throw new Error("Pending changes could not be prepared");
    const imported = await Promise.resolve(importData(adapter!, raw));
    if (imported !== true) throw new Error("Import or original-data backup failed");
    const prepared: unknown = await Promise.resolve(flushPendingPersist());
    if (prepared === false || await flushElectronStoreSync() !== true) throw new Error("Import persistence failed");
    setImportStatus("success");
    reloadScheduled.current = true;
    setTimeout(() => window.location.reload(), 1000);
  }

  async function handleRecovery(entry: RecoveryEntry, restore: boolean) {
    if (!adapter || operation.current) return;
    operation.current = true;
    setBusy(true);
    setRecoveryMessage("");
    try {
      const api = window.electronAPI?.store as RecoveryStore | undefined;
      if (!api?.getRecovery) throw new Error("Lokale Sicherungen sind noch nicht verfügbar. Bitte die App neu starten.");
      const raw = await api.getRecovery(entry.id);
      if (typeof raw !== "string") throw new Error("Die Sicherung enthält keine lesbaren JSON-Daten.");
      if (restore) {
        if (!window.confirm(`„${entry.label}“ wiederherstellen? Der aktuelle Stand wird vorher zusätzlich gesichert.`)) return;
        setImportStatus("idle");
        await importSnapshot(raw);
      } else {
        const name = entry.id.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
        downloadJson(raw, `Helferlein-Sicherung-${name}.json`);
      }
    } catch (error) {
      if (restore) setImportStatus("error");
      setRecoveryMessage(error instanceof Error ? error.message : "Die Sicherung konnte nicht gelesen oder wiederhergestellt werden.");
    } finally {
      if (!reloadScheduled.current) {
        operation.current = false;
        setBusy(false);
      }
    }
  }

  const handleExport = async () => {
    if (!adapter || operation.current) return;
    operation.current = true;
    setBusy(true);
    setExportWarning("");
    try {
      let persisted = false;
      try {
        const pending: unknown = await Promise.resolve(flushPendingPersist());
        if (pending !== false) persisted = await flushElectronStoreSync();
      } catch { /* A disk failure must not block rescuing the in-memory state. */ }
      const json = exportData(adapter);
      downloadJson(json, `invoice-app-backup-${todayLocalISO()}.json`);
      if (!persisted) setExportWarning(de
        ? "Die Speicherung der App-Daten ist nicht bestätigt. Die JSON-Sicherung enthält den aktuellen Stand aus dem Arbeitsspeicher. Bitte die heruntergeladene Datei sicher aufbewahren und die App geöffnet lassen."
        : "Saving the app data could not be confirmed. The JSON backup contains the current in-memory state. Keep the downloaded file safe and leave the app open.");
    } catch {
      setExportWarning(de ? "Die JSON-Sicherung konnte nicht erstellt werden. Bitte die App geöffnet lassen." : "The JSON backup could not be created. Leave the app open.");
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!adapter || !file || operation.current) return;
    operation.current = true;
    setBusy(true);
    setImportStatus("idle");
    try {
      const raw = await file.text();
      await importSnapshot(raw);
    } catch {
      setImportStatus("error");
    } finally {
      if (!reloadScheduled.current) {
        operation.current = false;
        setBusy(false);
      }
    }
  };

  return (
    <Page>
      <PageHeader title={de ? "Datensicherung" : t(language, "backup.title")} description={t(language, "backup.description")} />

      <FormPage>
        <Section title={t(language, "backup.dataInfo")}>
          <KeyFigures
            items={[
              { label: t(language, "nav.invoices"), value: data?.invoices.length ?? 0 },
              { label: t(language, "nav.customers"), value: data?.customers.length ?? 0 },
              { label: t(language, "nav.products"), value: data?.products.length ?? 0 },
              { label: t(language, "nav.creditNotes"), value: data?.creditNotes.length ?? 0 },
              { label: t(language, "nav.recurring"), value: data?.recurringInvoices.length ?? 0 },
              { label: de ? "Schlagwörter" : t(language, "nav.tags"), value: data?.tags.length ?? 0 },
            ]}
            className="lg:grid-cols-3"
          />
        </Section>

        <Section title={t(language, "backup.export")} summary={t(language, "backup.downloadDescription")}>
          <div><Button variant="primary" disabled={busy} onClick={() => { void handleExport(); }}>{de ? "Sicherung speichern (.json)" : `${t(language, "actions.export")} (.json)`}</Button></div>
          {exportWarning && <StatusNote tone="attention">{exportWarning}</StatusNote>}
        </Section>

        <Section title={t(language, "backup.import")} summary={t(language, "backup.restoreDescription")}>
          <StatusNote tone="attention">{t(language, "backup.replaceWarning")}</StatusNote>
          <Field label={de ? "Sicherungsdatei wählen" : "Choose backup file"} className="max-w-xl">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={handleImport}
              className="block w-full font-sans text-base text-ink-secondary file:mr-3 file:h-9 file:cursor-pointer file:rounded-md file:border file:border-line-control file:bg-surface file:px-3.5 file:font-sans file:text-base file:font-medium file:text-ink-secondary hover:file:bg-surface-subtle"
            />
          </Field>
          {busy && <p role="status" className="font-sans text-base text-ink-muted">{de ? "Daten werden gelesen und gesichert …" : "Reading and saving data …"}</p>}
          {importStatus === "success" && <StatusNote tone="ok">{t(language, "backup.importSuccess")}</StatusNote>}
          {importStatus === "error" && <StatusNote tone="error">{t(language, "backup.importError")}</StatusNote>}
        </Section>

        {desktop && (
          <Section title={de ? "Lokale Wiederherstellungspunkte" : "Local recovery snapshots"} summary={de ? "Sicherungen vor Updates und Wiederherstellungen sowie zuletzt bestätigte Speicherstände. Sie können jede Sicherung zuerst als JSON herunterladen." : "Backups before updates and restores, plus confirmed recent snapshots. You can download any snapshot as JSON first."} actions={<Button disabled={busy} onClick={() => { void loadRecoveries(); }}>{de ? "Aktualisieren" : "Refresh"}</Button>}>
            {recoveries.length === 0 && <p className="font-sans text-base text-ink-muted">{de ? "Noch keine lokalen Wiederherstellungspunkte verfügbar." : "No local recovery snapshots available yet."}</p>}
            <ul className="divide-y divide-line rounded-lg border border-line">
              {recoveries.slice(0, recoveryLimit).map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="break-words font-sans text-lg font-medium text-ink">{entry.label}</p>
                    <p className="font-sans text-base text-ink-muted">{new Date(entry.createdAt).toLocaleString(de ? "de-DE" : "en-US")} · {(entry.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={busy} onClick={() => { void handleRecovery(entry, false); }}>{de ? "JSON herunterladen" : "Download JSON"}</Button>
                    <Button size="sm" disabled={busy} onClick={() => { void handleRecovery(entry, true); }}>{de ? "Wiederherstellen …" : "Restore …"}</Button>
                  </div>
                </li>
              ))}
            </ul>
            {recoveries.length > recoveryLimit && <Button disabled={busy} onClick={() => setRecoveryLimit((limit) => limit + 20)}>{de ? "Weitere Sicherungen anzeigen" : "Show more snapshots"}</Button>}
            {recoveryMessage && <StatusNote tone="error">{recoveryMessage}</StatusNote>}
          </Section>
        )}

        <Section title={de ? "Sicherung bei Updates" : "Backup before updates"} summary={de ? "Die installierte App sichert den vorhandenen Datenbestand automatisch vor dem ersten Start einer neuen Version." : "The installed app automatically backs up existing data before first starting a new version."} actions={<StatusPill tone={desktop ? "success" : "muted"}>{desktop ? (de ? "Automatisch" : "Automatic") : (de ? "In der installierten App" : "In the installed app")}</StatusPill>} />

      </FormPage>
    </Page>
  );
}
