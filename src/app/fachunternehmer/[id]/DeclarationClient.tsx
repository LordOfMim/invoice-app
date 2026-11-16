"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { FormSection } from "@/components/ui/FormLayout";
import { Input } from "@/components/ui/Input";
import { Page, PageHeader, StatusNote } from "@/components/ui/Layout";
import { OverflowMenu } from "@/components/ui/Menu";
import { Textarea } from "@/components/ui/Textarea";
import { LetterPaper } from "@/components/LetterPaper";
import { PrintStyles } from "@/components/PrintStyles";
import { usePageCrumb } from "@/components/shell/AppShell";
import { formatDocumentDate, todayLocalISO } from "@/lib/date";
import { loadDeclarationDefaults, saveDeclarationDefaults } from "@/lib/declarationDefaults";
import type { ContractorDeclaration } from "@/lib/domain";
import { safeFilePart, savePrintAreaAsPdf } from "@/lib/pdf";
import { deleteDeclaration, updateDeclaration } from "@/lib/storage/store";
import type { StorageAdapter } from "@/lib/storage/types";
import { usePersistedData } from "@/lib/storage/useStore";

/**
 * One saved contractor declaration: the fields on the left are saved as they are typed, the sheet below is what
 * gets printed. Signature or stamp and the standard values for new declarations are shared by all declarations.
 */
export function DeclarationClient({ id }: { id: string }) {
  const { adapter, data } = usePersistedData();
  const declaration = useMemo(() => data?.contractorDeclarations?.find((entry) => entry.id === id) ?? null, [data?.contractorDeclarations, id]);
  usePageCrumb(declaration ? declaration.kommission || "Ohne Bauvorhaben" : null);

  if (!adapter || !data) return <Page><PageHeader title="Fachunternehmererklärung" /><p role="status">Erklärung wird geladen …</p></Page>;
  if (!declaration) {
    return (
      <Page>
        <PageHeader title="Erklärung nicht gefunden" description="Die Erklärung wurde gelöscht oder der Link ist veraltet." />
        <div><Link href="/fachunternehmer" className="font-sans text-lg font-medium tracking-snug text-link underline-offset-3 hover:underline">Zu allen Erklärungen</Link></div>
      </Page>
    );
  }
  const invoice = declaration.invoiceId ? data.invoices.find((entry) => entry.id === declaration.invoiceId) : undefined;
  return <DeclarationEditor adapter={adapter} declaration={declaration} invoice={invoice ? { id: invoice.id, number: invoice.invoiceNumber } : undefined} />;
}

