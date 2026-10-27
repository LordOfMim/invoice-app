"use client";

import { useRef, useState, useSyncExternalStore } from "react";
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

const noSubscribe = () => () => {};

export default function BackupPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const de = language === "de";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<"idle" | "success" | "error">("idle");
  const desktop = useSyncExternalStore(noSubscribe, () => isElectron(), () => false);

  const handleExport = () => {
    if (!adapter) return;
    const json = exportData(adapter);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-app-backup-${todayLocalISO()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!adapter) return;
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const result = reader.result;
      if (typeof result !== "string") {
        setImportStatus("error");
        return;
      }
      let success = importData(adapter, result);
      if (success) {
        flushPendingPersist();
        success = await flushElectronStoreSync();
      }
      setImportStatus(success ? "success" : "error");
      if (success) setTimeout(() => window.location.reload(), 1000);
    };
    reader.onerror = () => setImportStatus("error");
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
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
          <div><Button variant="primary" onClick={handleExport}>{de ? "Sicherung speichern (.json)" : `${t(language, "actions.export")} (.json)`}</Button></div>
        </Section>

        <Section title={t(language, "backup.import")} summary={t(language, "backup.restoreDescription")}>
          <StatusNote tone="attention">{t(language, "backup.replaceWarning")}</StatusNote>
          <Field label={de ? "Sicherungsdatei wählen" : "Choose backup file"} className="max-w-xl">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImport}
              className="block w-full font-sans text-base text-ink-secondary file:mr-3 file:h-9 file:cursor-pointer file:rounded-md file:border file:border-line-control file:bg-surface file:px-3.5 file:font-sans file:text-base file:font-medium file:text-ink-secondary hover:file:bg-surface-subtle"
            />
          </Field>
          {importStatus === "success" && <StatusNote tone="ok">{t(language, "backup.importSuccess")}</StatusNote>}
          {importStatus === "error" && <StatusNote tone="error">{t(language, "backup.importError")}</StatusNote>}
        </Section>

        <Section title={de ? "Sicherung bei Updates" : "Backup before updates"} summary={de ? "Die installierte App sichert den vorhandenen Datenbestand automatisch vor dem ersten Start einer neuen Version." : "The installed app automatically backs up existing data before first starting a new version."} actions={<StatusPill tone={desktop ? "success" : "muted"}>{desktop ? (de ? "Automatisch" : "Automatic") : (de ? "In der installierten App" : "In the installed app")}</StatusPill>} />

      </FormPage>
    </Page>
  );
}
