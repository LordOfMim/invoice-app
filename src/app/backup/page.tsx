"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { FormPage } from "@/components/ui/FormLayout";
import { KeyFigures, KeyValueList, Page, PageHeader, Section, StatusNote } from "@/components/ui/Layout";
import { StatusPill } from "@/components/ui/Status";
import { t } from "@/lib/i18n";
import { todayLocalISO } from "@/lib/date";
import { flushElectronStoreSync, usePersistedData } from "@/lib/storage/useStore";
import { isElectron, saveTextFile } from "@/lib/storage/electronAdapter";
import { exportData, flushPendingPersist, importData, updateSettings } from "@/lib/storage/store";
import { Choice } from "@/components/ui/Field";
import { AUTO_BACKUP_INTERVAL_DAYS, backupAgeText, daysSinceBackup, markBackupDone, writeFolderBackup } from "@/lib/sessionTasks";

type RecoveryEntry = { id: string; label: string; createdAt: string; size: number; kind: "upgrade" | "last-good" | "recovery" | "automatic" };
type RecoveryStore = NonNullable<Window["electronAPI"]>["store"] & {
  listRecoveries?: () => Promise<RecoveryEntry[]>;
  getRecovery?: (id: string) => Promise<string>;
};

const noSubscribe = () => () => {};

