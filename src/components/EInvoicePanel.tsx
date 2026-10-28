"use client";

import { useRef, useState, type ReactNode } from "react";
import type { EInvoiceDetails, EInvoiceParty, Invoice } from "@/lib/domain";
import { prepareEInvoice, type EInvoiceError, type EInvoiceFormat } from "@/lib/einvoice";
import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { Field } from "@/components/ui/Field";
import { FormPage } from "@/components/ui/FormLayout";
import { Input } from "@/components/ui/Input";
import { Card, CardZone, Section, StatusNote } from "@/components/ui/Layout";
import { Select } from "@/components/ui/Select";
import { StatusPill } from "@/components/ui/Status";
import { cn } from "@/components/platform/lib/cn";

type Props = {
  invoice: Invoice;
  onChange: (details: EInvoiceDetails) => void;
  onSaveDefaults: (details: EInvoiceDetails) => void;
  /** Check results; kept by the editor so they survive switching tabs. */
  errors: EInvoiceError[];
  onErrors: (errors: EInvoiceError[]) => void;
  /** Leads to the control behind a message (also outside this tab). */
  onJump: (field: string) => void;
  fieldId: (field: string) => string;
  /** Label of the editor tab where invoice basics are edited. */
  editTabLabel: string;
};
type Group = "seller" | "buyer" | "payment" | "tax" | "units";
type PartyField = [keyof EInvoiceParty, string, string?];

const address: PartyField[] = [
  ["street", "Straße und Hausnummer"],
  ["postalCode", "Postleitzahl"],
  ["city", "Ort"],
  ["countryCode", "Ländercode", "Zweistellig, für Deutschland: DE"],
];
const electronic: PartyField[] = [
  ["electronicAddress", "Elektronische Adresse", "Meist die E-Mail-Adresse für Rechnungen."],
  ["electronicAddressScheme", "Adressschema", "Für eine E-Mail-Adresse: EM"],
];
const partyFields: Record<"seller" | "buyer", { title: string; fields: PartyField[]; extra: { legend: string; hint?: string; fields: PartyField[] }[] }> = {
  seller: {
    title: "Ihre Angaben als Rechnungssteller",
    fields: [...address, ["vatId", "Umsatzsteuer-ID"], ["taxId", "Steuernummer", "Umsatzsteuer-ID oder Steuernummer ist erforderlich."]],
    extra: [
      { legend: "Ansprechpartner", hint: "Kontaktperson, Telefon und E-Mail werden für XRechnung benötigt.", fields: [["contactName", "Kontaktperson"], ["contactPhone", "Telefon"], ["email", "E-Mail"]] },
      { legend: "Elektronische Adresse", fields: electronic },
    ],
  },
  buyer: {
    title: "Rechnungsempfänger",
    fields: [...address, ["email", "E-Mail"], ["vatId", "Umsatzsteuer-ID"]],
    extra: [{ legend: "Elektronische Adresse", fields: electronic }],
  },
};

function groupOf(field: string): Group | null {
  if (field.startsWith("einvoice.seller.")) return "seller";
  if (field.startsWith("einvoice.buyer.") || field === "einvoice.buyerReference") return "buyer";
  if (["einvoice.paymentMeansCode", "einvoice.iban", "einvoice.bic", "einvoice.accountName", "einvoice.paymentTerms"].includes(field)) return "payment";
  if (["einvoice.serviceDate", "einvoice.taxCategory", "einvoice.taxExemptionReason"].includes(field)) return "tax";
  if (field.startsWith("einvoice.unitCodes.")) return "units";
  return null;
}

function filled(values: (string | undefined)[]) {
  return values.filter((value) => value?.trim()).length;
}

/**
 * E-Rechnung tab: structured details in collapsible groups (Overwatch `Disclosure`), then the two checked exports.
 * Nothing is saved unless the pinned validator succeeds (unchanged export path). Every message leads to its field.
 */
