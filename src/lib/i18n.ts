import type { Language } from "@/lib/domain";

export type TranslationKey =
  // Navigation
  | "nav.invoices"
  | "nav.settings"
  | "nav.dashboard"
  | "nav.customers"
  | "nav.products"
  | "nav.recurring"
  | "nav.creditNotes"
  | "nav.tags"
  | "nav.templates"
  | "nav.backup"
  // Actions
  | "actions.newInvoice"
  | "actions.edit"
  | "actions.delete"
  | "actions.duplicate"
  | "actions.markPaid"
  | "actions.markUnpaid"
  | "actions.addPayment"
  | "actions.createCreditNote"
  | "actions.createStorno"
  | "actions.export"
  | "actions.import"
  | "actions.backup"
  | "actions.restore"
  | "actions.generatePdf"
  | "actions.email"
  | "actions.search"
  | "actions.addTag"
  | "actions.addAttachment"
  | "actions.selectCustomer"
  | "actions.selectProduct"
  | "actions.generate"
  | "actions.setDefaultInvoice"
  // Filters
  | "filters.paid"
  | "filters.unpaid"
  | "filters.overdue"
  | "filters.all"
  // Sort
  | "sort.date"
  | "sort.number"
  | "sort.total"
  // Settings
  | "settings.title"
  | "settings.language"
  | "settings.currency"
  | "settings.defaultTaxRate"
  | "settings.defaultTemplate"
  | "settings.defaultSender"
  | "settings.defaultFooter"
  | "settings.defaultLogo"
  | "settings.pdfFilenamePattern"
  | "settings.backupSettings"
  | "settings.autoBackup"
  | "settings.backupPath"
  // Invoices
  | "invoices.title"
  | "invoices.empty"
  | "invoices.currency"
  | "invoices.multiCurrencyNote"
  | "invoices.exchangeRate"
  | "invoices.exchangeRateNote"
  | "invoices.payments"
  | "invoices.fullyPaid"
  | "invoices.partiallyPaid"
  | "invoices.unpaid"
  | "invoices.invoiceTotal"
  | "invoices.paidAmount"
  | "invoices.remainingBalance"
  | "invoices.paymentHistory"
  | "invoices.addPayment"
  | "invoices.paymentAmount"
  | "invoices.paymentDate"
  | "invoices.paymentMethod"
  | "invoices.paymentReference"
  | "invoices.bankTransfer"
  | "invoices.cash"
  | "invoices.card"
  | "invoices.recordPayment"
  | "invoices.attachments"
  | "invoices.attachmentsNote"
  | "invoice.editorTitle"
  | "invoice.previewTitle"
  | "invoice.paid"
  | "invoice.default"
  | "invoice.partiallyPaid"
  | "invoice.unpaid"
  | "invoice.overdue"
  | "invoice.payments"
  | "invoice.remaining"
  | "invoice.attachments"
  | "invoice.tags"
  | "invoice.currency"
  | "invoice.exchangeRate"
  // Customers
  | "customers.title"
  | "customers.empty"
  | "customers.name"
  | "customers.address"
  | "customers.contact"
  | "customers.email"
  | "customers.phone"
  | "customers.taxId"
  | "customers.notes"
  | "customers.new"
  // Products
  | "products.title"
  | "products.empty"
  | "products.name"
  | "products.description"
  | "products.unit"
  | "products.unitPrice"
  | "products.taxRate"
  | "products.category"
  | "products.new"
  // Tags
  | "tags.title"
  | "tags.empty"
  | "tags.name"
  | "tags.color"
  | "tags.new"
  | "tags.assignToInvoice"
  | "tags.addTag"
  // Recurring
  | "recurring.title"
  | "recurring.empty"
  | "recurring.name"
  | "recurring.frequency"
  | "recurring.nextRun"
  | "recurring.lastRun"
  | "recurring.monthly"
  | "recurring.quarterly"
  | "recurring.yearly"
  | "recurring.active"
  | "recurring.reminder"
  | "recurring.autoGenerate"
  | "recurring.new"
  | "recurring.dueToday"
  // Credit Notes
  | "creditNotes.title"
  | "creditNotes.empty"
  | "creditNotes.storno"
  | "creditNotes.gutschrift"
  | "creditNotes.linkedInvoice"
  | "creditNotes.reason"
  | "creditNotes.amount"
  // Dashboard
  | "dashboard.title"
  | "dashboard.unpaidTotal"
  | "dashboard.overdueCount"
  | "dashboard.overdueTotal"
  | "dashboard.revenueByMonth"
  | "dashboard.invoiceCount"
  | "dashboard.customerCount"
  | "dashboard.recentInvoices"
  | "dashboard.upcomingReminders"
  // Templates
  | "templates.title"
  | "templates.empty"
  | "templates.new"
  | "templates.baseTemplate"
  | "templates.fontSizeScale"
  | "templates.lineSpacing"
  | "templates.tablePadding"
  | "templates.headerStyle"
  | "templates.footerColumns"
  | "templates.accentColor"
  // Backup
  | "backup.title"
  | "backup.export"
  | "backup.import"
  | "backup.lastBackup"
  | "backup.schemaVersion"
  | "backup.dataInfo"
  // Common
  | "common.save"
  | "common.cancel"
  | "common.confirm"
  | "common.loading"
  | "common.noResults"
  | "common.name"
  | "common.date"
  | "common.amount"
  | "common.other";

