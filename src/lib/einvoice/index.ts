import type { EInvoiceParty, Invoice } from "../domain";
import { computeInvoiceTotals, computeLineTotal } from "../calc";
import { roundMoney } from "../money";

export type EInvoiceFormat = "xrechnung" | "zugferd";
export type EInvoiceError = { field: string; message: string };
export type EInvoicePartyData = Required<Pick<EInvoiceParty, "street" | "postalCode" | "city" | "countryCode">> & EInvoiceParty & { name: string };
export type EInvoiceDocument = {
  number: string; date: string; dueDate: string; currency: string;
  seller: EInvoicePartyData; buyer: EInvoicePartyData;
  buyerReference: string; paymentMeansCode: string; iban: string; bic: string;
  accountName: string; paymentTerms: string; serviceDate: string;
  taxExemptionReason: string;
  lines: { id: string; description: string; quantity: number; unitCode: string; unitPrice: number; taxRate: number; taxCategory: string; net: number }[];
  taxes: { rate: number; category: string; basis: number; amount: number }[];
  totals: { subtotal: number; taxTotal: number; total: number };
  presentation: { title: string; sellerAddress: string; buyerAddress: string; sellerContact: string; buyerContact: string; notes: string; footer: string; logoDataUrl?: string; labels: Invoice["texts"] };
};

const units: Record<string, string> = { stück: "C62", stk: "C62", st: "C62", piece: "C62", stunde: "HUR", stunden: "HUR", std: "HUR", h: "HUR", hour: "HUR", tag: "DAY", tage: "DAY", day: "DAY", monat: "MON", monate: "MON", month: "MON", kg: "KGM", m: "MTR", km: "KMT", liter: "LTR", l: "LTR", pauschal: "C62" };
const supportedUnits = new Set(["C62", "H87", "HUR", "DAY", "MON", "ANN", "KGM", "GRM", "MTR", "MTK", "MTQ", "KMT", "LTR", "MIN", "SEC", "SET", "NAR"]);
function validDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
const text = (value?: string) => (value ?? "").trim();