export function EInvoicePanel({ invoice, onChange, onSaveDefaults, errors, onErrors, onJump, fieldId, editTabLabel }: Props) {
  const details = invoice.einvoice ?? {};
  const [busy, setBusy] = useState<EInvoiceFormat | null>(null);
  const exportInFlight = useRef(false);
  const [busyDelivery, setBusyDelivery] = useState<"download" | "email">("download");
  const [success, setSuccess] = useState("");
  const [defaultsSaved, setDefaultsSaved] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<Group>>(() => new Set(errors.map((error) => groupOf(error.field)).filter((group): group is Group => group !== null)));
  const items = invoice.lineItems.filter((item) => item.type === "item");
  const errorFor = (field: string) => errors.find((error) => error.field === field)?.message;

  function change(key: keyof EInvoiceDetails, value: string) {
    onChange({ ...details, [key]: value });
    onErrors([]);
    setSuccess("");
  }

  function changeParty(side: "seller" | "buyer", key: keyof EInvoiceParty, value: string) {
    onChange({ ...details, [side]: { ...details[side], [key]: value } });
    onErrors([]);
    setSuccess("");
  }

  function setGroup(group: Group, isOpen: boolean) {
    setOpenGroups((previous) => {
      if (previous.has(group) === isOpen) return previous;
      const next = new Set(previous);
      if (isOpen) next.add(group);
      else next.delete(group);
      return next;
    });
  }

  // Opens the group holding the field first, so the editor can focus it.
  function jump(field: string) {
    const target = groupOf(field);
    if (target) setGroup(target, true);
    onJump(field);
  }

  function showErrors(next: EInvoiceError[]) {
    onErrors(next);
    const groups = next.map((error) => groupOf(error.field)).filter((group): group is Group => group !== null);
    if (groups.length) setOpenGroups((previous) => new Set([...previous, ...groups]));
    requestAnimationFrame(() => document.getElementById("einvoice-messages")?.focus());
  }

  async function exportInvoice(format: EInvoiceFormat, delivery: "download" | "email" = "download") {
    if (exportInFlight.current) return;
    setSuccess("");
    const result = prepareEInvoice(invoice, format);
    if (!result.ok || !result.document) {
      showErrors(result.errors);
      return;
    }
    const api = window.electronAPI as typeof window.electronAPI & {
      exportEInvoice?: (payload: object) => Promise<{ ok: boolean; prepared?: boolean; canceled?: boolean; error?: string }>;
    };
    if (!api?.exportEInvoice) {
      showErrors([{ field: "", message: "Der geprüfte E-Rechnungsexport ist in der installierten Desktop-App verfügbar." }]);
      return;
    }
    exportInFlight.current = true;
    setBusy(format);
    setBusyDelivery(delivery);
    onErrors([]);
    try {
      const exported = await api.exportEInvoice({
        format,
        document: result.document,
        delivery,
        email: delivery === "email" ? {
          to: details.buyer?.email || (details.buyer?.electronicAddressScheme === "EM" ? details.buyer.electronicAddress : "") || "",
          subject: `${invoice.texts.documentTitle || "Rechnung"} ${invoice.invoiceNumber}`.trim(),
          body: `Anbei erhalten Sie die E-Rechnung ${invoice.invoiceNumber}.\n\n${invoice.sender.name}`,
        } : undefined,
      });
      if (delivery === "email" && exported.ok && exported.prepared !== true) {
        showErrors([{ field: "", message: "Diese App-Version hat keinen E-Mailentwurf bestätigt. Bitte die aktuelle Desktop-App verwenden." }]);
        return;
      }
      if (exported.ok) setSuccess(delivery === "email"
        ? `${format === "zugferd" ? "ZUGFeRD-PDF" : "XRechnung-XML"} geprüft und als E-Mailentwurf vorbereitet. Bitte im E-Mailprogramm prüfen und selbst senden.`
        : `${format === "zugferd" ? "ZUGFeRD-PDF" : "XRechnung-XML"} geprüft und gespeichert.`);
      else if (!exported.canceled) showErrors([{ field: "", message: exported.error || "Die Datei konnte nicht erstellt werden." }]);
    } catch (error) {
      showErrors([{ field: "", message: error instanceof Error ? error.message : "Export fehlgeschlagen. Bitte erneut versuchen." }]);
    } finally {
      exportInFlight.current = false;
      setBusy(null);
    }
  }

  function group(id: Group, title: string, status: string, children: ReactNode) {
    const problems = errors.filter((message) => groupOf(message.field) === id).length;
    return (
      <Disclosure
        id={`einvoice-${id}`}
        title={title}
        open={openGroups.has(id)}
        onOpenChange={(isOpen) => setGroup(id, isOpen)}
        status={problems
          ? <StatusPill tone="error">{problems} {problems === 1 ? "Angabe" : "Angaben"} prüfen</StatusPill>
          : <span className="font-sans text-base font-normal tracking-snug text-ink-muted">{status}</span>}
        className="@container"
      >
        {children}
      </Disclosure>
    );
  }

  function partyInput(side: "seller" | "buyer", [key, label, hint]: PartyField) {
    const field = `einvoice.${side}.${key}`;
    return (
      <Field key={key} label={label} hint={hint} error={errorFor(field)} id={fieldId(field)} className={key === "street" ? "@lg:col-span-2" : ""}>
        <Input value={details[side]?.[key] ?? ""} onChange={(event) => changeParty(side, key, event.target.value)} />
      </Field>
    );
  }

  function partyGroup(side: "seller" | "buyer") {
    const config = partyFields[side];
    const all = [...config.fields, ...config.extra.flatMap((extra) => extra.fields)];
    const count = filled(all.map(([key]) => details[side]?.[key]));
    const name = side === "seller" ? invoice.sender.name : invoice.recipient.name;
    return group(side, config.title, count ? `${count} von ${all.length} Angaben` : "Noch nicht ausgefüllt", <>
      <p className="font-sans text-base tracking-snug text-ink-muted">
        {name
          ? <>Name aus der Rechnung: <span className="font-medium text-ink">{name}</span></>
          : <>Der Name fehlt noch. <button type="button" className="rounded-sm font-medium text-link underline-offset-3 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 outline-none" onClick={() => onJump(side)}>Im Tab „{editTabLabel}“ eintragen</button></>}
      </p>
      <div className="grid gap-4 @lg:grid-cols-2">{config.fields.map((field) => partyInput(side, field))}</div>
      {config.extra.map((extra) => (
        <fieldset key={extra.legend} className="flex flex-col gap-3">
          <legend className="mb-1 font-sans text-lg font-semibold tracking-snug text-ink">{extra.legend}</legend>
          {extra.hint && <p className="font-sans text-base tracking-snug text-ink-muted">{extra.hint}</p>}
          <div className="grid gap-4 @lg:grid-cols-2">{extra.fields.map((field) => partyInput(side, field))}</div>
        </fieldset>
      ))}
      {side === "buyer" && (
        <Field label="Käuferreferenz / Leitweg-ID" hint="Für XRechnung erforderlich. Bitte genau so übernehmen, wie der Empfänger sie mitgeteilt hat." error={errorFor("einvoice.buyerReference")} id={fieldId("einvoice.buyerReference")}>
          <Input value={details.buyerReference ?? ""} onChange={(event) => change("buyerReference", event.target.value)} />
        </Field>
      )}
    </>);
  }

  const paymentLabel = { "58": "SEPA-Überweisung", "30": "Überweisung", "10": "Barzahlung" }[details.paymentMeansCode ?? "58"];
  const unitCount = items.filter((item) => details.unitCodes?.[item.id]).length;

  return (
    <FormPage>
      <p className="max-w-[72ch] font-sans text-lg/6 tracking-snug text-ink-muted">
        Ergänzen Sie einmalig die strukturierten Angaben. Danach speichern Sie die Rechnung als PDF mit eingebetteten
        Rechnungsdaten oder als XML-Datei für Behörden. Ihre normale PDF-Rechnung bleibt unverändert.
      </p>

      <Section title="E-Rechnung speichern" summary="Die Datei wird vorher auf diesem Gerät geprüft. Fehlen Angaben, wird nichts gespeichert und Sie sehen hier, was zu ergänzen ist. Das ZUGFeRD-PDF verwendet ein festes Archivlayout mit den hier erfassten Adressen.">
        <Card className="@container">
          <CardZone className="grid gap-4 @lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Button className="w-full" loading={busy === "zugferd" && busyDelivery === "download"} disabled={busy !== null} onClick={() => exportInvoice("zugferd")}>{busy === "zugferd" && busyDelivery === "download" ? "Wird geprüft …" : "ZUGFeRD-PDF speichern"}</Button>
              <p className="font-sans text-base tracking-snug text-ink-muted">Lesbares PDF mit eingebetteten Rechnungsdaten.</p>
              <Button className="w-full" loading={busy === "zugferd" && busyDelivery === "email"} disabled={busy !== null} onClick={() => exportInvoice("zugferd", "email")}>ZUGFeRD-PDF per E-Mail vorbereiten</Button>
            </div>
            <div className="flex flex-col gap-2">
              <Button className="w-full" loading={busy === "xrechnung" && busyDelivery === "download"} disabled={busy !== null} onClick={() => exportInvoice("xrechnung")}>{busy === "xrechnung" && busyDelivery === "download" ? "Wird geprüft …" : "XRechnung-XML speichern"}</Button>
              <p className="font-sans text-base tracking-snug text-ink-muted">Eigenständige XML-Datei mit Käuferreferenz, bei Behörden meist die Leitweg-ID.</p>
              <Button className="w-full" loading={busy === "xrechnung" && busyDelivery === "email"} disabled={busy !== null} onClick={() => exportInvoice("xrechnung", "email")}>XRechnung-XML per E-Mail vorbereiten</Button>
            </div>
          </CardZone>
        </Card>
        <div id="einvoice-messages" tabIndex={-1} className="outline-none">
          {errors.length > 0 && (
            <StatusNote tone="error" title="Bitte diese Angaben prüfen. Ihre Eingaben bleiben erhalten.">
              <ul className="mt-1 flex flex-col gap-1">
                {errors.map((message, index) => (
                  <li key={index}>
                    {message.field ? (
                      <button type="button" onClick={() => jump(message.field)} className={cn("rounded-sm text-left underline underline-offset-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50")}>
                        {message.message}
                      </button>
                    ) : message.message}
                  </li>
                ))}
              </ul>
            </StatusNote>
          )}
          {success && <StatusNote tone="ok">{success}</StatusNote>}
        </div>
      </Section>

      <Section title="Angaben für die E-Rechnung" summary="Gruppen mit fehlenden Angaben öffnen sich nach der Prüfung von selbst.">
        <div className="flex flex-col gap-8">
          {partyGroup("seller")}
          {partyGroup("buyer")}
          {group("payment", "Zahlung und Bankverbindung", details.iban ? `${paymentLabel}, IBAN eingetragen` : paymentLabel, (
            <div className="grid gap-4 @lg:grid-cols-2">
              <Field label="Zahlungsart" error={errorFor("einvoice.paymentMeansCode")} id={fieldId("einvoice.paymentMeansCode")}>
                <Select value={details.paymentMeansCode ?? "58"} onChange={(event) => change("paymentMeansCode", event.target.value)}>
                  <option value="58">SEPA-Überweisung</option><option value="30">Überweisung</option><option value="10">Barzahlung</option>
                </Select>
              </Field>
              <Field label="Kontoinhaber" id={fieldId("einvoice.accountName")}><Input value={details.accountName ?? ""} onChange={(event) => change("accountName", event.target.value)} /></Field>
              <Field label="IBAN" hint={details.paymentMeansCode === "10" ? "Bei Barzahlung nicht erforderlich." : "Ohne Leerzeichen, beginnend mit dem Ländercode."} error={errorFor("einvoice.iban")} id={fieldId("einvoice.iban")}>
                <Input value={details.iban ?? ""} onChange={(event) => change("iban", event.target.value)} />
              </Field>
              <Field label="BIC (optional)" id={fieldId("einvoice.bic")}><Input value={details.bic ?? ""} onChange={(event) => change("bic", event.target.value)} /></Field>
              <Field label="Zahlungsbedingungen" className="@lg:col-span-2" id={fieldId("einvoice.paymentTerms")}><Input value={details.paymentTerms ?? ""} onChange={(event) => change("paymentTerms", event.target.value)} /></Field>
            </div>
          ))}
          {group("tax", "Leistungsdatum und Steuer", details.serviceDate || details.taxCategory ? "Angaben eingetragen" : "Nur bei Bedarf", (
            <div className="grid gap-4 @lg:grid-cols-2">
              <Field label="Leistungsdatum" error={errorFor("einvoice.serviceDate")} id={fieldId("einvoice.serviceDate")}>
                <Input type="date" value={details.serviceDate ?? ""} onChange={(event) => change("serviceDate", event.target.value)} />
              </Field>
              <Field label="Steuerkategorie bei 0 % Steuer" hint="Nur nötig, wenn eine Position ohne Umsatzsteuer berechnet wird." error={errorFor("einvoice.taxCategory")} id={fieldId("einvoice.taxCategory")}>
                <Select value={details.taxCategory ?? ""} onChange={(event) => change("taxCategory", event.target.value)}>
                  <option value="">Keine Angabe</option><option value="Z">Nullsteuersatz</option><option value="E">Steuerbefreit</option>
                  <option value="AE">Reverse Charge</option><option value="K">Innergemeinschaftliche Lieferung</option><option value="G">Ausfuhr</option><option value="O">Nicht steuerbar</option>
                </Select>
              </Field>
              <Field label="Begründung der Steuerbefreiung" className="@lg:col-span-2" error={errorFor("einvoice.taxExemptionReason")} id={fieldId("einvoice.taxExemptionReason")}>
                <Input value={details.taxExemptionReason ?? ""} onChange={(event) => change("taxExemptionReason", event.target.value)} />
              </Field>
            </div>
          ))}
          {group("units", "Einheiten der Positionen", unitCount ? `${unitCount} von ${items.length} angepasst` : "Automatisch erkannt", (
            items.length === 0
              ? <p className="font-sans text-base tracking-snug text-ink-muted">Noch keine Positionen vorhanden.</p>
              : <>
                <p className="font-sans text-base tracking-snug text-ink-muted">Die Einheit wird aus der Position übernommen. Nur ändern, wenn die Prüfung eine Einheit bemängelt.</p>
                <div className="flex flex-col gap-3">
                  {items.map((item, index) => {
                    const field = `einvoice.unitCodes.${item.id}`;
                    return (
                      <Field key={item.id} label={`${index + 1}. ${item.description || "Position ohne Beschreibung"}`} error={errorFor(field)} id={fieldId(field)}>
                        <Select value={details.unitCodes?.[item.id] ?? ""} onChange={(event) => { onChange({ ...details, unitCodes: { ...details.unitCodes, [item.id]: event.target.value || undefined } as Record<string, string> }); onErrors([]); }}>
                          <option value="">Automatisch aus „{item.unit || "Stück"}“</option><option value="C62">Stück</option><option value="HUR">Stunde</option><option value="DAY">Tag</option><option value="MON">Monat</option><option value="MTR">Meter</option><option value="MTK">Quadratmeter</option><option value="MTQ">Kubikmeter</option><option value="KGM">Kilogramm</option><option value="LTR">Liter</option><option value="KMT">Kilometer</option>
                        </Select>
                      </Field>
                    );
                  })}
                </div>
              </>
          ))}
        </div>
      </Section>

      <Section title="Für neue Rechnungen merken" summary="Merkt sich Ihre Angaben als Rechnungssteller, die Bankverbindung und die Steuerangaben. Empfängerdaten werden nicht übernommen.">
        <div className="flex flex-col items-start gap-3">
          <Button onClick={() => {
            const { seller, paymentMeansCode, iban, bic, accountName, paymentTerms, taxCategory, taxExemptionReason } = details;
            onSaveDefaults({ seller, paymentMeansCode, iban, bic, accountName, paymentTerms, taxCategory, taxExemptionReason });
            setDefaultsSaved(true);
          }}>Als Vorgabe für neue Rechnungen merken</Button>
          {defaultsSaved && <StatusNote tone="ok">Ihre Angaben als Rechnungssteller und die Zahlungsdaten werden für neue Rechnungen übernommen.</StatusNote>}
        </div>
      </Section>
    </FormPage>
  );
}