const de: Record<TranslationKey, string> = {
  // Navigation
  "nav.invoices": "Rechnungen",
  "nav.settings": "Einstellungen",
  "nav.dashboard": "Dashboard",
  "nav.customers": "Kunden",
  "nav.products": "Produkte",
  "nav.recurring": "Wiederkehrend",
  "nav.creditNotes": "Gutschriften",
  "nav.tags": "Tags",
  "nav.templates": "Vorlagen",
  "nav.backup": "Backup",
  // Actions
  "actions.newInvoice": "Neue Rechnung",
  "actions.edit": "Bearbeiten",
  "actions.delete": "Löschen",
  "actions.duplicate": "Duplizieren",
  "actions.markPaid": "Als bezahlt markieren",
  "actions.markUnpaid": "Als unbezahlt markieren",
  "actions.addPayment": "Zahlung hinzufügen",
  "actions.createCreditNote": "Gutschrift erstellen",
  "actions.createStorno": "Storno erstellen",
  "actions.export": "Exportieren",
  "actions.import": "Importieren",
  "actions.backup": "Backup erstellen",
  "actions.restore": "Wiederherstellen",
  "actions.generatePdf": "PDF erstellen",
  "actions.email": "Per E-Mail senden",
  "actions.search": "Suchen",
  "actions.addTag": "Tag hinzufügen",
  "actions.addAttachment": "Anhang hinzufügen",
  "actions.selectCustomer": "Kunde auswählen",
  "actions.selectProduct": "Produkt auswählen",
  "actions.generate": "Generieren",
  "actions.setDefaultInvoice": "Als Standard setzen",
  // Filters
  "filters.paid": "Bezahlt",
  "filters.unpaid": "Unbezahlt",
  "filters.overdue": "Überfällig",
  "filters.all": "Alle",
  // Sort
  "sort.date": "Datum",
  "sort.number": "Rechnungsnummer",
  "sort.total": "Gesamtbetrag",
  // Settings
  "settings.title": "Einstellungen",
  "settings.language": "Sprache",
  "settings.currency": "Währung",
  "settings.defaultTaxRate": "Standard-Steuersatz",
  "settings.defaultTemplate": "Standard-Layout",
  "settings.defaultSender": "Standard-Absender",
  "settings.defaultFooter": "Standard-Fußtext",
  "settings.defaultLogo": "Standard-Logo",
  "settings.pdfFilenamePattern": "PDF-Dateiname",
  "settings.backupSettings": "Backup-Einstellungen",
  "settings.autoBackup": "Automatisches Backup",
  "settings.backupPath": "Backup-Pfad",
  // Invoices
  "invoices.title": "Rechnungen",
  "invoices.empty": "Noch keine Rechnungen.",
  "invoices.currency": "Währung",
  "invoices.multiCurrencyNote": "Wähle eine andere Währung für internationale Rechnungen.",
  "invoices.exchangeRate": "Wechselkurs",
  "invoices.exchangeRateNote": "Wechselkurs-Hinweis",
  "invoices.payments": "Zahlungen",
  "invoices.fullyPaid": "Vollständig bezahlt",
  "invoices.partiallyPaid": "Teilweise bezahlt",
  "invoices.unpaid": "Unbezahlt",
  "invoices.invoiceTotal": "Rechnungsbetrag",
  "invoices.paidAmount": "Bezahlt",
  "invoices.remainingBalance": "Restbetrag",
  "invoices.paymentHistory": "Zahlungsverlauf",
  "invoices.addPayment": "Zahlung erfassen",
  "invoices.paymentAmount": "Betrag",
  "invoices.paymentDate": "Datum",
  "invoices.paymentMethod": "Zahlungsart",
  "invoices.paymentReference": "Referenz",
  "invoices.bankTransfer": "Überweisung",
  "invoices.cash": "Bar",
  "invoices.card": "Karte",
  "invoices.recordPayment": "Zahlung speichern",
  "invoices.attachments": "Anhänge",
  "invoices.attachmentsNote": "Dokumente an diese Rechnung anhängen.",
  "invoice.editorTitle": "Bearbeiten",
  "invoice.previewTitle": "Vorschau",
  "invoice.paid": "Bezahlt",
  "invoice.default": "Standard",
  "invoice.partiallyPaid": "Teilweise bezahlt",
  "invoice.unpaid": "Unbezahlt",
  "invoice.overdue": "Überfällig",
  "invoice.payments": "Zahlungen",
  "invoice.remaining": "Restbetrag",
  "invoice.attachments": "Anhänge",
  "invoice.tags": "Tags",
  "invoice.currency": "Währung",
  "invoice.exchangeRate": "Wechselkurs",
  // Customers
  "customers.title": "Kundenverwaltung",
  "customers.empty": "Noch keine Kunden.",
  "customers.name": "Name",
  "customers.address": "Adresse",
  "customers.contact": "Kontakt",
  "customers.email": "E-Mail",
  "customers.phone": "Telefon",
  "customers.taxId": "Steuernummer",
  "customers.notes": "Notizen",
  "customers.new": "Neuer Kunde",
  // Products
  "products.title": "Produkte & Leistungen",
  "products.empty": "Noch keine Produkte.",
  "products.name": "Name",
  "products.description": "Beschreibung",
  "products.unit": "Einheit",
  "products.unitPrice": "Preis",
  "products.taxRate": "MwSt.",
  "products.category": "Kategorie",
  "products.new": "Neues Produkt",
  // Tags
  "tags.title": "Tags & Projekte",
  "tags.empty": "Noch keine Tags.",
  "tags.name": "Name",
  "tags.color": "Farbe",
  "tags.new": "Neuer Tag",
  "tags.assignToInvoice": "Tags dieser Rechnung zuweisen.",
  "tags.addTag": "Tag hinzufügen",
  // Recurring
  "recurring.title": "Wiederkehrende Rechnungen",
  "recurring.empty": "Noch keine wiederkehrenden Rechnungen.",
  "recurring.name": "Name",
  "recurring.frequency": "Häufigkeit",
  "recurring.nextRun": "Nächste Ausführung",
  "recurring.lastRun": "Letzte Ausführung",
  "recurring.monthly": "Monatlich",
  "recurring.quarterly": "Vierteljährlich",
  "recurring.yearly": "Jährlich",
  "recurring.active": "Aktiv",
  "recurring.reminder": "Erinnerung (Tage vorher)",
  "recurring.autoGenerate": "Automatisch generieren",
  "recurring.new": "Neue wiederkehrende Rechnung",
  "recurring.dueToday": "Heute fällig",
  // Credit Notes
  "creditNotes.title": "Gutschriften & Stornos",
  "creditNotes.empty": "Noch keine Gutschriften.",
  "creditNotes.storno": "Storno",
  "creditNotes.gutschrift": "Gutschrift",
  "creditNotes.linkedInvoice": "Zu Rechnung",
  "creditNotes.reason": "Grund",
  "creditNotes.amount": "Betrag",
  // Dashboard
  "dashboard.title": "Dashboard",
  "dashboard.unpaidTotal": "Offene Beträge",
  "dashboard.overdueCount": "Überfällige Rechnungen",
  "dashboard.overdueTotal": "Überfälliger Betrag",
  "dashboard.revenueByMonth": "Umsatz nach Monat",
  "dashboard.invoiceCount": "Rechnungen gesamt",
  "dashboard.customerCount": "Kunden",
  "dashboard.recentInvoices": "Letzte Rechnungen",
  "dashboard.upcomingReminders": "Anstehende Erinnerungen",
  // Templates
  "templates.title": "Vorlagen-Editor",
  "templates.empty": "Noch keine benutzerdefinierten Vorlagen.",
  "templates.new": "Neue Vorlage",
  "templates.baseTemplate": "Basis-Vorlage",
  "templates.fontSizeScale": "Schriftgröße",
  "templates.lineSpacing": "Zeilenabstand",
  "templates.tablePadding": "Tabellenabstand",
  "templates.headerStyle": "Kopfstil",
  "templates.footerColumns": "Fußzeilen-Spalten",
  "templates.accentColor": "Akzentfarbe",
  // Backup
  "backup.title": "Backup & Daten",
  "backup.export": "Daten exportieren",
  "backup.import": "Daten importieren",
  "backup.lastBackup": "Letztes Backup",
  "backup.schemaVersion": "Schema-Version",
  "backup.dataInfo": "Datenübersicht",
  // Common
  "common.save": "Speichern",
  "common.cancel": "Abbrechen",
  "common.confirm": "Bestätigen",
  "common.loading": "Lädt...",
  "common.noResults": "Keine Ergebnisse",
  "common.name": "Name",
  "common.date": "Datum",
  "common.amount": "Betrag",
  "common.other": "Sonstige",
};

