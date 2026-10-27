# Designreferenz für Helferlein

Stand: 27.10.2026. Die Gestaltung folgt den tatsächlichen Designverträgen und UI-Bausteinen der Humaify-Produkte. Für die Implementierung wurden ausschließlich die unten genannten Designquellen, Styles, Primitives, Layout-Komponenten und lizenzierten Schriften in einem begrenzten Lesepaket bereitgestellt. Das lokale Recherchepaket liegt außerhalb dieses Git-Repositories; die maßgeblichen Quellpfade und Stände sind hier festgehalten.

## Quellen und Commitstand

| Kürzel | Paketpfad | Original (laut MANIFEST) | Stand |
| --- | --- | --- | --- |
| Platform | `platform/` | `humaify-platform/worktrees/development-875b9380/…` | Branch `development`, HEAD `cc5090a111efa9d386587f0846cc9c13f1682e1c` (README des Pakets) |
| Overwatch | `overwatch/` | `humaify-overwatch/main/…` | Branch `main`, `ca40ebd1f2cac6bc89ba45939cef6956ad372a12` (README des Pakets) |
| Werknetz | `werknetz/` | `Kunden/Werknetz/main/…` | HEAD `aa0dfa4de6801b8e792a3939f995a5a9dd4c5d07`; Design-MD, Theme und verwendete Plattform-Primitives unverändert gegenüber HEAD. Die Primitives sind bis auf den Importpfad `./lib/cn` zeichengleich mit Platform; `platform-theme.css` hat denselben SHA256 wie Overwatch (`245d96c2…`). |
| Fonts | `fonts/` | `humaify-platform/…/packages/ui/node_modules/@fontsource-variable/inter`, `…/@fontsource/roboto-mono` | Inter Variable (latin, wght), Roboto Mono 400/500/600 (latin), jeweils mit OFL-Lizenz |

Gelesene Design-MDs und Regeln:

- `platform/.cursor/rules/ui-design-source-of-truth.mdc` (SHA256 `88729ca3…`)
- `platform/packages/ui/DESIGN.md` (`26ddf3b4…`)
- `platform/packages/ui/src/styles.css`
- `overwatch/DESIGN.md` (`9f7cba8e…`)
- `werknetz/context/humaify/DESIGN.md` (`8621ab1a…`)

Gelesene Primitive und Kompositionen:

- Platform `packages/ui/src/primitives/`: `button`, `icon-button`, `icon`, `input`, `field`, `search-field`, `top-bar`, `breadcrumb`, `identity-header`, `underline-tabs`, `status-pill`, `status-ring`, `dropdown-menu`, `sheet`, `dialog`, `alert`, `empty-state`, `page-heading`, `spinner`, `arrow-link`, `pagination`, `badge`, `chip`, `stat-cell`, `lib/cn.ts`, `lib/motion.ts`
- Platform `packages/ui/src/pages/flow-detail.stories.tsx`, `workspaces-directory.stories.tsx`
- Platform `apps/web/app/(staff)/lines/[lineId]/line-shell-frame.tsx` (Objektseite: IdentityHeader → UnderlineTabs → 13rem-Seitenliste, sticky ab lg)
- Overwatch `src/app/platform-theme.css`, `src/components/shell/{app-shell,section-nav,sub-nav,mobile-nav,nav-match,breadcrumbs,use-keep-active-visible}`, `src/components/ui/{layout,form-layout,forms,data,menu,section-tabs,status,form-actions,button}`, `src/app/styleguide/{page,demos}.tsx`
- Werknetz `src/components/platform/`, `src/components/shell/`, `src/components/ui/`

