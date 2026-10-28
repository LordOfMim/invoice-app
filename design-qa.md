# Designprüfung Helferlein

Stand: 28.10.2026. Folgeauftrag: linke Navigation, Eingaben und Live-Vorschau nebeneinander, zurückhaltende macOS-Anmutung. Grundlage sind die akzeptierten Humaify-/Werknetz-Primitives und die in [design-reference.md](docs/design-reference.md) verlinkten Apple-Richtlinien.

## Aktueller Prüfstatus

Implementierung, Funktionsprüfung und die unabhängige visuelle Claude-Abnahme sind abgeschlossen. **Claude Opus 5.5 im vorhandenen Team-Abo: ACCEPTED (visual/static, qualified).** Der Reviewer prüfte die korrigierten aktuellen Bilder und den Quellcode nach; es bestehen keine weiteren erforderlichen Befunde für diese Oberflächeniteration. Dies ist keine Freigabe einer produktiven Mac-Installation.

Die Bilder unter `docs/screenshots/` sind neue Aufnahmen des aktuellen Produktionsbuilds vom 28.10.2026. Nach dem Ausfall der eingebetteten Screenshot-Funktion genehmigte der Nutzer ausdrücklich einen separaten lokalen Playwright-Browser. Verwendet wurden System-Chromium unter Linux, ein neuer nichtpersistenter BrowserContext und ausschließlich künstliche Testdaten; weder bestehende Browserprofile noch echte Mac-Daten wurden geöffnet. Es gab keine CSS-/DOM-Overrides oder nachgestellte Oberflächen. Mac-Systemschrift, native Fensterleiste und das vom Betriebssystem formatierte Datum sind damit nicht bildlich nachgewiesen.

Die unabhängige Abnahme erfolgte über Claude Code mit `claude-opus-5-5`, `apiKeySource: none`, im bestehenden Abo. Zunächst wurden die Überlappung bei 960px, Schriftgrößen, Navigationslandmarks, Zoom-Ansagen und erste Layoutmessung korrigiert. Die anschließende Bildprüfung fand einen ungünstigen Wortumbruch im Sidebar-Eintrag. Claude korrigierte diesen durch einen gezielten weichen Trennstrich, erhielt den aktuellen Pfad bei 320px und entfernte den doppelten Vorschauhinweis im breiten Arbeitsplatz. Neue Aufnahmen wurden danach erneut unabhängig lesend geprüft und akzeptiert. Das Prüfprotokoll meldet keine Änderung durch den Reviewer.

Der anschließende Nutzerwunsch ergänzt das originale Helferlein-Logo oben links im App-Kopf. Die PNG-Datei bleibt bytegleich; ein SVG-Ausschnitt blendet ausschließlich ihren transparenten Rand aus. Nach dem Wunsch „bisschen kleiner“ beträgt die Wortmarke 120×30px, das H-Zeichen unter 640px 28×28px; die klickbare Fläche bleibt mindestens 40px hoch und breit. Beide Varianten führen mit dem zugänglichen Namen „Helferlein“ zur Rechnungsliste. Alle zehn Ansichten wurden neu aufgenommen; Typprüfung, Lint und Produktionsbuild bestanden erneut. Claude akzeptierte die kleinere Fassung unabhängig anhand von Quellcode und neuen Bildern. Die echte eingebettete Vorschau wurde neu geladen und misst ebenfalls 120px Linkbreite ohne Seitenüberlauf. Absenderlogos und Rechnungsdokumente wurden nicht verändert.

Aktuelle Bildnachweise: [Rechnungen](docs/screenshots/rechnungen.jpg), [Editor](docs/screenshots/editor.jpg), [Positionen mit rechter Vorschau](docs/screenshots/vorschau.jpg), [schmales Fenster](docs/screenshots/schmal.jpg), [Navigationsmenü](docs/screenshots/menue.jpg), [Kunden](docs/screenshots/kunden.jpg). Das [Aufnahmemanifest](docs/screenshots/manifest.json) enthält Quellbezug, Fenstergrößen und Bildprüfsummen.

## Geprüfte Abläufe

