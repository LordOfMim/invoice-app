/**
 * Invoice number helpers. Numbers stay free text: the app only suggests the next one and warns about duplicates,
 * so an existing numbering scheme (2026-048, RE-0012, 48/2026 …) keeps working unchanged.
 */

export type NumberedDocument = { id: string; invoiceNumber: string; invoiceDate?: string; createdAt?: string };

const normalize = (value: string) => value.trim().toLocaleLowerCase("de-DE");

/** Other documents in the same collection that already carry this number (case and outer spaces ignored). */
export function findDuplicateNumbers<T extends NumberedDocument>(documents: readonly T[], number: string, ownId: string): T[] {
  const wanted = normalize(number);
  if (!wanted) return [];
  return documents.filter((document) => document.id !== ownId && normalize(document.invoiceNumber ?? "") === wanted);
}

type YearPart = { inPrefix: boolean; index: number; text: string };
type Parsed = { prefix: string; digits: string; suffix: string; value: number; year?: YearPart };

/** Where a scheme writes the year: before the counter ("26-048") or behind it ("048/26"). */
type YearPosition = "prefix" | "suffix";

/** One number of the collection, cut into its digit runs. */
type Entry = { text: string; runs: RegExpMatchArray[]; shape: string; documentYear: number | null };
type YearMatch = "exact" | "near" | null;

function toEntry(document: NumberedDocument): Entry {
  const text = (document.invoiceNumber ?? "").trim();
  const date = document.invoiceDate;
  return {
    text,
    runs: [...text.matchAll(/\d+/g)],
    // Numbers of the same scheme look alike once every digit run is blanked: "K12-25" and "K7-103" → "k#-#".
    shape: normalize(text.replace(/\d+/g, "#")),
    documentYear: date && /^\d{4}-/.test(date) ? Number(date.slice(0, 4)) : null,
  };
}

/**
 * Which digit runs of each number may be the year. Three things decide it:
 *
 * 1. The run fits the date of its document: the year itself ("26" or "2026" on an invoice of 2026), or a
 *    neighbouring year ("050/25" written in the first days of 2026; for four digits also the year after). Two
 *    digits are only stretched backwards, and only when another number of the same shape confirms it: a document
 *    of that earlier year that carries the same two digits at the same place. Otherwise "K12-25" in 2026 is
 *    simply counter 25. The year itself wins over a neighbouring year.
 * 2. Years stand still within a year, counters move: among the numbers of the same shape and the same document
 *    year, a run that changes while every other run stays the same is the counter, however much it looks like a
 *    year ("A1-25", "A1-26" in 2026 → "A1-27").
 * 3. A run that changes together with another run may still be the year when it is one for every one of those
 *    documents (a December invoice already numbered for the new year next to the old ones).
 */
function createYearFinder(entries: readonly Entry[]): (entry: Entry) => RegExpMatchArray[] {
  type Group = { members: Entry[]; varies: boolean[]; allYears: (boolean | undefined)[] };
  const groups = new Map<string, Group>();
  /** `shape|position|digits` of two-digit runs that equal the year of their own document. */
  const confirmedTwoDigitYears = new Set<string>();
  const confirmedYearPositions = new Set<string>();
  const groupKey = (entry: Entry) => `${entry.shape}|${entry.documentYear ?? ""}`;

  for (const entry of entries) {
    if (entry.runs.length < 2) continue;
    const group = groups.get(groupKey(entry));
    if (!group) {
      groups.set(groupKey(entry), { members: [entry], varies: entry.runs.map(() => false), allYears: [] });
    } else {
      const first = group.members[0];
      entry.runs.forEach((run, index) => { if (run[0] !== first.runs[index][0]) group.varies[index] = true; });
      group.members.push(entry);
    }
    entry.runs.forEach((run, index) => {
      if (run[0].length === 2 && entry.documentYear !== null && Number(run[0]) === entry.documentYear % 100) {
        confirmedTwoDigitYears.add(`${entry.shape}|${index}|${run[0]}`);
        confirmedYearPositions.add(`${entry.shape}|${index}`);
      }
    });
  }

  const match = (entry: Entry, index: number): YearMatch => {
    const digits = entry.runs[index][0];
    const year = entry.documentYear;
    if (/^20\d{2}$/.test(digits)) {
      if (year === null || Number(digits) === year) return "exact";
      return Math.abs(Number(digits) - year) === 1 ? "near" : null;
    }
    if (digits.length !== 2 || year === null) return null;
    if (Number(digits) === year % 100) return "exact";
    // "001/26" written in the last days of 2025: the coming year, where siblings carry their year at this place.
    if (Number(digits) === (year + 1) % 100) return confirmedYearPositions.has(`${entry.shape}|${index}`) ? "near" : null;
    if (Number(digits) !== (year - 1) % 100) return null;
    return confirmedTwoDigitYears.has(`${entry.shape}|${index}|${digits}`) ? "near" : null;
  };

  return (entry) => {
    if (entry.runs.length < 2) return [];
    // A number that is not part of the collection stands alone.
    const group = groups.get(groupKey(entry));
    const matches = entry.runs.map((_, index): YearMatch => {
      const own = match(entry, index);
      if (!own || !group || !group.varies[index]) return own;
      if (!group.varies.some((varies, other) => other !== index && varies)) return null;
      group.allYears[index] ??= group.members.every((member) => match(member, index) !== null);
      return group.allYears[index] ? own : null;
    });
    const exact = entry.runs.filter((_, index) => matches[index] === "exact");
    return exact.length ? exact : entry.runs.filter((_, index) => matches[index] === "near");
  };
}

