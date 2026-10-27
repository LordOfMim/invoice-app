import type { IconSvgElement } from "@/components/platform/icon";
import {
  Analytics01Icon,
  DatabaseExportIcon,
  Invoice03Icon,
  LayoutTemplateIcon,
  Certificate01Icon,
  PackageIcon,
  ReceiptDollarIcon,
  RepeatIcon,
  Settings02Icon,
  Tag01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import type { Language } from "@/lib/domain";

/*
 * Navigation described once as data and rendered as the left sidebar (desktop) and the phone menu sheet. Groups are
 * ordered by how often the work happens: the daily work first, then further documents, insights and administration.
 * Every existing page has exactly one entry. Matching: longest prefix wins, so detail pages (/invoices/abc) mark
 * their list entry.
 */
export type NavItem = {
  key: string;
  label: string;
  href: string;
  /** One sentence about what the entry contains (tooltip, phone menu). */
  hint: string;
  icon: IconSvgElement;
};

export type NavGroup = { key: string; label?: string; items: readonly NavItem[] };

const text = (language: Language, de: string, en: string) => (language === "de" ? de : en);

export function navGroups(language: Language): readonly NavGroup[] {
  return [
    {
      key: "work",
      items: [
        { key: "invoices", href: "/invoices", icon: Invoice03Icon, label: text(language, "Rechnungen", "Invoices"), hint: text(language, "Alle Rechnungen suchen, öffnen und als PDF speichern", "Find, open and save invoices as PDF") },
        { key: "customers", href: "/customers", icon: UserGroupIcon, label: text(language, "Kunden", "Customers"), hint: text(language, "Empfänger, die Sie in Rechnungen übernehmen", "Recipients you can fill into invoices") },
        { key: "products", href: "/products", icon: PackageIcon, label: text(language, "Produkte und Leistungen", "Products and services"), hint: text(language, "Wiederkehrende Positionen mit Preis", "Reusable line items with price") },
      ],
    },
    {
      key: "documents",
      label: text(language, "Weitere Dokumente", "More documents"),
      items: [
        { key: "credit-notes", href: "/credit-notes", icon: ReceiptDollarIcon, label: text(language, "Gutschriften und Stornos", "Credit notes"), hint: text(language, "Korrekturen zu gestellten Rechnungen", "Corrections to issued invoices") },
        { key: "recurring", href: "/recurring", icon: RepeatIcon, label: text(language, "Wiederkehrende Rechnungen", "Recurring invoices"), hint: text(language, "Rechnungen, die regelmäßig neu entstehen", "Invoices that are created on a schedule") },
        { key: "templates", href: "/templates", icon: LayoutTemplateIcon, label: text(language, "Vorlagen", "Templates"), hint: text(language, "Varianten für das Rechnungslayout", "Variants of the invoice layout") },
        { key: "fachunternehmer", href: "/fachunternehmer", icon: Certificate01Icon, label: text(language, "Fachunternehmererklärung", "Contractor declaration"), hint: text(language, "Erklärung für Bauvorhaben drucken", "Print a contractor declaration") },
      ],
    },
    {
      key: "insights",
      label: text(language, "Überblick", "Overview"),
      items: [
        { key: "dashboard", href: "/dashboard", icon: Analytics01Icon, label: text(language, "Auswertung", "Insights"), hint: text(language, "Offene Beträge, Zahlungen und Fälligkeiten", "Open amounts, payments and due dates") },
      ],
    },
    {
      key: "admin",
      label: text(language, "Verwaltung", "Administration"),
      items: [
        { key: "settings", href: "/settings", icon: Settings02Icon, label: text(language, "Einstellungen", "Settings"), hint: text(language, "Absender, Standardwerte, Logo und Sprache", "Sender, defaults, logo and language") },
        { key: "tags", href: "/tags", icon: Tag01Icon, label: text(language, "Schlagwörter", "Tags"), hint: text(language, "Rechnungen mit Farben ordnen", "Organise invoices with colours") },
        { key: "backup", href: "/backup", icon: DatabaseExportIcon, label: text(language, "Datensicherung", "Backup"), hint: text(language, "Daten sichern und wiederherstellen", "Back up and restore your data") },
      ],
    },
  ];
}

const covers = (prefix: string, pathname: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Group and entry for a path (longest matching prefix); detail pages resolve to their list entry. */
export function locate(groups: readonly NavGroup[], pathname: string): { group?: NavGroup; item?: NavItem } {
  let found: { group: NavGroup; item: NavItem } | undefined;
  for (const group of groups) {
    for (const item of group.items) {
      if (covers(item.href, pathname) && (!found || item.href.length > found.item.href.length)) found = { group, item };
    }
  }
  return found ?? {};
}