Produktionsbuild auf `http://127.0.0.1:3128`, ausschließlich fiktive lokale Daten. Die sechs vorhandenen Rechnungen blieben erhalten. Für den Erstellungsablauf kam eine siebte Demo-Rechnung hinzu. Kein echter Datenordner des installierten Mac wurde geöffnet oder verändert.

1. **Navigation:** Alle elf bisherigen Ziele sind als beschriftete Einträge der linken Leiste vorhanden. Der aktuelle Listeneintrag und zugehörige Detailseiten sind markiert. Die horizontale Haupt-/Unterbereichsnavigation entfällt.
2. **Neue Rechnung:** Direkt nach „Neue Rechnung“ stehen Eingaben und Live-Vorschau gleichzeitig im DOM und sichtbar nebeneinander. Nummer, Empfänger, Beschreibung, Menge `2` und Einzelpreis `120,50` wurden über die Oberfläche erfasst. Vorschau und Eingaben zeigen übereinstimmend `241,00 €` netto, `45,79 €` Steuer und `286,79 €` gesamt. Der Einzelpreis behielt während der Eingabe den Fokus.
3. **Einpassen und Zoom:** Bei 1422 CSS-Pixeln ist das Formular etwa 519px breit. Die eingepasste Papierbreite beträgt etwa 521px; der Vorschaucontainer hat 555px Innenbreite einschließlich Padding. Bei 100% Zoom scrollt ausschließlich die Vorschau horizontal; die Seite läuft nicht über. „Einpassen“ stellt die passende Breite wieder her. Es gibt stets genau ein `#invoice-preview`.
4. **Bereichswechsel und Entwürfe:** Zahlungsentwurf `120,50` und Referenz bleiben über Gestaltung, E-Rechnung und Fenstergrößenwechsel erhalten. Die Vorschau bleibt im breiten Arbeitsplatz auch neben diesen Bereichen sichtbar. Es wurde keine Zahlung gespeichert.
5. **E-Rechnung:** Fehlende Pflichtangaben verhindern den Export und öffnen die betroffenen Gruppen. Der Fehlerlink für die Straße des Rechnungsstellers fokussiert `f-einvoice-seller-street`, nachdem der vorgesehene doppelte Animation-Frame abgelaufen ist. Die Vorschau bleibt erhalten.
6. **Fenstergrößen und Fokus:** Gemessene Breiten 1422, 1280, 1088 und 320 CSS-Pixel bei DPR etwa 0,9. Bei 1280 stehen beide Arbeitsspalten nebeneinander. Bei 1088 wechselt der Arbeitsplatz auf Eingaben/Vorschau. Beim Verkleinern bleibt eine fokussierte Vorschau sichtbar; beim Vergrößern wechselt der Fokus vom verschwindenden Vorschau-Umschalter in deren Scrollbereich. Bei 320 gibt es Menü und Ansichtsumschalter, ohne horizontales Seitenüberlaufen; das Papier passt sich bis ungefähr 30% an. Temporäre Viewportvorgaben wurden zurückgesetzt. Dies war kein physischer Touch-Test.
7. **Kleines Navigationsmenü:** Das Radix-Sheet zeigt dieselben elf Ziele. Escape schließt es und gibt den Fokus an den Menüauslöser zurück; die ausblendende Animation wurde vor der Fokusprüfung abgewartet.
8. **Bestehende lange Rechnung:** DEMO-2026-105 enthält weiterhin 18 Mengenpositionen plus zwei Überschriften, `1.150,08 €` netto, `218,52 €` Steuer und `1.368,60 €` gesamt. Hinweistext, beide Fußzeilen und `DEMO-Dokumentation.txt` mit Download-Aktion bleiben vorhanden. Der Vorschau-Scrollbereich erreicht das Ende der etwa 2532px hohen Darstellung; die Fußzeile liegt innerhalb seiner Begrenzung. Kein horizontales Seitenüberlaufen.
9. **Browsermeldungen:** Die frühere eingebettete Funktionsprüfung meldete keine Warnungen oder Fehler. Die neue Aufnahme-Serie enthält keine JavaScript-Ausnahme; Chromium meldete zusätzlich einen einzelnen HTTP-404-Ressourcenabruf. Das ist kein Beleg für einen fehlerhaften Rechnungsablauf, seine Ursache wurde nicht als Anwendungsfehler bestätigt.

