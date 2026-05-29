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
  return Math.floor((toDate.getTime() - fromDate.getTime()) / msPerDay);
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