Im Auftrag genannt, aber **nicht im Paket** und daher nicht verwendet (es wurde nicht außerhalb gesucht): `platform/packages/ui/src/pages/workspace-overview.stories.tsx`, `overwatch/src/app/(app)/rechnungen/page.tsx`, `overwatch/src/app/(app)/firmen/page.tsx`, `werknetz/context/humaify/AGENTS.md`, `werknetz/src/app/(app)/_nav/`. Das Listenmuster stammt deshalb aus Overwatch `DESIGN.md` (Abschnitt Tabellen/Filter), `ui/data.tsx` (`DataTable`, `PrimaryCell`, `Pagination`), `ui/form-layout.tsx` (`FilterBar`) und dem Screenshot `04-overwatch-list-pattern.jpg`.

## Paper-IDs

Die kanonische Datei ist Paper (nicht Figma): „Humaify Workspace“, Seite „Humaify Sitemap“.

| ID | Bedeutung | Beleg im Paket |
| --- | --- | --- |
| `2MTE-0` | Staff-Flow-Detail, Styling-Baseline aller Tokens | `ui-design-source-of-truth.mdc`, Kommentar in `styles.css` und `platform-theme.css` |
| `2PJF-0` | Klickbares Top-Bar-Breadcrumb-Segment | Kommentar in `primitives/breadcrumb.tsx` |
| `2PIT-0`, `1A1X-0` | Plattformübersicht | Nur durch den Auftrag benannt; im Paket nicht belegt. Keine Werte daraus übernommen. |

Die „Badge Library“ ist laut `.mdc` nur Inventar, kein Stylinganker.

## Priorität bei Konflikten

1. Kompatibilitäts- und Datenregeln aus `AGENTS.md` und dem Auftrag (Daten, Export, Druckvorlagen) gehen allem Gestalterischen vor.
2. Lesbarkeit und Bedienbarkeit für den Nutzer am Mac (Auftrag) gehen reiner Miniaturfidelity vor. Abweichungen stehen unten.
3. Platform `packages/ui/src/primitives/*` und `styles.css` (bestehende Komponenten schlagen neuere Paper-Seiten und ältere Texte wie `apps/web/03-DESIGN.md`).
4. Platform `packages/ui/DESIGN.md` und `.cursor/rules/ui-design-source-of-truth.mdc`.
5. Overwatch `DESIGN.md` und seine Kompositionen (bestätigte Umsetzung: TopBar 52px, SectionNav 44px, SubNav 40px, 1312px-Spalte, FormPage 880px). Die frühere Sidebar ist dort ausdrücklich abgelöst.
6. Werknetz `context/humaify/DESIGN.md` für Benutzbarkeitsregeln (Sie-Sprache, Titel + Zweck, höchstens eine blaue Aktion, keine Hover-only-Aktionen, Labels mit Hinweis oder Fehler, bis 320px).
7. Ältere Generation `main/apps/app` (Geist, Lucide, shadcn-Sidebar) gilt nicht.

## Übernahmematrix

