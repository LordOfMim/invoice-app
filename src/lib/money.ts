export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number, currency: string, locale: string): string {
  const key = `${locale}:${currency}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "symbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    if (formatters.size >= 32) formatters.delete(formatters.keys().next().value!);
    formatters.set(key, formatter);
  }
  return formatter.format(amount);
}

export function formatQuantity(value: number, locale: string): string {
  return locale.startsWith("de") ? String(value).replace(".", ",") : String(value);
}
