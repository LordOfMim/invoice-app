# Designprüfung Helferlein

Stand: 27.10.2026. Folgeauftrag: linke Navigation, Eingaben und Live-Vorschau nebeneinander, zurückhaltende macOS-Anmutung. Grundlage sind die akzeptierten Humaify-/Werknetz-Primitives und die in [design-reference.md](docs/design-reference.md) verlinkten Apple-Richtlinien.

## Aktueller Prüfstatus

Implementierung und Funktionsprüfung sind abgeschlossen. **Neue Bildaufnahmen, visuelle Abnahme und die vom Nutzer verlangte unabhängige Claude-Abnahme stehen noch aus.** Die Bilder unter `docs/screenshots/` zeigen bislang den früheren horizontalen Entwurf; sie sind kein Nachweis für diese Iteration. Der aktuelle Stand darf nicht mit der früheren visuellen Freigabe gleichgesetzt werden.

Der eingebettete Browser konnte DOM, Accessibility, Eingaben und tatsächliche Layoutmaße liefern, aber keine Screenshots. Geprüft wurden die dokumentierten Aufnahmewege, ein frischer Tab, eine neue Verbindung und wirksame Viewportwechsel; die Bildaufnahme meldete weiterhin „Unable to capture screenshot“. Es wurden keine alten Bilder als aktuelle Aufnahmen ausgegeben. Die Nachprüfung soll die neuen Ansichten aufnehmen und erst danach die Ergebnisbilder ersetzen.

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
9. **Browsermeldungen:** Keine Warnungen oder Fehler während der geprüften Abläufe.

## Technische Prüfungen

Erfolgreich: `npm ci` (Audit ohne bekannte Schwachstellen), `npm run einvoice:prepare`, `EINVOICE_REQUIRE_INTEGRATION=1 npm run check` (Typprüfung, ESLint, 46 bestandene Tests, keine übersprungenen Tests) und `npm run build:app`. Die Tests enthalten echte lokale XML-/PDF/A-Validierung und die bestehenden sieben Fälle zur Druckbereitschaft. Keine Tests oder Abhängigkeiten wurden für diese Iteration geändert.

Das neu gebaute native Linux-Paket besteht `scripts/smoke-packaged.mjs`: ZUGFeRD-PDF, XRechnung-XML und Standalone-Server/CSS mit den tatsächlich gebündelten Electron-/Java-Laufzeiten. Das belegt keine normale Druckvorschau oder macOS-Installation.

Quellprüfung durch Root und zwei unabhängige Sol-Reviews: einzelne Vorschau, dauerhaft montierte Eingabepanels, lokale Containerqueries, unveränderte Speicher-/Betragslogik und vollständige Druck-Overrides für die neuen Grid-/Sticky-/Scroll-Vorfahren. Die Fokuserhaltung für beide Spalten wurde ergänzt und anschließend über die Oberfläche geprüft.

## Offene Abnahme und Grenzen

- Neue Screenshots und tatsächlicher Bildvergleich der Sidebar, des Rechnungsarbeitsplatzes und weiterer Seiten.
- Unabhängige Abnahme durch Claude Opus 5.5 im vorhandenen Abo nach dessen Nutzungslimit-Reset am 28.10.2026 um 00:20 Uhr (Europe/Berlin). Erst danach Abschlussbericht und Telegram-Bilder.
- Normalen mehrseitigen Druck/PDF mit dem neuen Screenlayout praktisch prüfen; die CSS-Prüfung und der separate archivfeste E-Rechnungs-Export ersetzen diesen Nachweis nicht.
- Die Mac-Systemschrift wird unter Linux nur als korrekte Font-Fallback-Reihenfolge geprüft. Reales macOS-Look-and-Feel, Gatekeeper, Signierung/Notarisierung und Upgrade mit einer Kopie des tatsächlichen Datenordners bleiben Releaseprüfungen. Keine vollständige Barrierefreiheit oder sichere Produktionsmigration wird behauptet.

final result: functional checks passed; visual and Claude acceptance pending
