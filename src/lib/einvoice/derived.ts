import type { EInvoiceParty, Invoice, PartyDetails } from "../domain";

/*
 * What the E-Rechnung can take from what the invoice already says, so nothing has to be typed twice: the structured
 * address from the address lines, the e-mail and telephone from the contact lines. A value entered in the E-Rechnung
 * tab always wins; the derived one only fills a gap and follows later changes of the address or contact.
 */

type AddressParts = Pick<EInvoiceParty, "street" | "postalCode" | "city" | "countryCode">;

const COUNTRY_NAMES: Record<string, string> = {
  deutschland: "DE", germany: "DE", österreich: "AT", oesterreich: "AT", austria: "AT", schweiz: "CH", switzerland: "CH",
  niederlande: "NL", netherlands: "NL", belgien: "BE", belgium: "BE", luxemburg: "LU", luxembourg: "LU", frankreich: "FR",
  france: "FR", dänemark: "DK", denmark: "DK", polen: "PL", poland: "PL", tschechien: "CZ", italien: "IT", italy: "IT",
};
// Country prefixes as people write them in front of a postal code, e.g. "D-10115" or "A-1010".
const PREFIX_COUNTRY: Record<string, string> = { D: "DE", DE: "DE", A: "AT", AT: "AT", CH: "CH", NL: "NL", B: "BE", BE: "BE", L: "LU", LU: "LU", F: "FR", FR: "FR", DK: "DK", PL: "PL", CZ: "CZ", I: "IT", IT: "IT" };

/**
 * Street, postal code, city and country from a free-text address such as "Hauptstraße 5\n10115 Berlin". The postal
 * code line is the last line that starts with 4 or 5 digits (optionally "D-" or "DE "); the street is the line above
 * it. A trailing country line ("Österreich") sets the country; otherwise a 5-digit code means Germany. Returns only
 * what it recognises with confidence.
 */
export function splitPostalAddress(text: string | undefined): AddressParts {
  const lines = (text ?? "").split(/\r?\n|,(?=\s*(?:[A-Z]{1,2}[-\s])?\d{4,5}\s)/).map((line) => line.trim()).filter(Boolean);
  let country: string | undefined;
  const last = lines.at(-1)?.toLowerCase().replace(/\.$/, "");
  if (last && COUNTRY_NAMES[last]) { country = COUNTRY_NAMES[last]; lines.pop(); }
  for (let index = lines.length - 1; index >= 0; index--) {
    const match = /^(?:([A-Z]{1,2})[-\s])?(\d{4,5})\s+(.+)$/.exec(lines[index]);
    if (!match) continue;
    const [, prefix, postalCode, city] = match;
    const countryCode = country ?? (prefix ? PREFIX_COUNTRY[prefix] : undefined) ?? (postalCode.length === 5 ? "DE" : undefined);
    const street = index > 0 ? lines[index - 1] : undefined;
    return { ...(street ? { street } : {}), postalCode, city: city.trim(), ...(countryCode ? { countryCode } : {}) };
  }
  return country ? { countryCode: country } : {};
}