export default function BackupPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const de = language === "de";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<"idle" | "success" | "error">("idle");
  const [exportWarning, setExportWarning] = useState("");
  const [exportMessage, setExportMessage] = useState<{ tone: "ok" | "info" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const reloadScheduled = useRef(false);
  const [recoveries, setRecoveries] = useState<RecoveryEntry[]>([]);
  const [recoveryLimit, setRecoveryLimit] = useState(20);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const desktop = useSyncExternalStore(noSubscribe, () => isElectron(), () => false);
  const [folder, setFolder] = useState<{ folder: string | null; available: boolean } | null>(null);
  const [folderMessage, setFolderMessage] = useState<{ tone: "ok" | "error" | "attention"; text: string } | null>(null);
  const backupAge = data ? daysSinceBackup(data.settings) : null;
  const autoBackup = data?.settings.backupEnabled === true;

  const loadFolder = useCallback(async () => {
    const api = window.electronAPI?.backup;
    if (!api) return;
    try {
      const result = await api.getFolder();
      setFolder({ folder: result.folder, available: result.available });
    } catch {
      setFolder({ folder: null, available: false });
    }
  }, []);
  useEffect(() => { if (desktop) void loadFolder(); }, [desktop, loadFolder]);

  const chooseFolder = async () => {
    const api = window.electronAPI?.backup;
    if (!api || !adapter || operation.current) return;
    operation.current = true;
    setBusy(true);
    setFolderMessage(null);
    try {
      const result = await api.chooseFolder();
      if (result.canceled) return;
      if (!result.ok) throw new Error(result.error || "Der Ordner konnte nicht übernommen werden.");
      setFolder({ folder: result.folder ?? null, available: result.available !== false });
      // Choosing a folder is the decision for automatic backups; the first one is written right away.
      updateSettings(adapter, (prev) => ({ ...prev, backupEnabled: true }));
      const written = await writeFolderBackup(adapter);
      setFolderMessage({ tone: "ok", text: `Automatische Sicherung eingerichtet. Erste Sicherung gespeichert${written.file ? `: ${written.file}` : ""}.` });
    } catch (error) {
      setFolderMessage({ tone: "error", text: error instanceof Error ? error.message : "Der Ordner konnte nicht übernommen werden." });
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };

  const backupNow = async () => {
    if (!adapter || operation.current) return;
    operation.current = true;
    setBusy(true);
    setFolderMessage(null);
    try {
      const written = await writeFolderBackup(adapter);
      setFolderMessage({ tone: "ok", text: `Sicherung gespeichert${written.file ? `: ${written.file}` : ""}.` });
    } catch (error) {
      setFolderMessage({ tone: "error", text: error instanceof Error ? error.message : "Die Sicherung ist fehlgeschlagen." });
      void loadFolder();
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };

  const openFolder = async () => {
    const result = await window.electronAPI?.backup?.openFolder();
    if (result && !result.ok) setFolderMessage({ tone: "error", text: result.error || "Der Ordner konnte nicht geöffnet werden." });
  };

  const stopAutoBackup = async () => {
    if (!adapter) return;
    updateSettings(adapter, (prev) => ({ ...prev, backupEnabled: false }));
    setFolderMessage({ tone: "attention", text: "Die automatische Sicherung ist ausgeschaltet. Vorhandene Sicherungsdateien bleiben im Ordner." });
  };

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
        await saveTextFile(`Helferlein-Sicherung-${name}.json`, "json", raw);
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
    setExportMessage(null);
    try {
      let persisted = false;
      try {
        const pending: unknown = await Promise.resolve(flushPendingPersist());
        if (pending !== false) persisted = await flushElectronStoreSync();
      } catch { /* A disk failure must not block rescuing the in-memory state. */ }
      const json = exportData(adapter);
      // The desktop app reports whether the file was really written; only then the backup counts as done.
      const outcome = await saveTextFile(`invoice-app-backup-${todayLocalISO()}.json`, "json", json);
      if (outcome === "canceled") {
        setExportMessage({ tone: "info", text: de ? "Nicht gespeichert. Es wurde keine Sicherungsdatei angelegt." : "Not saved. No backup file was created." });
        return;
      }
      // A browser only starts the download; it is noted as today's backup because the page cannot learn more.
      markBackupDone(adapter);
      setExportMessage(outcome === "saved"
        ? { tone: "ok", text: de ? "Die Sicherung wurde gespeichert." : "The backup was saved." }
        : { tone: "info", text: de ? "Die Datei wird heruntergeladen. Bitte prüfen Sie, ob sie im Download-Ordner angekommen ist." : "The file is being downloaded. Please check that it arrived in your downloads folder." });
      if (!persisted) setExportWarning(de
        ? "Die Speicherung der App-Daten ist nicht bestätigt. Die JSON-Sicherung enthält den aktuellen Stand aus dem Arbeitsspeicher. Bitte die Sicherungsdatei sicher aufbewahren und die App geöffnet lassen."
        : "Saving the app data could not be confirmed. The JSON backup contains the current in-memory state. Keep the downloaded file safe and leave the app open.");
    } catch {
      setExportMessage(null);
      setExportWarning(de ? "Die JSON-Sicherung konnte nicht gespeichert werden. Bitte die App geöffnet lassen und erneut versuchen." : "The JSON backup could not be saved. Leave the app open and try again.");
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
              { label: "Angebote", value: data?.quotes?.length ?? 0 },
              { label: t(language, "nav.customers"), value: data?.customers.length ?? 0 },
              { label: t(language, "nav.products"), value: data?.products.length ?? 0 },
              { label: t(language, "nav.creditNotes"), value: data?.creditNotes.length ?? 0 },
              { label: t(language, "nav.recurring"), value: data?.recurringInvoices.length ?? 0 },
              { label: de ? "Schlagwörter" : t(language, "nav.tags"), value: data?.tags.length ?? 0 },
            ]}
            className="lg:grid-cols-3"
          />
        </Section>

        {desktop && (
          <Section
            title="Automatische Sicherung"
            summary={`Helferlein speichert alle ${AUTO_BACKUP_INTERVAL_DAYS} Tage beim Öffnen der App eine Sicherungsdatei in einen Ordner Ihrer Wahl, am besten auf einem USB-Stick, einer externen Festplatte oder in einem Cloud-Ordner. Die letzten zwölf Sicherungen bleiben erhalten.`}
            actions={<StatusPill tone={autoBackup && folder?.available ? "success" : autoBackup ? "attention" : "muted"}>{autoBackup && folder?.available ? "Eingeschaltet" : autoBackup ? "Ordner nicht erreichbar" : "Ausgeschaltet"}</StatusPill>}
          >
            <KeyValueList
              variant="leader"
              items={[
                { label: "Sicherungsordner", value: folder?.folder ? <span className="break-all">{folder.folder}</span> : "Noch kein Ordner gewählt", hint: folder?.folder && !folder.available ? "Der Ordner ist gerade nicht erreichbar. Ist der Datenträger angeschlossen?" : undefined },
                { label: "Letzte Sicherung", value: backupAgeText(backupAge), hint: data?.settings.lastBackupDate ? `am ${new Date(`${data.settings.lastBackupDate.slice(0, 10)}T00:00:00`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}` : undefined },
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant={folder?.folder ? "secondary" : "primary"} disabled={busy} onClick={() => { void chooseFolder(); }}>{folder?.folder ? "Anderen Ordner wählen …" : "Ordner wählen und einschalten …"}</Button>
              {folder?.folder && <Button disabled={busy || !folder.available} onClick={() => { void backupNow(); }}>Jetzt sichern</Button>}
              {folder?.folder && <Button variant="ghost" disabled={!folder.available} onClick={() => { void openFolder(); }}>Ordner öffnen</Button>}
            </div>
            {folder?.folder && (
              <Choice
                label="Automatisch sichern"
                hint="Ausgeschaltet bleibt der Ordner gemerkt; Sie sichern dann nur noch von Hand."
                checked={autoBackup}
                disabled={busy}
                onChange={(e) => { if (!adapter) return; if (e.target.checked) { updateSettings(adapter, (prev) => ({ ...prev, backupEnabled: true })); setFolderMessage(null); } else void stopAutoBackup(); }}
              />
            )}
            {folderMessage && <StatusNote tone={folderMessage.tone} role={folderMessage.tone === "error" ? "alert" : "status"}>{folderMessage.text}</StatusNote>}
          </Section>
        )}

        <Section title={t(language, "backup.export")} summary={t(language, "backup.downloadDescription")}>
          <div><Button variant="primary" disabled={busy} onClick={() => { void handleExport(); }}>{de ? "Sicherung speichern (.json)" : `${t(language, "actions.export")} (.json)`}</Button></div>
          {exportMessage && <StatusNote tone={exportMessage.tone} role="status">{exportMessage.text}</StatusNote>}
          {exportWarning && <StatusNote tone="attention" role="alert">{exportWarning}</StatusNote>}
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
          <Section title={de ? "Lokale Wiederherstellungspunkte" : "Local recovery snapshots"} summary={de ? "Sicherungen vor Updates und Wiederherstellungen sowie zuletzt bestätigte Speicherstände. Sie können jede Sicherung zuerst als JSON-Datei speichern." : "Backups before updates and restores, plus confirmed recent snapshots. You can download any snapshot as JSON first."} actions={<Button disabled={busy} onClick={() => { void loadRecoveries(); }}>{de ? "Aktualisieren" : "Refresh"}</Button>}>
            {recoveries.length === 0 && <p className="font-sans text-base text-ink-muted">{de ? "Noch keine lokalen Wiederherstellungspunkte verfügbar." : "No local recovery snapshots available yet."}</p>}
            <ul className="divide-y divide-line rounded-card-sm bg-surface shadow-medium">
              {recoveries.slice(0, recoveryLimit).map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="break-words font-sans text-lg font-medium text-ink">{entry.label}</p>
                    <p className="font-sans text-base text-ink-muted">{new Date(entry.createdAt).toLocaleString(de ? "de-DE" : "en-US")} · {(entry.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={busy} onClick={() => { void handleRecovery(entry, false); }}>{de ? "Als JSON speichern" : "Save as JSON"}</Button>
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