const en: Record<TranslationKey, string> = {
  // Navigation
  "nav.invoices": "Invoices",
  "nav.settings": "Settings",
  "nav.dashboard": "Dashboard",
  "nav.customers": "Customers",
  "nav.products": "Products",
  "nav.recurring": "Recurring",
  "nav.creditNotes": "Credit Notes",
  "nav.tags": "Tags",
  "nav.templates": "Templates",
  "nav.backup": "Backup",
  // Actions
  "actions.newInvoice": "New invoice",
  "actions.edit": "Edit",
  "actions.delete": "Delete",
  "actions.duplicate": "Duplicate",
  "actions.markPaid": "Mark as paid",
  "actions.markUnpaid": "Mark as unpaid",
  "actions.addPayment": "Add payment",
  "actions.createCreditNote": "Create credit note",
  "actions.createStorno": "Create cancellation",
  "actions.export": "Export",
  "actions.import": "Import",
  "actions.backup": "Create backup",
  "actions.restore": "Restore",
  "actions.generatePdf": "Generate PDF",
  "actions.email": "Send by email",
  "actions.search": "Search",
  "actions.addTag": "Add tag",
  "actions.addAttachment": "Add attachment",
  "actions.selectCustomer": "Select customer",
  "actions.selectProduct": "Select product",
  "actions.generate": "Generate",
  "actions.setDefaultInvoice": "Set as default",
  // Filters
  "filters.paid": "Paid",
  "filters.unpaid": "Unpaid",
  "filters.overdue": "Overdue",
  "filters.all": "All",
  // Sort
  "sort.date": "Date",
  "sort.number": "Invoice number",
  "sort.total": "Total amount",
  // Settings
  "settings.title": "Settings",
  "settings.language": "Language",
  "settings.currency": "Currency",
  "settings.defaultTaxRate": "Default tax rate",
  "settings.defaultTemplate": "Default layout",
  "settings.defaultSender": "Default sender",
  "settings.defaultFooter": "Default footer text",
  "settings.defaultLogo": "Default logo",
  "settings.pdfFilenamePattern": "PDF filename",
  "settings.backupSettings": "Backup settings",
  "settings.autoBackup": "Auto backup",
  "settings.backupPath": "Backup path",
  // Invoices
  "invoices.title": "Invoices",
  "invoices.empty": "No invoices yet.",
  "invoices.currency": "Currency",
  "invoices.multiCurrencyNote": "Select a different currency for international invoices.",
  "invoices.exchangeRate": "Exchange rate",
  "invoices.exchangeRateNote": "Exchange rate note",
  "invoices.payments": "Payments",
  "invoices.fullyPaid": "Fully paid",
  "invoices.partiallyPaid": "Partially paid",
  "invoices.unpaid": "Unpaid",
  "invoices.invoiceTotal": "Invoice total",
  "invoices.paidAmount": "Paid",
  "invoices.remainingBalance": "Remaining balance",
  "invoices.paymentHistory": "Payment history",
  "invoices.addPayment": "Add payment",
  "invoices.paymentAmount": "Amount",
  "invoices.paymentDate": "Date",
  "invoices.paymentMethod": "Payment method",
  "invoices.paymentReference": "Reference",
  "invoices.bankTransfer": "Bank transfer",
  "invoices.cash": "Cash",
  "invoices.card": "Card",
  "invoices.recordPayment": "Record payment",
  "invoices.attachments": "Attachments",
  "invoices.attachmentsNote": "Attach documents to this invoice.",
  "invoice.editorTitle": "Edit",
  "invoice.previewTitle": "Preview",
  "invoice.paid": "Paid",
  "invoice.default": "Default",
  "invoice.partiallyPaid": "Partially paid",
  "invoice.unpaid": "Unpaid",
  "invoice.overdue": "Overdue",
  "invoice.payments": "Payments",
  "invoice.remaining": "Remaining",
  "invoice.attachments": "Attachments",
  "invoice.tags": "Tags",
  "invoice.currency": "Currency",
  "invoice.exchangeRate": "Exchange rate",
  // Customers
  "customers.title": "Customer Directory",
  "customers.empty": "No customers yet.",
  "customers.name": "Name",
  "customers.address": "Address",
  "customers.contact": "Contact",
  "customers.email": "Email",
  "customers.phone": "Phone",
  "customers.taxId": "Tax ID",
  "customers.notes": "Notes",
  "customers.new": "New customer",
  // Products
  "products.title": "Products & Services",
  "products.empty": "No products yet.",
  "products.name": "Name",
  "products.description": "Description",
  "products.unit": "Unit",
  "products.unitPrice": "Price",
  "products.taxRate": "Tax rate",
  "products.category": "Category",
  "products.new": "New product",
  // Tags
  "tags.title": "Tags & Projects",
  "tags.empty": "No tags yet.",
  "tags.name": "Name",
  "tags.color": "Color",
  "tags.new": "New tag",
  "tags.assignToInvoice": "Assign tags to this invoice.",
  "tags.addTag": "Add tag",
  // Recurring
  "recurring.title": "Recurring Invoices",
  "recurring.empty": "No recurring invoices yet.",
  "recurring.name": "Name",
  "recurring.frequency": "Frequency",
  "recurring.nextRun": "Next run",
  "recurring.lastRun": "Last run",
  "recurring.monthly": "Monthly",
  "recurring.quarterly": "Quarterly",
  "recurring.yearly": "Yearly",
  "recurring.active": "Active",
  "recurring.reminder": "Reminder (days before)",
  "recurring.autoGenerate": "Auto generate",
  "recurring.new": "New recurring invoice",
  "recurring.dueToday": "Due today",
  // Credit Notes
  "creditNotes.title": "Credit Notes & Cancellations",
  "creditNotes.empty": "No credit notes yet.",
  "creditNotes.storno": "Cancellation",
  "creditNotes.gutschrift": "Credit note",
  "creditNotes.linkedInvoice": "For invoice",
  "creditNotes.reason": "Reason",
  "creditNotes.amount": "Amount",
  // Dashboard
  "dashboard.title": "Dashboard",
  "dashboard.unpaidTotal": "Outstanding",
  "dashboard.overdueCount": "Overdue invoices",
  "dashboard.overdueTotal": "Overdue amount",
  "dashboard.revenueByMonth": "Revenue by month",
  "dashboard.invoiceCount": "Total invoices",
  "dashboard.customerCount": "Customers",
  "dashboard.recentInvoices": "Recent invoices",
  "dashboard.upcomingReminders": "Upcoming reminders",
  // Templates
  "templates.title": "Template Editor",
  "templates.empty": "No custom templates yet.",
  "templates.new": "New template",
  "templates.baseTemplate": "Base template",
  "templates.fontSizeScale": "Font size",
  "templates.lineSpacing": "Line spacing",
  "templates.tablePadding": "Table padding",
  "templates.headerStyle": "Header style",
  "templates.footerColumns": "Footer columns",
  "templates.accentColor": "Accent color",
  // Backup
  "backup.title": "Backup & Data",
  "backup.export": "Export data",
  "backup.import": "Import data",
  "backup.lastBackup": "Last backup",
  "backup.schemaVersion": "Schema version",
  "backup.dataInfo": "Data overview",
  // Common
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.confirm": "Confirm",
  "common.loading": "Loading...",
  "common.noResults": "No results",
  "common.name": "Name",
  "common.date": "Date",
  "common.amount": "Amount",
  "common.other": "Other",
};

export function t(language: Language, key: TranslationKey): string {
  const dict = language === "de" ? de : en;
  return dict[key];
}
