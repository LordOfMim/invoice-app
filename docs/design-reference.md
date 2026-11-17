# Designreferenz für Helferlein

Stand: 16.11.2026. Die Oberfläche folgt seit Version 1.3.0 dem **Palermo Design System** (öffentliche Dokumentation: `https://palermo.tryprofound.com/docs`, gelesen im November 2026: Farben, Typografie, Button, Input, Tabs, Table, Card, Badge, Alert, Checkbox, Switch, Dialog, Dropdown).

Palermo ist das Designsystem von Profound und nicht als Paket veröffentlicht; eine Lizenz ist in der Dokumentation nicht genannt. Helferlein übernimmt deshalb keinen Code und keine Marken daraus, sondern baut die dokumentierten Werte (Farben, Abstände, Radien, Schatten, Schriftstufen) in den eigenen Bausteinen nach. Schrift bleibt die lokal gebündelte Inter Variable (OFL), auf dem Mac die Systemschrift; es gibt keine Netzwerkabfragen.

## Wo was liegt

| Bereich | Datei |
| --- | --- |
| Tokens (Farben, Radien, Schatten, Schriftstufen, Bewegung) | `src/app/platform-theme.css` |
| Schriftgröße der App (`data-ui-scale`), Druckfläche `.invoice-paper` | `src/app/globals.css` |
| Bausteine (Button, Input, Tabs, Badge, Alert, Dialog, Menü …) | `src/components/platform/*` |
| App-Fassaden in Lesegröße (Button, Input, DataTable, Layout, Status …) | `src/components/ui/*` |
| Rahmen (Seitenleiste 240px, Kopfzeile 48px) | `src/components/shell/*` |

Die Token-Namen (`ink`, `surface`, `line` …) stammen aus der früheren Gestaltung und wurden beibehalten, damit Seiten ihre Klassen behalten; ihre Werte sind die von Palermo.

## Zuordnung der Tokens

| Helferlein | Palermo | Wert (hell) |
| --- | --- | --- |
| `ink` | text-primary / fill-primary | `#18181a` |
| `ink-secondary`, `ink-body`, `ink-muted` | text-secondary (abgedunkelt, Abweichung 1) | `#636363` |
| `ink-soft` | text-secondary | `#787878` |
| `ink-faint` | text-tertiary (Platzhalter) | `#969696` |
| `ink-disabled` | text-quaternary | `#b4b4b4` |
| `surface` | bg-primary | `#ffffff` |
| `surface-rail`, `surface-subtle` | bg-sidebar / bg-secondary | `#fafafa` |
| `surface-muted` | bg-tertiary / control-hover | `#f5f5f5` |
| `surface-selected` | control-selected | `#f1f1f1` |
| `surface-pressed` | bg-quaternary | `#e8e8e8` |
| `line*` | fill-quaternary, fill-tertiary | `#e8e8e8`, `#d4d4d8` |
| `fill`, `fill-hover` | control-primary | `#18181a`, `#2c2c2e` |
| `danger`, `warn`, `success`, `accent-blue` mit `-ink`, `-line`, `-tint` | Palette rot, amber, grün, blau: Basis, emphasis, border, muted fill | oklch-Werte der Dokumentation |
| `shadow-low`, `shadow-medium`, `shadow-high` | shadow-low / medium / high (jeweils mit 1px-Kante) | siehe Datei |
| Radien `micro, sm, md, lg, card-sm, card, pill` | 4, 6, 8, 10, 12, 16, rounded | |
| Schrift `xs/sm`, `md/base`, `lg/xl`, `title`, `display`, `display-xl` | body-mini 12/16, body-small 13/18, body-regular 14/20, title-mini 18/24, title-small 24/32, title-regular 28/32 | |

## Regeln aus Palermo

