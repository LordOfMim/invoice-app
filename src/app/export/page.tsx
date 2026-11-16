"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/Button";
import { DataTable, PrimaryCell, type DataTableColumn } from "@/components/ui/DataTable";
import { Field } from "@/components/ui/Field";
import { FilterBar, FilterControl } from "@/components/ui/FormLayout";
import { Input } from "@/components/ui/Input";
import { EmptyState, KeyFigures, Page, PageHeader, StatusNote } from "@/components/ui/Layout";
import { Select } from "@/components/ui/Select";
import { PrintStyles } from "@/components/PrintStyles";
import { InvoicePreview } from "@/components/templates/InvoicePreview";
import { formatDay } from "@/components/invoiceStatus";
import { todayLocalISO } from "@/lib/date";
import type { Invoice } from "@/lib/domain";
import { formatMoney } from "@/lib/money";
import { safeFilePart } from "@/lib/pdf";
import { waitForInvoicePrintReady } from "@/lib/printing";
import { isElectron, saveTextFile } from "@/lib/storage/electronAdapter";
import { usePersistedData } from "@/lib/storage/useStore";
import { collectExportRows, customPeriod, exportCsv, periodFor, type ExportRow, type PeriodKind } from "@/lib/taxExport";

const noSubscribe = () => () => {};

/**
 * Export for the tax advisor: choose a period, check the list, then save the list alone (CSV for Excel) or, in the
 * desktop app, one ZIP file with the list and the PDF of every invoice. Corrections (Storno, Gutschrift) have no
 * printable sheet in the app, so they are rows of the list only; the page and the result message say so.
 */
