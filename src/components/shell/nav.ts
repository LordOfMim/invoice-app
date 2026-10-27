import type { Language } from "@/lib/domain";

/*
 * Navigation described once as data (Werknetz DESIGN.md „Rahmen der Anwendung“, Overwatch `areas`): areas in the
 * main row, the pages of a grouped area in the second row. Every existing page has exactly one place here.
 * Matching follows humaify-overwatch `src/components/shell/nav-match.ts` (longest prefix wins).
 */
export type NavItem = {
  key: string;
  label: string;
  href: string;
  /** One sentence about what the entry contains (tooltip, phone menu). */
  hint: string;
  /** Further path prefixes that mark this item active. */
  match?: readonly string[];
};

export type NavArea = NavItem & { pages?: readonly NavItem[] };

const text = (language: Language, de: string, en: string) => (language === "de" ? de : en);

export function navAreas(language: Language): readonly NavArea[] {
  const invoicePages: NavItem[] = [
    { key: "invoices", href: "/invoices", label: text(language, "Rechnungen", "Invoices"), hint: text(language, "Alle Rechnungen suchen, öffnen und als PDF speichern", "Find, open and save invoices as PDF") },
    { key: "credit-notes", href: "/credit-notes", label: text(language, "Gutschriften und Stornos", "Credit notes"), hint: text(language, "Korrekturen zu gestellten Rechnungen", "Corrections to issued invoices") },
    { key: "recurring", href: "/recurring", label: text(language, "Wiederkehrende Rechnungen", "Recurring invoices"), hint: text(language, "Rechnungen, die regelmäßig neu entstehen", "Invoices that are created on a schedule") },
    { key: "templates", href: "/templates", label: text(language, "Vorlagen", "Templates"), hint: text(language, "Varianten für das Rechnungslayout", "Variants of the invoice layout") },
    { key: "fachunternehmer", href: "/fachunternehmer", label: text(language, "Fachunternehmererklärung", "Contractor declaration"), hint: text(language, "Erklärung für Bauvorhaben drucken", "Print a contractor declaration") },
  ];
  const adminPages: NavItem[] = [
    { key: "settings", href: "/settings", label: text(language, "Einstellungen", "Settings"), hint: text(language, "Absender, Standardwerte, Logo und Sprache", "Sender, defaults, logo and language") },
    { key: "tags", href: "/tags", label: text(language, "Schlagwörter", "Tags"), hint: text(language, "Rechnungen mit Farben ordnen", "Organise invoices with colours") },
    { key: "backup", href: "/backup", label: text(language, "Datensicherung", "Backup"), hint: text(language, "Daten sichern und wiederherstellen", "Back up and restore your data") },
  ];
  return [
    { key: "invoices", href: "/invoices", label: text(language, "Rechnungen", "Invoices"), hint: invoicePages[0].hint, pages: invoicePages },
    { key: "customers", href: "/customers", label: text(language, "Kunden", "Customers"), hint: text(language, "Empfänger, die Sie in Rechnungen übernehmen", "Recipients you can fill into invoices") },
    { key: "products", href: "/products", label: text(language, "Produkte und Leistungen", "Products and services"), hint: text(language, "Wiederkehrende Positionen mit Preis", "Reusable line items with price") },
    { key: "dashboard", href: "/dashboard", label: text(language, "Auswertung", "Insights"), hint: text(language, "Offene Beträge, Zahlungen und Fälligkeiten", "Open amounts, payments and due dates") },
    { key: "admin", href: "/settings", label: text(language, "Verwaltung", "Administration"), hint: adminPages[0].hint, pages: adminPages },
  ];
}

const covers = (prefix: string, pathname: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** The item whose href (or match prefix) is the longest prefix of the path. */
export function activeItem<T extends NavItem>(items: readonly T[], pathname: string): T | undefined {
  let best: { item: T; length: number } | undefined;
  for (const item of items) {
    for (const prefix of [item.href, ...(item.match ?? [])]) {
      if (covers(prefix, pathname) && (!best || prefix.length > best.length)) best = { item, length: prefix.length };
    }
  }
  return best?.item;
}

/** Area and page for a path; areas with pages match through any of their pages. */
export function locate(areas: readonly NavArea[], pathname: string): { area?: NavArea; page?: NavItem } {
  let found: { area: NavArea; page: NavItem; length: number } | undefined;
  for (const area of areas) {
    for (const page of area.pages ?? [area]) {
      const hit = activeItem([page], pathname);
      if (hit && (!found || hit.href.length > found.length)) found = { area, page, length: hit.href.length };
    }
  }
  return found ? { area: found.area, page: found.page } : {};
}