- Primär- und Sekundärtext für fast alles; die dritte Stufe nur für Platzhalter und sehr leise Angaben.
- Ein Schatten bringt seine Kante mit. Eine Fläche mit `shadow-*` bekommt keinen zusätzlichen Rahmen. Trennlinien innerhalb einer Fläche bleiben Haarlinien (`line`).
- Primäre Aktion: fast schwarze Fläche mit weißer Schrift, höchstens eine je Ansicht. Sekundär: weiße Fläche mit `shadow-low`. Ghost: transparent, Hover `surface-muted`.
- Schaltflächen und Felder: Radius 8px, Text 13–14px, mittel. Karten: Radius 12px, `shadow-medium`. Dialoge und Menüs: `shadow-high`.
- Tabs: 48px hohe Zeile, aktiver Reiter mit 2px-Unterstrich. Tabellen: 48px-Zeilen, Kopf 13px mittel in Sekundärtext, Zahlen tabellarisch.
- Badges und Statusangaben sind Pillen mit Haarlinie; Status immer als Wort mit Farbpunkt.
- Bewegung: Eintritt 150 bis 200 ms auf `--ease-out` (`cubic-bezier(0.23, 1, 0.32, 1)`), Austritt kürzer (Menü 100 ms, Dialog und Sheet 150 ms); das Sheet öffnet in 400 ms auf `--ease-drawer`. Aufklappbare Abschnitte wachsen über `grid-template-rows`. Häufig Benutztes (Reiter, Tastatur) bewegt sich nicht; keine dauerhaften Animationen; bei reduzierter Bewegung keine.
- Angaben in einer Zeile trennt Abstand (`Facts` in `src/components/ui/Layout.tsx`), kein „·“. Kundendokumente (Druckfläche) sind davon ausgenommen.
- Eine Kennzahl trägt den farbigen Strich nur, wenn sie einen Status ausdrückt.

## Bewusste Abweichungen

1. **Textkontrast.** Fließender Sekundärtext nutzt `#636363` (6:1 auf Weiß) statt `#787878` (4,4:1). Die App wird auch von älteren Nutzern gelesen.
2. **Größen.** Standard für Felder und Schaltflächen ist Palermos große Stufe (38px), Zeilenaktionen die reguläre (28px). Fließtext steht in 14px statt 13px. Auf Touch-Geräten wachsen Ziele auf 44px und Felder auf 16px Text (verhindert den iOS-Zoom); 16px ist die einzige Stufe außerhalb der Palermo-Skala.
3. **Fokus.** Tastaturfokus zeigt einen 2px-Ring in Palermo-Blau. Palermos eigener Halo (3px, 5 % Schwarz) ist zu schwach, um ihn zu finden.
4. **Feldkante.** Textfelder tragen `shadow-control` (Kante 9 % statt 5 %), damit sie als Feld erkennbar sind.
5. **Rot.** Text in Rot nutzt die emphasis-Stufe; rote Schaltflächen `danger-solid` (5:1 mit weißer Schrift) statt der Basisfarbe (3,9:1).
6. **Schriftgröße der App.** Die Einstellung „Schriftgröße“ vergrößert alle Schriftstufen (`data-ui-scale`); Abstände bleiben.
7. **Kein Dunkelmodus.** Palermo dokumentiert dunkle Werte; Helferlein bleibt vorerst hell.
8. **Druckfläche.** Rechnungsvorlagen, Fachunternehmererklärung und Briefe (`.invoice-paper`, `src/components/templates`) sind Kundendokumente und behalten ihre bisherigen Werte. Sie werden nicht nach Palermo umgestellt.
9. **Kopfzeile ohne Weichzeichner.** Palermos Kopfzeile ist halbtransparent mit Blur; Helferlein nutzt eine deckende Fläche (keine dauerhafte GPU-Last).

## Navigations- und Seitenkonzept

Links die Seitenleiste (240px, `surface-rail`) mit gruppierter Navigation ab `lg`, daneben die 48px hohe Kopfzeile mit Pfad und Speicherstatus und darunter die Seite. Unter `lg` ersetzt eine beschriftete Menüzeile mit Sheet die Seitenleiste. Jede Seite beginnt mit Titel, einem Satz zum Zweck und den Aktionen rechts; Abschnitte liegen direkt auf der Seitenfläche, zusammengehörige Zeilen in einer Karte. Der Rechnungsarbeitsplatz zeigt Eingaben und Live-Vorschau nebeneinander, sobald die Breite reicht.

Die frühere Gestaltung (Humaify-Platform-Tokens) ist in der Git-Historie dieser Datei bis Version 1.2.0 dokumentiert.