export function firstEmail(text: string | undefined): string | undefined {
  return /[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:".]+/.exec(text ?? "")?.[0];
}

export function firstPhone(text: string | undefined): string | undefined {
  for (const line of (text ?? "").split(/\r?\n/)) {
    if (line.includes("@")) continue;
    const match = /(\+?\d[\d\s/()-]{5,}\d)/.exec(line);
    if (match) return match[1].trim();
  }
  return undefined;
}

const filled = (value: string | undefined) => (value ?? "").trim();

/**
 * The details of one side as the E-Rechnung uses them: what was entered in the E-Rechnung tab, completed from the
 * invoice's own address and contact lines. `derived` lists the keys that came from those lines.
 */
export function effectiveParty(invoice: Pick<Invoice, "sender" | "recipient" | "einvoice">, side: "seller" | "buyer"): { party: EInvoiceParty; derived: Set<keyof EInvoiceParty> } {
  const explicit: EInvoiceParty = invoice.einvoice?.[side] ?? {};
  const details: PartyDetails = side === "seller" ? invoice.sender : invoice.recipient;
  const suggestions: EInvoiceParty = { ...splitPostalAddress(details.address) };
  const email = filled(explicit.email) || firstEmail(details.contact);
  if (!filled(explicit.email) && email) suggestions.email = email;
  if (email) { suggestions.electronicAddress = email; suggestions.electronicAddressScheme = "EM"; }
  if (side === "seller") {
    const name = filled(details.name);
    if (name) suggestions.contactName = name;
    const phone = firstPhone(details.contact);
    if (phone) suggestions.contactPhone = phone;
  }
  const party: EInvoiceParty = { ...explicit };
  const derived = new Set<keyof EInvoiceParty>();
  for (const [key, value] of Object.entries(suggestions) as [keyof EInvoiceParty, string | undefined][]) {
    if (!value || filled(explicit[key])) continue;
    // An electronic address entered by hand keeps its own scheme.
    if (key === "electronicAddressScheme" && filled(explicit.electronicAddress)) continue;
    party[key] = value;
    derived.add(key);
  }
  return { party, derived };
}

/** Units as craftsmen write them, mapped to UN/ECE Recommendation 20 codes. */
const UNIT_CODES: Record<string, string> = {
  stück: "C62", stk: "C62", st: "C62", stck: "C62", piece: "C62", pcs: "C62", pc: "C62", "x": "C62",
  stunde: "HUR", stunden: "HUR", std: "HUR", h: "HUR", hour: "HUR", hours: "HUR", hrs: "HUR",
  minute: "MIN", minuten: "MIN", min: "MIN",
  tag: "DAY", tage: "DAY", day: "DAY", days: "DAY", tg: "DAY",
  woche: "WEE", wochen: "WEE",
  monat: "MON", monate: "MON", month: "MON", mon: "MON",
  jahr: "ANN", jahre: "ANN", year: "ANN",
  kg: "KGM", kilogramm: "KGM", g: "GRM", gramm: "GRM", t: "TNE", tonne: "TNE", tonnen: "TNE",
  m: "MTR", meter: "MTR", lfm: "MTR", lfdm: "MTR", "lfd.m": "MTR", lm: "MTR", laufmeter: "MTR", "lfd. m": "MTR",
  m2: "MTK", "m²": "MTK", qm: "MTK", quadratmeter: "MTK",
  m3: "MTQ", "m³": "MTQ", cbm: "MTQ", kubikmeter: "MTQ",
  km: "KMT", liter: "LTR", l: "LTR", ltr: "LTR",
  pauschal: "C62", pauschale: "C62", psch: "C62", pschl: "C62", pausch: "C62", pa: "C62", ps: "C62",
  satz: "SET", set: "SET",
};

/** UN/ECE code for a unit written on a position, or undefined when it is not recognised. */
export function unitCodeFor(unit: string | undefined): string | undefined {
  const key = (unit ?? "").trim().toLowerCase().replace(/\.$/, "").replace(/\s+/g, " ");
  if (!key) return "C62";
  return UNIT_CODES[key] ?? UNIT_CODES[key.replace(/\./g, "")] ?? UNIT_CODES[key.replace(/[\s.]/g, "")];
}

/**
 * Payment terms for the E-Rechnung when none were entered: they follow from the due date. When the notes already
 * state payment terms, the E-Rechnung carries those notes and gets no second, differently worded line.
 */
export function derivedPaymentTerms(invoice: Pick<Invoice, "dueDate" | "invoiceDate" | "notesText">): string | undefined {
  if (/zahlbar|zahlungsziel|zahlung bis|payable/i.test(invoice.notesText ?? "")) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoice.dueDate ?? "")) return undefined;
  const day = `${invoice.dueDate.slice(8, 10)}.${invoice.dueDate.slice(5, 7)}.${invoice.dueDate.slice(0, 4)}`;
  return invoice.dueDate === invoice.invoiceDate ? "Zahlbar sofort ohne Abzug." : `Zahlbar ohne Abzug bis ${day}.`;
}
