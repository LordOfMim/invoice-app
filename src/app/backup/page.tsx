"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { t } from "@/lib/i18n";
import { todayLocalISO } from "@/lib/date";
import { flushElectronStoreSync, usePersistedData } from "@/lib/storage/useStore";
import { isElectron } from "@/lib/storage/electronAdapter";
import { exportData, flushPendingPersist, importData } from "@/lib/storage/store";
import { Surface, PageHeader, Section, Stack, Grid } from "@/components/ui/Surface";
import { Stat, Alert } from "@/components/ui/DataDisplay";

export default function BackupPage() {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<"idle" | "success" | "error">("idle");

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
      
      if (success) {
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      }
    };
    reader.onerror = () => setImportStatus("error");
    reader.readAsText(file);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const stats = {
    invoices: data?.invoices.length ?? 0,
    customers: data?.customers.length ?? 0,
    products: data?.products.length ?? 0,
    tags: data?.tags.length ?? 0,
    creditNotes: data?.creditNotes.length ?? 0,
    recurringInvoices: data?.recurringInvoices.length ?? 0,
  };

  const status =
    typeof window !== "undefined" && isElectron()
      ? t(language, "backup.electronMode")
      : t(language, "backup.browserMode");
  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-(--content-max-width)">
        <Stack gap="lg">
          <PageHeader
            title={t(language, "backup.title")}
            description={t(language, "backup.description")}
          />

          {/* Data Overview */}
          <Section title={t(language, "backup.dataInfo")}> 
            <Grid cols={3} gap="md">
              <Stat label={t(language, "nav.invoices")} value={stats.invoices} />
              <Stat label={t(language, "nav.customers")} value={stats.customers} />
              <Stat label={t(language, "nav.products")} value={stats.products} />
              <Stat label={t(language, "nav.tags")} value={stats.tags} />
              <Stat label={t(language, "nav.creditNotes")} value={stats.creditNotes} />
              <Stat label={t(language, "nav.recurring")} value={stats.recurringInvoices} />
            </Grid>
            <p className="mt-4 text-xs text-[var(--color-ink-subtle)]">
              {t(language, "backup.schemaVersion")}: {data?.schemaVersion ?? 1}
            </p>
          </Section>

          {/* Export */}
          <Section title={t(language, "backup.export")}> 
            <Surface variant="solid" padding="lg">
              <p className="text-sm text-[var(--color-ink-muted)]">
                {t(language, "backup.downloadDescription")}
              </p>
              <Button className="mt-4" variant="primary" onClick={handleExport}>
                {t(language, "actions.export")} (.json)
              </Button>
            </Surface>
          </Section>

          {/* Import */}
          <Section title={t(language, "backup.import")}> 
            <Surface variant="solid" padding="lg">
              <Stack gap="md">
                <div>
                  <p className="text-sm text-[var(--color-ink-muted)]">
                    {t(language, "backup.restoreDescription")}
                  </p>
                  <p className="mt-1 text-sm font-medium text-[var(--color-warning)]">
                    {t(language, "backup.replaceWarning")}
                  </p>
                </div>
                
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImport}
                  className="block w-full text-sm text-[var(--color-ink-muted)]
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-xl file:border-0
                    file:text-sm file:font-medium
                    file:bg-[var(--color-sand-100)] file:text-[var(--color-ink-muted)]
                    hover:file:bg-[var(--color-sand-200)]
                    cursor-pointer"
                />

                {importStatus === "success" && (
                  <Alert variant="success">{t(language, "backup.importSuccess")}</Alert>
                )}
                {importStatus === "error" && (
                  <Alert variant="danger">{t(language, "backup.importError")}</Alert>
                )}
              </Stack>
            </Surface>
          </Section>

          {/* Auto Backup Info */}
          <Section title={t(language, "backup.autoBackupElectron")}>
            <Surface variant="soft" padding="lg">
              <p className="text-sm text-[var(--color-ink-muted)]">
                {t(language, "backup.autoBackupDescription")}
              </p>
              <div className="mt-4 flex items-center gap-2 text-sm text-[var(--color-ink-subtle)]">
                <span>{t(language, "backup.status")}:</span>
                <span className="rounded-full bg-[var(--color-sand-200)] px-2.5 py-0.5 text-xs font-medium">
                  {status}
                </span>
              </div>
            </Surface>
          </Section>

          {/* Tips */}
          <Alert variant="info" title={t(language, "backup.tips")}>
            <ul className="mt-2 space-y-1.5 text-sm">
              <li>• {t(language, "backup.tipExportRegularly")}</li>
              <li>• {t(language, "backup.tipMultipleLocations")}</li>
              <li>• {t(language, "backup.tipIncludesData")}</li>
              <li>• {t(language, "backup.tipAttachments")}</li>
            </ul>
          </Alert>
        </Stack>
      </div>
    </main>
  );
}