| Bedarf in Helferlein | Quelle | Übernahme |
| --- | --- | --- |
| Tokens (Farben, Radien, Typo-Skala, Laufweiten, Easing, Scroll-Fade) | Platform `styles.css` über Overwatch `platform-theme.css` | Wörtlich nach `src/app/platform-theme.css`. Entfernt wie bei Overwatch: Tailwind-Importe, `@source`, Blaak. Zusätzlich bleibt Tailwinds Standardpalette erhalten (siehe Abweichung 1). |
| Schriften | `fonts/` | Inter Variable und Roboto Mono als lokale WOFF2 über `next/font/local`, OFL-Lizenzen liegen daneben und werden unter `public/licenses/` mit dem App-Paket ausgeliefert. Keine Netzwerkabfragen. |
| `cn` | Platform `lib/cn.ts` | Wörtlich (`src/components/platform/lib/cn.ts`). |
| Button, IconButton, Field/Label, Input, SearchField, TopBar, Breadcrumb, IdentityHeader, StatusPill, StatusRing, Alert, PageHeading, Spinner, Badge, StatCell, ArrowLink, EmptyState, Icon (Hugeicons-Wrapper), DropdownMenu, Sheet, Dialog | Platform-Primitives über die Werknetz-Kopie | Nach `src/components/platform/` (Werknetz-Importpfad `./lib/cn`). Menü, Sheet und Dialog verwenden die Radix-Originale mit ihrer Struktur, ARIA, Fokusführung und Tastaturbedienung. Gezielte Ergänzungen: Menüs bleiben innerhalb der verfügbaren Höhe scrollbar; Dialog-/Sheet-Schließen ist 40px groß. |
| UnderlineTabs | Platform `underline-tabs.tsx` | Klassen und Aufbau unverändert. Abweichung 5: aktiver Balken ohne `motion`-Gleitanimation, optionale Größe `lg`. |
| App-Rahmen | Overwatch `shell/app-shell`, `section-nav`, `sub-nav`, `mobile-nav`, `nav-match`, `breadcrumbs` | Nachgebaut in `src/components/shell/`: TopBar 52px mit Produktname und Pfad, SectionNav mit fünf Bereichen (Rechnungen · Kunden · Produkte und Leistungen · Auswertung · Verwaltung), SubNav nur in gruppierten Bereichen, MobileNav-Zeile mit Radix-Sheet unter `md`. Ohne Emblem, Konto- und Umgebungsbadge. |
| Seitenkopf, Abschnitt, Platte, Kennzahlen, Hinweise, Leerzustand | Overwatch `ui/layout.tsx` | `Page`, `PageHeader` (Tool und Entity), `Section`, `Card`/`CardZone`, `KeyValueList`, `KeyFigures`, `StatusNote`, `EmptyState`. |
| Formulare | Overwatch `ui/forms.tsx`, `ui/form-layout.tsx`, Platform `field.tsx` | `Field` (Label oben, Hinweis oder Fehler), `Input`, `Select` (NativeSelect-Rezept), `Textarea`, `Checkbox`/`Choice`, `FormSection`, `FormPage` 880px. Bestehendes `DecimalInput` mit Kommaeingabe bleibt die Logik. |
| Listen | Overwatch `ui/data.tsx`, `ui/menu.tsx`, Filterzeile aus `ui/form-layout.tsx` | `DataTable` (Mono-Kopfzeile, Haarlinien, unter `md` Karten), `PrimaryCell`, `Pagination`, `OverflowMenu` „…“, Filterzeile mit Suche, Auswahl und „Zurücksetzen“. |
| Rechnungseditor | Platform `line-shell-frame.tsx` + Overwatch Entity-`PageHeader` | IdentityHeader mit Status und Aktionen, UnderlineTabs „Bearbeiten · Vorschau · Zahlungen · E-Rechnung · Gestaltung“, im Tab Bearbeiten eine 13rem-Abschnittsliste mit Summe neben der 880px-Formularspalte. |
| Druckvorlagen, PDF, E-Rechnung | Helferlein selbst | Unverändert. Die neuen Tokens werden für `.invoice-paper` auf die bisherigen Werte zurückgesetzt (Abweichung 1). |
| Emblem, Blüte, Blaak, AuthShell, Charts, Kunden-/Infrastrukturmodule | Platform, Werknetz | Nicht übernommen. |

## Bewusste Abweichungen