/** No mutations and no mandatory migration: missing legacy fields only block E-invoice export. */
export function prepareEInvoice(invoice: Invoice, format: EInvoiceFormat): { ok: boolean; errors: EInvoiceError[]; document?: EInvoiceDocument } {
  const errors: EInvoiceError[] = [];
  const add = (field: string, message: string) => errors.push({ field, message });
  const details = invoice.einvoice ?? {};
  const party = (side: "seller" | "buyer", name: string): EInvoicePartyData => {
    const p = details[side] ?? {};
    const prefix = side === "seller" ? "Rechnungssteller" : "Rechnungsempfänger";
    if (!text(name)) add(side, `${prefix}: Name fehlt.`);
    for (const [key, label] of [["street", "Straße und Hausnummer"], ["postalCode", "Postleitzahl"], ["city", "Ort"], ["countryCode", "Ländercode"]] as const) if (!text(p[key])) add(`einvoice.${side}.${key}`, `${prefix}: ${label} fehlt.`);
    const country = text(p.countryCode).toUpperCase();
    if (country && !/^[A-Z]{2}$/.test(country)) add(`einvoice.${side}.countryCode`, `${prefix}: zweistelligen ISO-Ländercode verwenden, z. B. DE.`);
    if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) add(`einvoice.${side}.email`, `${prefix}: E-Mail-Adresse ist ungültig.`);
    if (format === "xrechnung") {
      if (!text(p.electronicAddress)) add(`einvoice.${side}.electronicAddress`, `${prefix}: elektronische Adresse fehlt (z. B. E-Mail).`);
      if (!text(p.electronicAddressScheme)) add(`einvoice.${side}.electronicAddressScheme`, `${prefix}: Schema der elektronischen Adresse fehlt (für E-Mail: EM).`);
    }
    return { ...p, name: text(name), street: text(p.street), postalCode: text(p.postalCode), city: text(p.city), countryCode: country };
  };
  const seller = party("seller", invoice.sender.name), buyer = party("buyer", invoice.recipient.name);
  if (!seller.vatId && !seller.taxId) add("einvoice.seller.taxId", "Rechnungssteller: Umsatzsteuer-ID oder Steuernummer fehlt.");
  if (format === "xrechnung") {
    if (!text(details.buyerReference)) add("einvoice.buyerReference", "Käuferreferenz fehlt; bei Behörden die mitgeteilte Leitweg-ID eintragen.");
    for (const [key, label] of [["contactName", "Kontaktperson"], ["contactPhone", "Kontakttelefon"], ["email", "Kontakt-E-Mail"]] as const) if (!text(seller[key])) add(`einvoice.seller.${key}`, `Rechnungssteller: ${label} fehlt für XRechnung.`);
  }
  if (!text(invoice.invoiceNumber)) add("invoiceNumber", "Rechnungsnummer fehlt.");
  if (!validDate(invoice.invoiceDate)) add("invoiceDate", "Rechnungsdatum ist ungültig.");
  if (!validDate(invoice.dueDate)) add("dueDate", "Fälligkeitsdatum ist ungültig.");
  if (details.serviceDate && !validDate(details.serviceDate)) add("einvoice.serviceDate", "Leistungsdatum ist ungültig.");
  const currency = text(invoice.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) add("currency", "Dreistelligen ISO-Währungscode verwenden, z. B. EUR.");
  const paymentMeansCode = details.paymentMeansCode ?? "58";
  if (!["58", "30", "10"].includes(paymentMeansCode)) add("einvoice.paymentMeansCode", "Zahlungsart ist ungültig.");
  const iban = text(details.iban).replace(/\s/g, "").toUpperCase();
  if (paymentMeansCode !== "10" && !iban) add("einvoice.iban", "Bankverbindung: IBAN fehlt.");
  if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) add("einvoice.iban", "Bankverbindung: IBAN-Format ist ungültig.");
  const groups = new Map<string, { rate: number; category: string; basis: number; amount: number; lineTax: number }>();
  const lines: EInvoiceDocument["lines"] = [];
  for (const [i, item] of invoice.lineItems.entries()) {
    if (item.type !== "item") {
      if (computeLineTotal(item).net !== 0) add(`lineItems.${i}`, "Überschriften mit einem Betrag müssen vor dem E-Rechnungsexport in Positionen umgewandelt werden.");
      continue;
    }
    const field = `lineItems.${i}`, label = `Position ${lines.length + 1}`;
    if (!text(item.description)) add(`${field}.description`, `${label}: Beschreibung fehlt.`);
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) add(`${field}.quantity`, `${label}: Menge muss größer als 0 sein.`);
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) add(`${field}.unitPrice`, `${label}: Preis muss eine nicht negative Zahl sein.`);
    const rate = item.taxRate ?? 0;
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) add(`${field}.taxRate`, `${label}: Steuersatz ist ungültig.`);
    const category = rate > 0 ? "S" : details.taxCategory;
    if (!category || !["S", "Z", "E", "AE", "K", "G", "O"].includes(category) || category === "S" && rate === 0) add("einvoice.taxCategory", `${label}: Für 0 % Steuer eine Steuerkategorie auswählen.`);
    if (category && !["S", "Z"].includes(category) && !text(details.taxExemptionReason)) add("einvoice.taxExemptionReason", "Begründung für die Steuerbefreiung fehlt.");
    const unitCode = details.unitCodes?.[item.id] ?? units[text(item.unit).toLowerCase()] ?? (item.unit ? "" : "C62");
    if (!supportedUnits.has(unitCode)) add(`einvoice.unitCodes.${item.id}`, `${label}: Einheit als UNECE-Code angeben (z. B. HUR für Stunden, C62 für Stück).`);
    const { net, tax } = computeLineTotal(item);
    const key = `${category}:${rate}`;
    const g = groups.get(key) ?? { rate: roundMoney(rate * 100), category: category ?? "Z", basis: 0, amount: 0, lineTax: 0 };
    g.basis = roundMoney(g.basis + net); g.lineTax = roundMoney(g.lineTax + tax); groups.set(key, g);
    lines.push({ id: String(lines.length + 1), description: text(item.description), quantity: item.quantity, unitCode, unitPrice: item.unitPrice, taxRate: roundMoney(rate * 100), taxCategory: category ?? "Z", net });
  }
  if (!lines.length) add("lineItems", "Mindestens eine Rechnungsposition ist erforderlich.");
  for (const g of groups.values()) {
    g.amount = roundMoney(g.basis * g.rate / 100);
    if (g.amount !== g.lineTax) add("lineItems", `Steuerrundung bei ${g.rate} % weicht um ${Math.abs(g.amount - g.lineTax).toFixed(2)} ${currency} ab. Die Positionsrundung dieser Rechnung entspricht nicht der E-Rechnungssumme; bitte Positionen anpassen.`);
  }
  const totals = computeInvoiceTotals(invoice);
  if (![totals.subtotal, totals.taxTotal, totals.total].every(Number.isFinite) || totals.total < 0) add("lineItems", "Rechnungssummen sind ungültig.");
  const document: EInvoiceDocument = {
    number: text(invoice.invoiceNumber), date: invoice.invoiceDate, dueDate: invoice.dueDate, currency,
    seller, buyer, buyerReference: text(details.buyerReference), paymentMeansCode, iban, bic: text(details.bic), accountName: text(details.accountName), paymentTerms: text(details.paymentTerms), serviceDate: details.serviceDate ?? "", taxExemptionReason: text(details.taxExemptionReason), lines, taxes: [...groups.values()].map(({ rate, category, basis, amount }) => ({ rate, category, basis, amount })), totals,
    presentation: { title: invoice.texts.documentTitle, sellerAddress: invoice.sender.address, buyerAddress: invoice.recipient.address, sellerContact: invoice.sender.contact, buyerContact: invoice.recipient.contact, notes: invoice.notesText, footer: [invoice.footerLeftText ?? invoice.footerText, invoice.footerRightText].filter(Boolean).join("\n"), logoDataUrl: invoice.layout.showLogo ? invoice.logoDataUrl : undefined, labels: invoice.texts },
  };
  return { ok: errors.length === 0, errors, ...(errors.length ? {} : { document }) };
}

export function validateEInvoice(invoice: Invoice, format: EInvoiceFormat): EInvoiceError[] { return prepareEInvoice(invoice, format).errors; }