/**
 * Find the counter and, if the number carries one, the year next to it (`years`: the runs that may be it).
 * "RE-2026-048" → prefix "RE-2026-", counter "048"; "48/2026" → counter "48", suffix "/2026"; "048/25" on an
 * invoice dated 2025 → counter "048", year "25". When several runs could be the year ("26/26" in 2026),
 * `yearPosition` says where the other numbers of the collection carry it; without that the last one is the year.
 */
function parse(entry: Entry, years: readonly RegExpMatchArray[], yearPosition?: YearPosition): Parsed | null {
  const { text, runs } = entry;
  if (runs.length === 0) return null;
  const yearRun = years.length === 0 ? undefined : yearPosition === "prefix" ? years[0] : years[years.length - 1];
  const counter = [...runs].reverse().find((run) => run !== yearRun) ?? runs[runs.length - 1];
  const value = Number(counter[0]);
  if (!Number.isSafeInteger(value)) return null;
  const start = counter.index ?? 0;
  const yearStart = yearRun?.index ?? 0;
  const year: YearPart | undefined = yearRun
    ? yearStart < start ? { inPrefix: true, index: yearStart, text: yearRun[0] } : { inPrefix: false, index: yearStart - (start + counter[0].length), text: yearRun[0] }
    : undefined;
  return { prefix: text.slice(0, start), digits: counter[0], suffix: text.slice(start + counter[0].length), value, year };
}

/** Where the numbers that leave no doubt carry their year; undefined when there is none or they disagree evenly. */
function usualYearPosition(entries: readonly Entry[], yearsOf: (entry: Entry) => RegExpMatchArray[]): YearPosition | undefined {
  let balance = 0;
  for (const entry of entries) {
    const years = yearsOf(entry);
    if (years.length !== 1) continue;
    const year = parse(entry, years)?.year;
    if (year) balance += year.inPrefix ? 1 : -1;
  }
  return balance > 0 ? "prefix" : balance < 0 ? "suffix" : undefined;
}

const pad = (value: number, width: number) => String(value).padStart(width, "0");

/**
 * Suggest the number after the most recent one. The counter continues within the same prefix; when the number
 * carries the year of an earlier year, the suggestion switches to the current year and restarts at 1.
 * Without any earlier number the suggestion is `<year>-001` (or `fallbackPrefix` + that).
 */
export function suggestNextNumber(documents: readonly NumberedDocument[], today: string, fallbackPrefix = ""): string {
  const year = /^\d{4}/.test(today) ? today.slice(0, 4) : String(new Date().getFullYear());
  const entries = documents.map(toEntry);
  const yearsOf = createYearFinder(entries);
  const yearPosition = usualYearPosition(entries, yearsOf);
  const numbered = documents
    .map((document, index) => ({ document, parsed: parse(entries[index], yearsOf(entries[index]), yearPosition) }))
    .filter((entry): entry is { document: NumberedDocument; parsed: Parsed } => entry.parsed !== null);
  if (numbered.length === 0) return `${fallbackPrefix}${year}-001`;

  // The newest document decides the scheme: by date, then by creation time.
  const newest = numbered.reduce((best, entry) => {
    const a = `${entry.document.invoiceDate ?? ""}|${entry.document.createdAt ?? ""}`;
    const b = `${best.document.invoiceDate ?? ""}|${best.document.createdAt ?? ""}`;
    return a > b ? entry : best;
  });
  const scheme = newest.parsed;

  if (scheme.year) {
    const usedYear = scheme.year.text.length === 2 ? `${year.slice(0, 2)}${scheme.year.text}` : scheme.year.text;
    if (usedYear < year) {
      const { index, text, inPrefix } = scheme.year;
      const swap = (part: string) => `${part.slice(0, index)}${text.length === 2 ? year.slice(2) : year}${part.slice(index + text.length)}`;
      const prefix = inPrefix ? swap(scheme.prefix) : scheme.prefix;
      const suffix = inPrefix ? scheme.suffix : swap(scheme.suffix);
      // Another document may already have opened the new year.
      const highest = highestCounter(numbered.map((entry) => entry.parsed), prefix, suffix);
      return firstFree(documents, prefix, highest + 1, scheme.digits.length, suffix);
    }
  }

  const highest = highestCounter(numbered.map((entry) => entry.parsed), scheme.prefix, scheme.suffix);
  return firstFree(documents, scheme.prefix, Math.max(highest, scheme.value) + 1, scheme.digits.length, scheme.suffix);
}

/** The suggestion must never be a number that is already taken, however the existing numbers were read. */
function firstFree(documents: readonly NumberedDocument[], prefix: string, start: number, width: number, suffix: string): string {
  const taken = new Set(documents.map((document) => normalize(document.invoiceNumber ?? "")));
  let value = start;
  for (let tries = 0; tries < 10000 && taken.has(normalize(`${prefix}${pad(value, width)}${suffix}`)); tries += 1) value += 1;
  return `${prefix}${pad(value, width)}${suffix}`;
}

function highestCounter(all: readonly Parsed[], prefix: string, suffix: string): number {
  let highest = 0;
  for (const parsed of all) {
    if (normalize(parsed.prefix) === normalize(prefix) && normalize(parsed.suffix) === normalize(suffix) && parsed.value > highest) highest = parsed.value;
  }
  return highest;
}
