import { daysBetweenDateOnly, formatDocumentDate, isDateOnly, todayLocalISO } from "@/lib/date";
import { exportData, runDueRecurringInvoices, updateSettings, type RecurringRunResult } from "@/lib/storage/store";
import type { StorageAdapter } from "@/lib/storage/types";
import type { AppSettings } from "@/lib/domain";

/*
 * Work the app does by itself when it opens: create the recurring invoices that are due and write the weekly
 * backup. Results are shown as notices above the page. Pages are often opened by a full reload, so notices and the
 * "already tried today" marks live in sessionStorage and survive it; they end with the app session.
 */

export type SessionNotice = {
  id: string;
  tone: "ok" | "attention" | "error" | "info";
  title: string;
  text?: string;
  href?: string;
  linkLabel?: string;
};

const NOTICES_KEY = "helferlein:notices";
const BACKUP_TRIED_KEY = "helferlein:auto-backup-tried";
const HINT_SNOOZE_KEY = "helferlein:backup-hint-snoozed";

/** Days between automatic backups. */
export const AUTO_BACKUP_INTERVAL_DAYS = 7;
/** Age from which a missing backup is pointed out. */
export const BACKUP_HINT_AFTER_DAYS = 14;
const HINT_SNOOZE_DAYS = 7;
const BACKUP_HINT_ID = "backup-hint";

const listeners = new Set<() => void>();
let notices: SessionNotice[] | null = null;
const EMPTY: SessionNotice[] = [];

function read(storage: "sessionStorage" | "localStorage", key: string): string | null {
  try { return window[storage].getItem(key); } catch { return null; }
}
function write(storage: "sessionStorage" | "localStorage", key: string, value: string) {
  try { window[storage].setItem(key, value); } catch { /* notices are a convenience; the work itself is done */ }
}

function loadNotices(): SessionNotice[] {
  if (notices) return notices;
  if (typeof window === "undefined") return EMPTY;
  try {
    const parsed: unknown = JSON.parse(read("sessionStorage", NOTICES_KEY) ?? "[]");
    notices = Array.isArray(parsed) ? parsed.filter((entry): entry is SessionNotice => !!entry && typeof entry.id === "string" && typeof entry.title === "string") : [];
  } catch {
    notices = [];
  }
  return notices;
}