## Technische Prüfungen

Erfolgreich: `npm ci` (Audit ohne bekannte Schwachstellen), `npm run einvoice:prepare`, `EINVOICE_REQUIRE_INTEGRATION=1 npm run check` (Typprüfung, ESLint, 46 bestandene Tests, keine übersprungenen Tests) und `npm run build:app`. Die Tests enthalten echte lokale XML-/PDF/A-Validierung und die bestehenden sieben Fälle zur Druckbereitschaft. Keine Tests oder Abhängigkeiten wurden für diese Iteration geändert.

Das neu gebaute native Linux-Paket besteht `scripts/smoke-packaged.mjs`: ZUGFeRD-PDF, XRechnung-XML und Standalone-Server/CSS mit den tatsächlich gebündelten Electron-/Java-Laufzeiten. Das belegt keine normale Druckvorschau oder macOS-Installation.

Quellprüfung durch Root und zwei unabhängige Sol-Reviews: einzelne Vorschau, dauerhaft montierte Eingabepanels, lokale Containerqueries, unveränderte Speicher-/Betragslogik und vollständige Druck-Overrides für die neuen Grid-/Sticky-/Scroll-Vorfahren. Die Fokuserhaltung für beide Spalten wurde ergänzt und anschließend über die Oberfläche geprüft.

## Normaler Mehrseiten-PDF-Druck

Zusätzlich zum separaten archivfesten E-Rechnungs-Export wurden neun normale Chromium-PDFs mit den produktiven Druck-CSS-Regeln erzeugt: Classic, Modern und Minimal, jeweils eingepasst, bei 150 Prozent Bildschirmzoom und aus der 840px breiten Eingaben-Ansicht mit auf dem Bildschirm versteckter Vorschau. Die lange Schema-1-Testrechnung erhielt ausschließlich im getrennten Testbrowser ein synthetisches DEMO-Logo. Der Druck verwendet dieselben Optionen `printBackground` und `preferCSSPageSize` wie Electron; er lief über Playwright `page.pdf`, nicht über das native Electron-Druckfenster.

Alle neun PDFs umfassen sechs A4-Seiten. Sämtliche 18 Mengenpositionen plus zwei Gliederungszeilen, vollständige Hinweise, `1.368,60 €` Gesamtbetrag und beide Fußzeilen sind enthalten; keine Editor-/Navigationsreste. Innerhalb jeder Vorlage sind alle sechs gerenderten Seiten zwischen Einpassen, 150 Prozent und versteckter Vorschau jeweils pixelidentisch. Alle 18 Vorlagenseiten wurden visuell geprüft: Logo, Tabellenfortsetzungen, Summen und Ende ohne abgeschnittene Inhalte oder Überlappungen. Claude sichtete zusätzlich sieben repräsentative Seiten und die vollständige Hash-/Inhaltsprüfung. Vorhandene lange Kontaktzeilen und die große Zeilenhöhe der Rechnungsvorlagen wurden nicht umgestaltet.

## Verbleibende Releaseprüfungen

- Reale macOS-Systemschrift, Fensterleiste, Datumsformat, Trackpad/Scrollverhalten und native Menü-Vergrößerung auf einem echten Mac prüfen.
- Das native Electron-Druckfenster beziehungsweise der Druckdialog des Ziel-Mac ist durch die Chromium-PDF-Prüfung nicht getestet.
- Gatekeeper, Signierung/Notarisierung und Upgrade mit einer Kopie des tatsächlichen Datenordners bleiben vor produktiver Installation erforderlich. Keine vollständige Barrierefreiheit oder sichere Produktionsmigration auf dem Zielgerät wird behauptet. Die tatsächlichen Daten des installierten Macs wurden nicht verändert.

final result: functional and Chromium print checks passed; independent Claude visual/static acceptance passed (qualified); physical Mac and release acceptance pending