1. **Tailwind-Standardpalette bleibt.** Overwatch setzt `--color-*: initial`. Die Rechnungsvorlagen (`src/components/templates/*`) nutzen `zinc-*` und Tailwinds Standardgrößen. Damit gedruckte Rechnungen und PDFs unverändert bleiben, bleibt die Palette erhalten und `.invoice-paper` setzt `--text-*`, `--radius-*`, Schrift, Grundgröße und die bisherigen Tabellenzellen auf den Stand vor dieser Überarbeitung zurück. Neue Oberflächen verwenden ausschließlich Platform-Tokens.
2. **Lesbarkeitsprofil für den Mac-Nutzer.** Platform-Desktopwerte (12.5px Tabellen, 26–32px Controls, 9px Mono-Köpfe) sind für Operator-Konsolen gedacht. Helferlein nutzt größere Stufen aus derselben geschlossenen Skala, analog zu Overwatchs `touch:`-Größen: Eingaben 40px mit `text-lg` (14.5px), Buttons 36px (`lg`, sanktionierte Größe) mit 13px, Labels 13px, Tabellenzellen 14.5px, Tabellenköpfe Mono 11px (`text-xs`) in `ink-muted`, Menüzeilen 40px, Navigation 44px mit 14.5px. Hinweise verwenden das bestehende `ink-body` #5B6472 (5,98:1 auf Weiß). Dafür bildet das Lesbarkeitsprofil `ink-muted` in `globals.css` auf `ink-body` ab; das ursprüngliche `ink-muted` #6F7988 erreicht nur 4,41:1. Die Quell-Tokendatei bleibt erhalten. Zur Primäraktion siehe Abweichung 3. Keine neuen Farben, Radien oder Schriftgrade.
3. **Primärbutton mit Ink-Text.** Die Quelle setzt weißen, halbfetten Text auf `accent-blue` #5CABFF. Das ergibt nur etwa 2,4:1 Kontrast und ist für den Nutzer zu schwach. Die eine blaue Hauptaktion behält das Quellblau, trägt aber `ink` #1C1D1F (etwa 6,9:1). Gezielte Accessibility-Abweichung, keine neue Farbe (`src/components/ui/Button.tsx`).
4. **Kein Emblem, kein Kontomenü, keine Umgebungsbadges.** Die TopBar zeigt „Helferlein“ als Text und rechts den Speicherstatus als Status-Pill.
5. **UnderlineTabs ohne `motion`.** `motion` ist nicht als Abhängigkeit vorgesehen; der aktive Balken springt statt zu gleiten (wie in der Quelle unter reduzierter Bewegung). Die übrigen Pakete sind aus der offiziellen npm-Registry installiert und exakt gepinnt: `@hugeicons/react` 1.1.10, `@hugeicons/core-free-icons` 4.3.5, `@radix-ui/react-dialog` 1.2.0, `@radix-ui/react-dropdown-menu` 2.1.25, `@radix-ui/react-slot` 1.4.0.
6. **Navigation ohne Rechteverwaltung.** Fünf Bereiche in fester Reihenfolge; nur „Rechnungen“ und „Verwaltung“ haben eine SubNav.
7. **Rechnungseditor.** Keine zweite Speichern-/Verwerfen-Aktion, weil Eingaben bereits automatisch gespeichert werden. Die eine Papiervorschau bleibt in jedem Tab im DOM, damit `printToPDF` sie erfasst; außerhalb des Tabs „Vorschau“ blendet `.screen-hidden` sie nur unter `@media screen` aus. Alle übrigen Editorteile tragen `no-print`. Fehlerhinweise der E-Rechnungsprüfung wechseln in den richtigen Tab, öffnen die Gruppe und fokussieren das Feld; Eingaben bleiben erhalten.

8. **Zustände und Fokus.** Zahlungsentwürfe und der laufende E-Rechnungsexport bleiben beim Tabwechsel erhalten. Bestätigungsdialoge geben den Fokus an ihren tatsächlichen Auslöser zurück; nur nach dessen Entfernung wird der Seiteninhalt fokussiert. Auf schmalen Fenstern berücksichtigt der Ankerabstand beide Kopfzeilen.
9. **PDF-Bereitschaft.** Normaler PDF-Export und E-Mail mit PDF warten begrenzt auf die aktuelle einzelne Vorschau, Schriften und dekodierte Rechnungsbilder. Ein defektes oder nicht rechtzeitig geladenes Logo führt zu einer sichtbaren Meldung und keinem unvollständigen PDF. Druckvorlagen und Beträge bleiben unverändert.
10. **Paketgröße.** Frontend-Icons werden vom Next-Build gebündelt. Die 147MB große Entwicklungsbibliothek wird nicht zusätzlich im Electron-Hauptpaket ausgeliefert; der vollständige Standalone-Server bleibt erhalten. Die ungenutzten früheren Lucide-/Akkordeon-Pakete sind entfernt.
