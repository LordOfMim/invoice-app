export function todayLocalISO(): string {
  const now = new Date();
  return dateToLocalISO(now);
}

export function dateToLocalISO(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

export function monthKey(value: string): string {
  return /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : "";
}

export function formatMonthKey(value: string, locale: string): string {
  const date = parseDateOnly(`${value}-01`);
  if (!date) return value;
  return date.toLocaleDateString(locale, { month: "short", year: "2-digit" });
}

export function formatDateOnly(value: string, locale: string): string {
  const date = parseDateOnly(value);
  if (!date) return value;
  return date.toLocaleDateString(locale);
}

export function daysBetweenDateOnly(from: string, to: string): number {
  const fromDate = parseDateOnly(from);
  const toDate = parseDateOnly(to);
  if (!fromDate || !toDate) return 0;
  const msPerDay = 1000 * 60 * 60 * 24;
  // Local midnights are 23 or 25 hours apart across a clock change; round, don't floor.
  return Math.round((toDate.getTime() - fromDate.getTime()) / msPerDay);
}

export function addMonthsClamped(dateOnly: string, months: number): string {
  const date = parseDateOnly(dateOnly);
  if (!date) return todayLocalISO();

  const originalDay = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const daysInTargetMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(originalDay, daysInTargetMonth));
  return dateToLocalISO(target);
}

/** Like addMonthsClamped, but returns to `anchorDay` whenever the target month is long enough (31st → 28th → 31st). */
export function addMonthsAnchored(dateOnly: string, months: number, anchorDay?: number): string {
  const date = parseDateOnly(dateOnly);
  if (!date) return todayLocalISO();
  const day = anchorDay && anchorDay >= 1 && anchorDay <= 31 ? Math.floor(anchorDay) : date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const daysInTargetMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, daysInTargetMonth));
  return dateToLocalISO(target);
}

export function addDays(dateOnly: string, days: number): string {
  const date = parseDateOnly(dateOnly);
  if (!date) return todayLocalISO();
  if (!Number.isFinite(days)) return dateOnly;
  date.setDate(date.getDate() + Math.round(days));
  return dateToLocalISO(date);
}

/** True for a real calendar date in YYYY-MM-DD form (2026-02-30 is not one). */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = parseDateOnly(value);
  return !!date && dateToLocalISO(date) === value;
}

/**
 * Locale of everything printed on a document (invoice, quote, reminder, declaration) and of the tax export:
 * dates as 14.11.2026, amounts as 1.234,56 €. Documents are German whatever language the app itself is shown in,
 * so the PDF, the E-Rechnung and the export never disagree.
 */
export const DOCUMENT_LOCALE = "de-DE";

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** Calendar date for documents and lists: 14.11.2026 (de) or 11/14/2026 (en). Unparseable input is returned as typed. */
export function formatDocumentDate(value: string | undefined, locale: string): string {
  if (!value) return "";
  const date = parseDateOnly(value);
  if (!date || dateToLocalISO(date) !== value) return value;
  let formatter = dayFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
    dayFormatters.set(locale, formatter);
  }
  return formatter.format(date);
}