function publish(next: SessionNotice[]) {
  notices = next;
  write("sessionStorage", NOTICES_KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
}

export function subscribeNotices(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const getNotices = (): SessionNotice[] => loadNotices();
export const getServerNotices = (): SessionNotice[] => EMPTY;

export function addNotice(notice: SessionNotice) {
  publish([...loadNotices().filter((entry) => entry.id !== notice.id), notice]);
}

export function dismissNotice(id: string) {
  if (id === BACKUP_HINT_ID) write("localStorage", HINT_SNOOZE_KEY, todayLocalISO());
  publish(loadNotices().filter((entry) => entry.id !== id));
}

/** Whole days since the last backup; null when there never was one. */
export function daysSinceBackup(settings: Pick<AppSettings, "lastBackupDate">, today = todayLocalISO()): number | null {
  const last = settings.lastBackupDate?.slice(0, 10);
  return isDateOnly(last) ? Math.max(0, daysBetweenDateOnly(last, today)) : null;
}

/**
 * True when the automatic backup should run: there is none yet, the last one is `intervalDays` old, or its date
 * lies in the future. That happens when the clock was wrong once; waiting for that day would stop the backups.
 */
export function isAutoBackupDue(settings: Pick<AppSettings, "lastBackupDate">, today = todayLocalISO(), intervalDays = AUTO_BACKUP_INTERVAL_DAYS): boolean {
  const last = settings.lastBackupDate?.slice(0, 10);
  if (!isDateOnly(last)) return true;
  const age = daysBetweenDateOnly(last, today);
  return age < 0 || age >= intervalDays;
}

export function backupAgeText(days: number | null): string {
  if (days === null) return "Es gibt noch keine Sicherung.";
  if (days === 0) return "Letzte Sicherung: heute.";
  if (days === 1) return "Letzte Sicherung: gestern.";
  return `Letzte Sicherung vor ${days} Tagen.`;
}

/** Record a finished backup (manual or automatic) and drop the hint that asked for one. */
export function markBackupDone(adapter: StorageAdapter, today = todayLocalISO()) {
  updateSettings(adapter, (prev) => (prev.lastBackupDate === today ? prev : { ...prev, lastBackupDate: today }));
  if (loadNotices().some((entry) => entry.id === BACKUP_HINT_ID || entry.id === "backup-failed")) {
    publish(loadNotices().filter((entry) => entry.id !== BACKUP_HINT_ID && entry.id !== "backup-failed"));
  }
}

/** Write a backup into the chosen folder now. Throws with a message for the user when it fails. */
export async function writeFolderBackup(adapter: StorageAdapter): Promise<{ file?: string; folder?: string; missingFiles?: number }> {
  const api = window.electronAPI?.backup;
  if (!api) throw new Error("Die Sicherung in einen Ordner gibt es in der installierten Desktop-App.");
  const result = await api.write(exportData(adapter));
  if (!result.ok) throw new Error(result.error || "Die Sicherung ist fehlgeschlagen.");
  markBackupDone(adapter);
  return { file: result.file, folder: result.folder, missingFiles: result.missingFiles };
}

/**
 * The notice for what the automatic run did. It names every schedule where something other than "one invoice for
 * its date" happened: earlier dates were skipped, or the date already had its invoice and nothing was created.
 */
export function recurringNotice(runs: readonly RecurringRunResult[], id = `recurring-${Date.now()}`): SessionNotice | null {
  if (runs.length === 0) return null;
  const day = (value: string) => formatDocumentDate(value, "de-DE");
  const created = runs.flatMap((run) => run.invoices);
  const existing = runs.flatMap((run) => (run.existingInvoice ? [run.existingInvoice] : []));
  const details: string[] = [];
  for (const run of runs) {
    const name = run.recurring.name?.trim();
    if (run.existingInvoice) {
      details.push(`Für den ${day(run.runDate)} gab es bereits eine Rechnung aus ${name ? `„${name}“` : "einer wiederkehrenden Rechnung"}; es wurde keine weitere angelegt.`);
    } else if (run.skippedRuns > 0 && run.dueSince) {
      details.push(`${name ? `„${name}“` : "Eine wiederkehrende Rechnung"} war seit dem ${day(run.dueSince)} fällig. Helferlein hat nur die Rechnung für den ${day(run.runDate)} angelegt; frühere Termine wurden übersprungen.`);
    }
  }
  if (created.length === 0) {
    return {
      id,
      tone: "info",
      title: "Es wurde keine neue wiederkehrende Rechnung angelegt.",
      text: details.join(" "),
      href: existing.length === 1 ? `/invoices/${existing[0].id}` : "/invoices",
      linkLabel: existing.length === 1 ? "Vorhandene Rechnung öffnen" : "Zu den Rechnungen",
    };
  }
  const names = [...new Set(runs.filter((run) => run.invoices.length > 0 && run.skippedRuns === 0).map((run) => run.recurring.name?.trim()).filter(Boolean))].slice(0, 3).join(", ");
  return {
    id,
    tone: "info",
    title: created.length === 1 ? "Eine wiederkehrende Rechnung wurde als Entwurf angelegt." : `${created.length} wiederkehrende Rechnungen wurden als Entwurf angelegt.`,
    text: [names && `${names}.`, ...details, "Bitte prüfen, eine Rechnungsnummer vergeben und versenden."].filter(Boolean).join(" "),
    href: created.length === 1 ? `/invoices/${created[0].id}` : "/invoices",
    linkLabel: created.length === 1 ? "Rechnung öffnen" : "Zu den Rechnungen",
  };
}

function runRecurring(adapter: StorageAdapter) {
  const notice = recurringNotice(runDueRecurringInvoices(adapter));
  if (notice) addNotice(notice);
}

async function runBackup(adapter: StorageAdapter, settings: AppSettings, hasDocuments: boolean) {
  const today = todayLocalISO();
  const age = daysSinceBackup(settings, today);
  const api = window.electronAPI?.backup;

  if (api && settings.backupEnabled && isAutoBackupDue(settings, today)) {
    if (read("sessionStorage", BACKUP_TRIED_KEY) === today) return;
    write("sessionStorage", BACKUP_TRIED_KEY, today);
    try {
      await writeFolderBackup(adapter);
    } catch (error) {
      addNotice({
        id: "backup-failed",
        tone: "attention",
        title: "Die automatische Sicherung hat nicht geklappt.",
        text: `${error instanceof Error ? error.message : ""} ${backupAgeText(age)}`.trim(),
        href: "/backup",
        linkLabel: "Datensicherung öffnen",
      });
    }
    return;
  }

  if (!settings.backupEnabled && hasDocuments && (age === null || age >= BACKUP_HINT_AFTER_DAYS)) {
    const snoozed = read("localStorage", HINT_SNOOZE_KEY);
    if (isDateOnly(snoozed) && daysBetweenDateOnly(snoozed, today) < HINT_SNOOZE_DAYS) return;
    addNotice({
      id: BACKUP_HINT_ID,
      tone: "attention",
      title: backupAgeText(age),
      text: api
        ? "Ihre Rechnungen liegen nur auf diesem Gerät. Richten Sie die automatische Sicherung ein oder speichern Sie eine Sicherungsdatei."
        : "Ihre Rechnungen liegen nur auf diesem Gerät. Speichern Sie regelmäßig eine Sicherungsdatei.",
      href: "/backup",
      linkLabel: "Datensicherung öffnen",
    });
  }
}

let running = false;

/** Run once the data is loaded. Safe to call on every page load: each task checks by itself whether it is due. */
export async function runSessionTasks(adapter: StorageAdapter, settings: AppSettings, hasDocuments: boolean): Promise<void> {
  if (running || typeof window === "undefined") return;
  running = true;
  try {
    try { runRecurring(adapter); } catch { /* a broken schedule must not block the app; the recurring page shows it */ }
    await runBackup(adapter, settings, hasDocuments);
  } finally {
    running = false;
  }
}
