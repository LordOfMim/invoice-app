"use client";

import { useState, type ReactNode } from "react";
import type { EInvoiceDetails, EInvoiceParty, Invoice } from "@/lib/domain";
import { prepareEInvoice, type EInvoiceError, type EInvoiceFormat } from "@/lib/einvoice";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

type Props = { invoice: Invoice; onChange: (details: EInvoiceDetails) => void; onSaveDefaults: (details: EInvoiceDetails) => void };
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

export function EInvoicePanel({ invoice, onChange, onSaveDefaults }: Props) {
  const details = invoice.einvoice ?? {};
  const [busy, setBusy] = useState<EInvoiceFormat | null>(null);
  const [messages, setMessages] = useState<EInvoiceError[]>([]);
  const [success, setSuccess] = useState("");
  const [open, setOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<Group>>(() => new Set());
  const invalid = new Set(messages.map((message) => message.field));
  const items = invoice.lineItems.filter((item) => item.type === "item");

  function change(key: keyof EInvoiceDetails, value: string) {
    onChange({ ...details, [key]: value });
    setMessages([]);
    setSuccess("");
  }

  function changeParty(side: "seller" | "buyer", key: keyof EInvoiceParty, value: string) {
    onChange({ ...details, [side]: { ...details[side], [key]: value } });
    setMessages([]);
    setSuccess("");
  }

  function toggleGroup(group: Group, isOpen: boolean) {
    setOpenGroups((previous) => {
      if (previous.has(group) === isOpen) return previous;
      const next = new Set(previous);
      if (isOpen) next.add(group);
      else next.delete(group);
      return next;
    });
  }

  function showErrors(errors: EInvoiceError[]) {
    setMessages(errors);
    const groups = errors.map((error) => groupOf(error.field)).filter((group): group is Group => group !== null);
    if (groups.length) setOpenGroups((previous) => new Set([...previous, ...groups]));
  }

  async function exportInvoice(format: EInvoiceFormat) {
    setSuccess("");
    const result = prepareEInvoice(invoice, format);
    if (!result.ok || !result.document) {
      showErrors(result.errors);
      return;
    }
    const api = window.electronAPI as typeof window.electronAPI & {
      exportEInvoice?: (payload: object) => Promise<{ ok: boolean; canceled?: boolean; error?: string }>;
    };
    if (!api?.exportEInvoice) {
      showErrors([{ field: "", message: "Der geprüfte E-Rechnungsexport ist in der installierten Desktop-App verfügbar." }]);
      return;
    }
    setBusy(format);
    setMessages([]);
    try {
      const exported = await api.exportEInvoice({ format, document: result.document });
      if (exported.ok) setSuccess(`${format === "zugferd" ? "ZUGFeRD-PDF" : "XRechnung-XML"} geprüft und gespeichert.`);
      else if (!exported.canceled) showErrors([{ field: "", message: exported.error || "Die Datei konnte nicht erstellt werden." }]);
    } catch (error) {
      showErrors([{ field: "", message: error instanceof Error ? error.message : "Export fehlgeschlagen. Bitte erneut versuchen." }]);
    } finally {
      setBusy(null);
    }
  }

  const invalidClass = (field: string) => (invalid.has(field) ? "border-red-600" : "");

  function group(id: Group, title: string, status: string, children: ReactNode) {
    const problems = messages.filter((message) => groupOf(message.field) === id).length;
    return (
      <details className="disclosure rounded-lg border border-zinc-200" open={openGroups.has(id)}
        onToggle={(event) => toggleGroup(id, event.currentTarget.open)}>
        <summary className="flex-wrap px-4 py-2">
          <span className="font-semibold">{title}</span>
          <span className={`text-sm ${problems ? "font-medium text-red-700" : "text-(--color-ink-subtle)"}`}>
            {problems ? `${problems} ${problems === 1 ? "Angabe" : "Angaben"} prüfen` : status}
          </span>
        </summary>
        <div className="@container space-y-5 border-t border-zinc-200 p-4">{children}</div>
      </details>
    );
  }

  function partyInput(side: "seller" | "buyer", [key, label, hint]: PartyField) {
    const field = `einvoice.${side}.${key}`;
    return (
      <Field key={key} label={label} hint={hint} className={key === "street" ? "@lg:col-span-2" : ""}>
        <Input value={details[side]?.[key] ?? ""} aria-invalid={invalid.has(field) || undefined} className={invalidClass(field)}
          onChange={(event) => changeParty(side, key, event.target.value)} />
      </Field>
    );
  }

  function partyGroup(side: "seller" | "buyer") {
    const config = partyFields[side];
    const all = [...config.fields, ...config.extra.flatMap((extra) => extra.fields)];
    const count = filled(all.map(([key]) => details[side]?.[key]));
    const name = side === "seller" ? invoice.sender.name : invoice.recipient.name;
    return group(side, config.title, count ? `${count} von ${all.length} Angaben` : "Noch nicht ausgefüllt", <>
      <p className="text-sm text-(--color-ink-muted)">
        {name
          ? <>Name aus der Rechnung: <span className="font-medium text-(--color-ink)">{name}</span></>
          : `Der Name fehlt noch. Bitte oben im Abschnitt „${side === "seller" ? invoice.texts.senderHeading : invoice.texts.recipientHeading}“ eintragen.`}
      </p>
      <div className="grid gap-4 @lg:grid-cols-2">{config.fields.map((field) => partyInput(side, field))}</div>
      {config.extra.map((extra) => (
        <fieldset key={extra.legend} className="space-y-3">
          <legend className="mb-2 text-sm font-semibold text-(--color-ink)">{extra.legend}</legend>
          {extra.hint && <p className="text-sm text-(--color-ink-subtle)">{extra.hint}</p>}
          <div className="grid gap-4 @lg:grid-cols-2">{extra.fields.map((field) => partyInput(side, field))}</div>
        </fieldset>
      ))}
      {side === "buyer" && (
        <Field label="Käuferreferenz / Leitweg-ID" hint="Für XRechnung erforderlich. Bitte genau so übernehmen, wie der Empfänger sie mitgeteilt hat.">
          <Input value={details.buyerReference ?? ""} aria-invalid={invalid.has("einvoice.buyerReference") || undefined}
            className={invalidClass("einvoice.buyerReference")} onChange={(event) => change("buyerReference", event.target.value)} />
        </Field>
      )}
    </>);
  }

  const paymentLabel = { "58": "SEPA-Überweisung", "30": "Überweisung", "10": "Barzahlung" }[details.paymentMeansCode ?? "58"];
  const unitCount = items.filter((item) => details.unitCodes?.[item.id]).length;

  return (
    <details className="disclosure rounded-xl border border-zinc-200 bg-white p-5" id="einvoice" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><h2 className="text-lg font-semibold">E-Rechnung (ZUGFeRD und XRechnung)</h2></summary>
      {open && <div className="@container mt-4 space-y-5">
        <p className="text-base text-(--color-ink-muted)">
          Ergänzen Sie einmalig die strukturierten Angaben und speichern Sie die Rechnung dann als PDF mit Rechnungsdaten
          oder als XML-Datei für Behörden. Ihre normale Rechnung bleibt unverändert erhalten.
        </p>

        <div className="space-y-3">
          {partyGroup("seller")}
          {partyGroup("buyer")}
          {group("payment", "Zahlung und Bankverbindung", details.iban ? `${paymentLabel}, IBAN eingetragen` : paymentLabel, (
            <div className="grid gap-4 @lg:grid-cols-2">
              <Field label="Zahlungsart">
                <Select value={details.paymentMeansCode ?? "58"} onChange={(event) => change("paymentMeansCode", event.target.value)}>
                  <option value="58">SEPA-Überweisung</option><option value="30">Überweisung</option><option value="10">Barzahlung</option>
                </Select>
              </Field>
              <Field label="Kontoinhaber"><Input value={details.accountName ?? ""} onChange={(event) => change("accountName", event.target.value)} /></Field>
              <Field label="IBAN" hint={details.paymentMeansCode === "10" ? "Bei Barzahlung nicht erforderlich." : "Ohne Leerzeichen, beginnend mit dem Ländercode."}>
                <Input value={details.iban ?? ""} aria-invalid={invalid.has("einvoice.iban") || undefined} className={invalidClass("einvoice.iban")}
                  onChange={(event) => change("iban", event.target.value)} />
              </Field>
              <Field label="BIC (optional)"><Input value={details.bic ?? ""} onChange={(event) => change("bic", event.target.value)} /></Field>
              <Field label="Zahlungsbedingungen" className="@lg:col-span-2"><Input value={details.paymentTerms ?? ""} onChange={(event) => change("paymentTerms", event.target.value)} /></Field>
            </div>
          ))}
          {group("tax", "Leistungsdatum und Steuer", details.serviceDate || details.taxCategory ? "Angaben eingetragen" : "Nur bei Bedarf", (
            <div className="grid gap-4 @lg:grid-cols-2">
              <Field label="Leistungsdatum">
                <Input type="date" value={details.serviceDate ?? ""} aria-invalid={invalid.has("einvoice.serviceDate") || undefined}
                  className={invalidClass("einvoice.serviceDate")} onChange={(event) => change("serviceDate", event.target.value)} />
              </Field>
              <Field label="Steuerkategorie bei 0 % Steuer" hint="Nur nötig, wenn eine Position ohne Umsatzsteuer berechnet wird.">
                <Select value={details.taxCategory ?? ""} aria-invalid={invalid.has("einvoice.taxCategory") || undefined}
                  className={invalidClass("einvoice.taxCategory")} onChange={(event) => change("taxCategory", event.target.value)}>
                  <option value="">Keine Angabe</option><option value="Z">Nullsteuersatz</option><option value="E">Steuerbefreit</option>
                  <option value="AE">Reverse Charge</option><option value="K">Innergemeinschaftliche Lieferung</option><option value="G">Ausfuhr</option><option value="O">Nicht steuerbar</option>
                </Select>
              </Field>
              <Field label="Begründung der Steuerbefreiung" className="@lg:col-span-2">
                <Input value={details.taxExemptionReason ?? ""} aria-invalid={invalid.has("einvoice.taxExemptionReason") || undefined}
                  className={invalidClass("einvoice.taxExemptionReason")} onChange={(event) => change("taxExemptionReason", event.target.value)} />
              </Field>
            </div>
          ))}
          {group("units", "Einheiten der Positionen", unitCount ? `${unitCount} von ${items.length} angepasst` : "Automatisch erkannt", (
            items.length === 0
              ? <p className="text-sm text-(--color-ink-muted)">Noch keine Positionen vorhanden.</p>
              : <>
                <p className="text-sm text-(--color-ink-muted)">Die Einheit wird aus der Position übernommen. Nur ändern, wenn die Prüfung eine Einheit bemängelt.</p>
                <div className="space-y-3">
                  {items.map((item, index) => {
                    const field = `einvoice.unitCodes.${item.id}`;
                    return (
                      <Field key={item.id} label={`${index + 1}. ${item.description || "Position ohne Beschreibung"}`}>
                        <Select value={details.unitCodes?.[item.id] ?? ""} aria-invalid={invalid.has(field) || undefined} className={invalidClass(field)}
                          onChange={(event) => onChange({ ...details, unitCodes: { ...details.unitCodes, [item.id]: event.target.value || undefined } as Record<string, string> })}>
                          <option value="">Automatisch aus „{item.unit || "Stück"}“</option><option value="C62">Stück</option><option value="HUR">Stunde</option><option value="DAY">Tag</option><option value="MON">Monat</option><option value="MTR">Meter</option><option value="MTK">Quadratmeter</option><option value="MTQ">Kubikmeter</option><option value="KGM">Kilogramm</option><option value="LTR">Liter</option><option value="KMT">Kilometer</option>
                        </Select>
                      </Field>
                    );
                  })}
                </div>
              </>
          ))}
        </div>

        <div className="space-y-2">
          <Button onClick={() => {
            const { seller, paymentMeansCode, iban, bic, accountName, paymentTerms, taxCategory, taxExemptionReason } = details;
            onSaveDefaults({ seller, paymentMeansCode, iban, bic, accountName, paymentTerms, taxCategory, taxExemptionReason });
            setSuccess("Ihre Angaben als Rechnungssteller und die Zahlungsdaten werden für neue Rechnungen übernommen.");
          }}>Als Vorgabe für neue Rechnungen merken</Button>
          <p className="text-sm text-(--color-ink-subtle)">Merkt sich Ihre Angaben als Rechnungssteller, die Bankverbindung und die Steuerangaben. Empfängerdaten werden nicht übernommen.</p>
        </div>

        <section aria-labelledby="einvoice-export" className="space-y-4 border-t border-zinc-200 pt-5">
          <div>
            <h3 id="einvoice-export" className="text-base font-semibold">E-Rechnung speichern</h3>
            <p className="mt-1 text-sm text-(--color-ink-muted)">Die Datei wird vorher auf diesem Gerät geprüft. Fehlen Angaben, wird nichts gespeichert und Sie sehen hier, was zu ergänzen ist. Das ZUGFeRD-PDF verwendet ein festes Archivlayout mit den hier erfassten Adressen.</p>
          </div>
          <div className="grid gap-3 @lg:grid-cols-2">
            <div className="space-y-1.5">
              <Button className="w-full" disabled={busy !== null} onClick={() => exportInvoice("zugferd")}>{busy === "zugferd" ? "Wird geprüft …" : "ZUGFeRD-PDF speichern"}</Button>
              <p className="text-sm text-(--color-ink-subtle)">Lesbares PDF mit eingebetteten Rechnungsdaten.</p>
            </div>
            <div className="space-y-1.5">
              <Button className="w-full" disabled={busy !== null} onClick={() => exportInvoice("xrechnung")}>{busy === "xrechnung" ? "Wird geprüft …" : "XRechnung-XML speichern"}</Button>
              <p className="text-sm text-(--color-ink-subtle)">Eigenständige XML-Datei mit Käuferreferenz, bei Behörden meist die Leitweg-ID.</p>
            </div>
          </div>
          {messages.length > 0 && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-base text-red-900">
            <p className="mb-2 font-semibold">Bitte diese Angaben prüfen:</p>
            <ul className="list-disc space-y-1 pl-5">{messages.map((message, index) => <li key={index}>{message.message}</li>)}</ul>
          </div>}
          {success && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-base text-emerald-900">{success}</p>}
        </section>
      </div>}
    </details>
  );
}