function DeclarationEditor({ adapter, declaration, invoice }: { adapter: StorageAdapter; declaration: ContractorDeclaration; invoice?: { id: string; number: string } }) {
  const [signatureImage, setSignatureImage] = useState<string | null>(() => loadDeclarationDefaults(adapter).signatureImage);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const change = (patch: Partial<ContractorDeclaration>) => {
    setNotice(null);
    updateDeclaration(adapter, declaration.id, (prev) => ({ ...prev, ...patch }));
  };

  const storeDefaults = (next: Parameters<typeof saveDeclarationDefaults>[1], success: string) => {
    try {
      saveDeclarationDefaults(adapter, next);
      setNotice({ tone: "ok", text: success });
      return true;
    } catch {
      setNotice({ tone: "error", text: "Das konnte nicht gespeichert werden. Bitte die App geöffnet lassen und freien Speicher sowie Zugriffsrechte prüfen." });
      return false;
    }
  };

  const saveAsDefault = () => storeDefaults({
    senderAddress: declaration.senderAddress,
    recipientName: declaration.recipientName,
    recipientAddress: declaration.recipientAddress,
    kommission: "",
    signatureName: declaration.signatureName,
    signatureImage,
  }, "Absender, Empfänger und Unterschrift sind als Standard für neue Erklärungen gespeichert.");

  const setImage = (image: string | null) => {
    if (storeDefaults({ ...loadDeclarationDefaults(adapter), signatureImage: image }, image ? "Unterschrift gespeichert. Sie erscheint auf allen Erklärungen." : "Unterschrift entfernt.")) setSignatureImage(image);
  };

  const onPdf = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const result = await savePrintAreaAsPdf(`${safeFilePart(`Fachunternehmererklaerung ${declaration.kommission}`.trim(), "Fachunternehmererklaerung")}.pdf`);
      if (result.ok && result.message) setNotice({ tone: "ok", text: result.message });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Die PDF konnte nicht erstellt werden." });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Page className="invoice-editor">
      <PrintStyles />
      <PageHeader
        className="no-print"
        title="Fachunternehmererklärung"
        description={[declaration.kommission || "Ohne Bauvorhaben", declaration.recipientName.split("\n")[0], formatDocumentDate(declaration.date, "de-DE")].filter(Boolean).join(" · ")}
        meta={["Änderungen werden automatisch lokal gespeichert."]}
        actions={<>
          <Button variant="primary" loading={busy} onClick={() => { void onPdf(); }}>PDF speichern</Button>
          <LinkButton variant="ghost" href="/fachunternehmer">Alle Erklärungen</LinkButton>
          <OverflowMenu
            label="Weitere Aktionen"
            trigger="Weitere Aktionen"
            items={[
              { label: "Als Standard für neue Erklärungen speichern", onSelect: () => { saveAsDefault(); } },
              invoice ? { kind: "link", label: `Rechnung ${invoice.number || "ohne Nummer"} öffnen`, href: `/invoices/${invoice.id}` } : false,
              { kind: "separator" },
              { label: "Erklärung löschen …", tone: "danger", onSelect: () => setConfirmDelete(true) },
            ]}
          />
        </>}
      />
      {notice && <StatusNote tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"} className="no-print">{notice.text}</StatusNote>}

      <div className="no-print flex w-full max-w-[880px] flex-col gap-10">
        <FormSection title="Bauvorhaben und Empfänger" description="An wen die Erklärung geht und für welches Bauvorhaben sie gilt.">
          <Field label="Kommission und Bauvorhaben" className="@md:col-span-2">
            <Input value={declaration.kommission} placeholder="z. B. 90105 Berlin, Pohlstraße 40" onChange={(e) => change({ kommission: e.target.value })} />
          </Field>
          <Field label="Empfänger">
            <Textarea rows={3} value={declaration.recipientName} placeholder="Firma oder Name" onChange={(e) => change({ recipientName: e.target.value })} />
          </Field>
          <Field label="Adresse des Empfängers">
            <Textarea rows={3} value={declaration.recipientAddress} onChange={(e) => change({ recipientAddress: e.target.value })} />
          </Field>
          <Field label="Datum">
            <Input type="date" value={declaration.date} onChange={(e) => change({ date: e.target.value || todayLocalISO() })} />
          </Field>
        </FormSection>

        <FormSection title="Absender und Text" description="Steht so auf der Erklärung.">
          <Field label="Absenderzeile" className="@md:col-span-2">
            <Input value={declaration.senderAddress} placeholder="Firma · Straße · PLZ Ort" onChange={(e) => change({ senderAddress: e.target.value })} />
          </Field>
          <Field label="Text der Erklärung" className="@md:col-span-2">
            <Textarea rows={4} value={declaration.bodyText} onChange={(e) => change({ bodyText: e.target.value })} />
          </Field>
          <Field label="Name unter der Unterschrift">
            <Input value={declaration.signatureName} onChange={(e) => change({ signatureName: e.target.value })} />
          </Field>
          <Field label="Unterschrift oder Stempel (Bild)" hint="Gilt für alle Erklärungen.">
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="hidden"
                aria-label="Bilddatei für Unterschrift oder Stempel wählen"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ""; // allow choosing the same file again after removing it
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => { if (typeof reader.result === "string") setImage(reader.result); };
                  reader.onerror = () => setNotice({ tone: "error", text: "Die Bilddatei konnte nicht gelesen werden." });
                  reader.readAsDataURL(file);
                }}
              />
              <Button size="sm" onClick={() => fileInput.current?.click()}>{signatureImage ? "Anderes Bild wählen" : "Bild wählen"}</Button>
              {signatureImage && <Button size="sm" variant="ghost" onClick={() => setImage(null)}>Bild entfernen</Button>}
            </div>
          </Field>
        </FormSection>
      </div>

      <LetterPaper label="Vorschau der Erklärung, scrollbar">
        <p className="mb-8 text-xs text-zinc-500 underline underline-offset-2">{declaration.senderAddress}</p>

        <div className="mb-8">
          <p className="font-medium">An</p>
          <div className="mt-1 whitespace-pre-line">
            {declaration.recipientName}
            {"\n"}
            {declaration.recipientAddress}
          </div>
        </div>

        <div className="mb-6">
          <p className="font-medium">Kommission und BV</p>
          <p className="mt-1">{declaration.kommission}</p>
        </div>

        <p className="mb-8"><span className="font-medium">Datum</span> {formatDocumentDate(declaration.date, "de-DE")}</p>

        <h2 className="mb-6 text-lg font-semibold">Übereinstimmungs- / Fachunternehmererklärung</h2>

        <div className="mb-8 space-y-4">
          <p>Sehr geehrte Damen und Herren,</p>
          <p className="whitespace-pre-line">{declaration.bodyText}</p>
        </div>

        <div className="mt-auto flex items-end justify-between pt-12">
          <div>
            <p className="mb-8">Mit freundlichen Grüßen</p>
            <p className="font-medium">{declaration.signatureName}</p>
          </div>
          {signatureImage && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={signatureImage} alt="Unterschrift / Stempel" className="max-h-40 max-w-xs object-contain" />
          )}
        </div>
      </LetterPaper>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          deleteDeclaration(adapter, declaration.id);
          window.location.assign("/fachunternehmer");
        }}
        title="Erklärung löschen?"
        description="Die gespeicherte Erklärung wird endgültig entfernt."
        confirmLabel="Löschen"
        cancelLabel="Abbrechen"
        warningLabel="Das lässt sich nicht rückgängig machen."
        variant="danger"
      />
    </Page>
  );
}