export default function TaxExportPage() {
  const { data } = usePersistedData();
  const desktop = useSyncExternalStore(noSubscribe, () => isElectron() && !!window.electronAPI?.exportArchive, () => false);
  const today = todayLocalISO();
  const currency = data?.settings.currency ?? "EUR";

  const [kind, setKind] = useState<PeriodKind>("quarter");
  const [offset, setOffset] = useState(-1);
  const [from, setFrom] = useState(() => periodFor("quarter", today, -1).from);
  const [to, setTo] = useState(() => periodFor("quarter", today, -1).to);
  const period = useMemo(() => (kind === "custom" ? customPeriod(from, to) : periodFor(kind, today, offset)), [kind, offset, from, to, today]);

  const invoices = data?.invoices;
  const creditNotes = data?.creditNotes;
  const summary = useMemo(
    () => (period && invoices ? collectExportRows(invoices, creditNotes ?? [], period, currency, today) : null),
    [period, invoices, creditNotes, currency, today],
  );
  const rows = summary?.rows ?? [];
  const pdfCount = rows.filter((row) => row.invoice).length;
  const correctionCount = rows.length - pdfCount;
  const correctionsNote = correctionCount === 0 ? ""
    : correctionCount === 1 ? "Eine Korrektur (Storno oder Gutschrift) steht nur in der Liste; für sie gibt es keine PDF."
      : `${correctionCount} Korrekturen (Stornos und Gutschriften) stehen nur in der Liste; für sie gibt es keine PDFs.`;

  const [printing, setPrinting] = useState<Invoice | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error" | "attention" | "info"; text: string } | null>(null);
  const running = useRef(false);
  const cancelRequested = useRef(false);

  const baseName = `Helferlein-Export-${period?.fileLabel ?? "Zeitraum"}`;

  const saveList = async () => {
    if (!summary || running.current) return;
    running.current = true;
    setMessage(null);
    try {
      // The desktop app reports whether the file was written; a browser only starts a download.
      const outcome = await saveTextFile(`${baseName}.csv`, "csv", exportCsv(summary));
      setMessage(outcome === "saved" ? { tone: "ok", text: "Die Liste wurde als CSV-Datei gespeichert. Sie lässt sich in Excel oder Numbers öffnen." }
        : outcome === "canceled" ? { tone: "info", text: "Nicht gespeichert." }
          : { tone: "info", text: "Die Datei wird heruntergeladen. Sie lässt sich in Excel oder Numbers öffnen." });
    } catch (error) {
      setMessage({ tone: "error", text: `${error instanceof Error ? error.message : "Die Liste konnte nicht gespeichert werden."} Es wurde keine Datei gespeichert.` });
    } finally {
      running.current = false;
    }
  };

  const saveArchive = async () => {
    const api = window.electronAPI?.exportArchive;
    if (!api || !summary || running.current) return;
    running.current = true;
    cancelRequested.current = false;
    setMessage(null);
    let begun = false;
    try {
      const started = await api.begin(`${baseName}.zip`);
      if (started.canceled) return;
      if (!started.ok) throw new Error(started.error || "Der Export konnte nicht begonnen werden.");
      begun = true;
      const list = await api.addText("Rechnungsliste", "csv", exportCsv(summary));
      if (!list.ok) throw new Error(list.error || "Die Liste konnte nicht gespeichert werden.");

      const withPdf = summary.rows.filter((row): row is ExportRow & { invoice: Invoice } => !!row.invoice);
      setProgress({ done: 0, total: withPdf.length });
      for (const [index, row] of withPdf.entries()) {
        if (cancelRequested.current) throw new Error("__canceled__");
        // The sheet must be on the page before the desktop app prints it.
        flushSync(() => setPrinting(row.invoice));
        try {
          await waitForInvoicePrintReady();
        } catch (error) {
          throw new Error(`Rechnung ${row.number}: ${error instanceof Error ? error.message : "Die PDF konnte nicht erstellt werden."}`);
        }
        const added = await api.addPdf(safeFilePart(`${row.typeLabel} ${row.number}`, `Rechnung-${index + 1}`));
        if (!added.ok) throw new Error(`Rechnung ${row.number}: ${added.error || "Die PDF konnte nicht erstellt werden."}`);
        setProgress({ done: index + 1, total: withPdf.length });
      }
      const finished = await api.finish({ reveal: true });
      begun = false;
      if (!finished.ok) throw new Error(finished.error || "Der Export konnte nicht gespeichert werden.");
      setMessage({ tone: "ok", text: `Export gespeichert: ${finished.file ?? "ZIP-Datei"} mit der Liste und ${withPdf.length} ${withPdf.length === 1 ? "Rechnungs-PDF" : "Rechnungs-PDFs"}. Der Ordner wurde geöffnet.${correctionsNote ? ` ${correctionsNote}` : ""}` });
    } catch (error) {
      const canceled = error instanceof Error && error.message === "__canceled__";
      setMessage(canceled
        ? { tone: "attention", text: "Der Export wurde abgebrochen. Es wurde keine Datei gespeichert." }
        : { tone: "error", text: `${error instanceof Error ? error.message : "Der Export ist fehlgeschlagen."} Es wurde keine Datei gespeichert.` });
    } finally {
      if (begun) { try { await api.finish({ cancel: true }); } catch { /* nothing was written yet */ } }
      setPrinting(null);
      setProgress(null);
      running.current = false;
    }
  };

  const busy = progress !== null;
  const money = (value: number | null, rowCurrency = currency) => (value === null ? "" : formatMoney(value, rowCurrency, "de-DE"));
  const mixedCurrencies = new Set(rows.map((row) => row.currency)).size > 1;

  const columns: DataTableColumn<ExportRow>[] = [
    { key: "number", header: "Beleg", render: (row) => <PrimaryCell title={row.number} href={row.kind === "invoice" ? `/invoices/${row.id}` : `/credit-notes/${row.id}`} sub={row.typeLabel === "Rechnung" ? undefined : row.typeLabel} /> },
    { key: "date", header: "Datum", width: "7.5rem", render: (row) => <span className="tabular-nums">{formatDay(row.date, "de-DE")}</span> },
    {
      key: "customer",
      header: "Kunde",
      render: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="text-ink">{row.customer || "Ohne Empfänger"}</span>
          {(row.project || row.note) && <span className="font-sans text-base tracking-snug text-ink-muted">{[row.project, row.note].filter(Boolean).join(" · ")}</span>}
        </span>
      ),
    },
    { key: "net", header: "Netto", numeric: true, width: "8rem", render: (row) => money(row.net, row.currency) },
    { key: "tax", header: "USt", numeric: true, width: "7rem", render: (row) => money(row.tax, row.currency) },
    {
      key: "gross",
      header: "Brutto",
      numeric: true,
      width: "9rem",
      render: (row) => (
        <span className="flex flex-col items-end">
          <span className="font-semibold text-ink">{money(row.gross, row.currency)}</span>
          {row.deducted !== 0 && <span className="font-sans text-base text-ink-muted">zahlbar {money(row.payable, row.currency)}</span>}
        </span>
      ),
    },
    { key: "paid", header: "Bezahlt am", width: "8rem", render: (row) => row.kind === "credit" ? "" : row.paidOn ? <span className="tabular-nums">{formatDay(row.paidOn, "de-DE")}</span> : row.open !== null && row.open > 0 ? <span className="text-ink-muted">offen {money(row.open, row.currency)}</span> : <span className="text-ink-muted">bezahlt</span> },
  ];

  return (
    <Page className="invoice-editor">
      <PrintStyles />
      <PageHeader
        className="no-print"
        title="Export für die Steuer"
        description="Alle gestellten Rechnungen und Korrekturen eines Zeitraums für Steuerberatung oder Buchhaltung: als Liste für Excel und mit den PDFs der Rechnungen in einer ZIP-Datei."
        actions={<>
          {desktop && <Button variant="primary" loading={busy} disabled={busy || pdfCount === 0} onClick={() => { void saveArchive(); }}>{busy ? "Export läuft …" : "ZIP mit Liste und PDFs speichern"}</Button>}
          <Button variant={desktop ? "secondary" : "primary"} disabled={busy || rows.length === 0} onClick={() => { void saveList(); }}>Nur Liste speichern (CSV)</Button>
        </>}
      />

      <div className="no-print flex flex-col gap-4">
        <FilterBar label="Zeitraum wählen" aside={period ? <span>{period.label}</span> : undefined}>
          <FilterControl width="sm">
            <Field label="Zeitraum">
              <Select value={kind} disabled={busy} onChange={(e) => { setKind(e.target.value as PeriodKind); setOffset(-1); setMessage(null); }}>
                <option value="month">Monat</option>
                <option value="quarter">Quartal</option>
                <option value="year">Jahr</option>
                <option value="custom">Eigener Zeitraum</option>
              </Select>
            </Field>
          </FilterControl>
          {kind === "custom" ? (
            <>
              <FilterControl width="sm"><Field label="Von"><Input type="date" value={from} disabled={busy} onChange={(e) => { setFrom(e.target.value); setMessage(null); }} /></Field></FilterControl>
              <FilterControl width="sm"><Field label="Bis"><Input type="date" value={to} disabled={busy} onChange={(e) => { setTo(e.target.value); setMessage(null); }} /></Field></FilterControl>
            </>
          ) : (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Zeitraum wechseln">
              <Button disabled={busy} onClick={() => { setOffset((value) => value - 1); setMessage(null); }}>Früher</Button>
              <Button disabled={busy || offset >= 0} onClick={() => { setOffset((value) => Math.min(0, value + 1)); setMessage(null); }}>Später</Button>
              <Button variant="ghost" disabled={busy || offset === 0} onClick={() => { setOffset(0); setMessage(null); }}>{kind === "month" ? "Dieser Monat" : kind === "quarter" ? "Dieses Quartal" : "Dieses Jahr"}</Button>
            </div>
          )}
        </FilterBar>

        {message && <StatusNote tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>{message.text}</StatusNote>}
        {!period && <StatusNote tone="attention">Bitte ein gültiges Von- und Bis-Datum wählen. „Von“ darf nicht nach „Bis“ liegen.</StatusNote>}
        {progress && (
          <StatusNote tone="info" role="status" title={`PDF ${Math.min(progress.done + 1, progress.total)} von ${progress.total} wird erstellt …`} action={<Button size="sm" onClick={() => { cancelRequested.current = true; }}>Abbrechen</Button>}>
            Bitte das Fenster geöffnet lassen. {printing ? `Aktuell: ${printing.invoiceNumber}` : ""}
          </StatusNote>
        )}
        {summary && summary.skippedDrafts > 0 && (
          <StatusNote tone="info">{summary.skippedDrafts === 1 ? "Ein Entwurf ohne Rechnungsnummer liegt in diesem Zeitraum und wird nicht exportiert." : `${summary.skippedDrafts} Entwürfe ohne Rechnungsnummer liegen in diesem Zeitraum und werden nicht exportiert.`}</StatusNote>
        )}
        {desktop && rows.length > 0 && (
          <StatusNote tone="info" title="Was die ZIP-Datei enthält">
            Die Liste aller Belege und je Rechnung eine PDF. Die PDFs werden jetzt neu aus den gespeicherten Daten im heutigen Layout erstellt. Eine Rechnung, die mit einer älteren Version von Helferlein verschickt wurde, kann deshalb etwas anders aussehen als das Exemplar, das Ihr Kunde erhalten hat. Die Beträge stammen aus denselben gespeicherten Daten.
            {correctionsNote ? ` ${correctionsNote}` : ""}
          </StatusNote>
        )}
        {mixedCurrencies && <StatusNote tone="attention">Der Zeitraum enthält Belege in verschiedenen Währungen. Die Summen unten zählen die Beträge ungeachtet der Währung zusammen; in der Liste steht die Währung je Beleg.</StatusNote>}

        {summary && rows.length > 0 && (
          <KeyFigures
            items={[
              { label: "Belege", value: rows.length },
              { label: "Netto", value: money(summary.totals.net) },
              { label: "Umsatzsteuer", value: money(summary.totals.tax) },
              { label: "Brutto", value: money(summary.totals.gross) },
              { label: "Davon offen", value: money(summary.totals.open) },
            ]}
          />
        )}

        {data && period && rows.length === 0 ? (
          <EmptyState title="Keine Belege in diesem Zeitraum" description="Wählen Sie einen anderen Zeitraum. Exportiert werden Rechnungen mit Rechnungsnummer sowie Gutschriften und Stornos." />
        ) : (
          <DataTable caption={`Belege ${period?.label ?? ""}`} columns={columns} rows={rows} rowKey={(row) => `${row.kind}-${row.id}`} empty="Keine Belege." />
        )}
        {rows.length > 0 && (
          <p className="max-w-[90ch] font-sans text-base tracking-snug text-ink-muted">
            Die Summen zählen, was die Belege fordern: Schlussrechnungen mit ihrem Restbetrag (die Abschlagsrechnungen stehen als eigene Zeilen in der Liste), Gutschriften und Stornos mit negativem Betrag. Netto und Umsatzsteuer einer Korrektur werden im Verhältnis der korrigierten Rechnung aufgeteilt.
            {summary && summary.unsplitCorrections > 0 && ` Bei ${summary.unsplitCorrections === 1 ? "einer Korrektur" : `${summary.unsplitCorrections} Korrekturen`} fehlt die zugehörige Rechnung; ihr Betrag ist nur in der Brutto-Summe enthalten.`}
          </p>
        )}
      </div>

      {/* The one sheet the desktop app prints while the ZIP is built; shown small so the progress is visible. */}
      {printing && (
        <div className="invoice-preview-frame mt-6 max-h-80 overflow-hidden rounded-card-sm shadow-medium bg-surface-muted p-4" aria-hidden>
          <div id="invoice-preview" style={{ zoom: 0.35 }} className="print-area invoice-paper mx-auto min-h-[297mm] w-[210mm] bg-white p-[12mm]">
            <InvoicePreview invoice={printing} currency={printing.currency || currency} logoDataUrl={printing.logoDataUrl || data?.settings.defaultLogoDataUrl} />
          </div>
        </div>
      )}
    </Page>
  );
}
