# Designprüfung Helferlein

Stand: 27.10.2026. Umfang: Desktop-Oberfläche und zentrale Rechnungsabläufe. Die aktuelle Humaify-Familie liefert die Primitives und Kompositionsmuster; die Inhalte und Aufgaben stammen aus Helferlein.

## Visuelle Grundlage und Vergleich

- Quellen: [Designverträge und Übernahmematrix](docs/design-reference.md), Paper `2MTE-0`, unverändert gerenderte Overwatch-Styleguide-Komponenten mit fiktiven Daten.
- Quellbilder: `/home/mika/Work/invoice-app/artifacts/design-capture/03-overwatch-shell.jpg` und `04-overwatch-list-pattern.jpg`.
- Geprüfter Produktionsbuild: `http://127.0.0.1:3128`.
- Ergebnisbilder: [Rechnungen](docs/screenshots/rechnungen.jpg), [Editor](docs/screenshots/editor.jpg), [Vorschau](docs/screenshots/vorschau.jpg).
- Desktop-Messung: Browserfenster 1422 × 800 CSS-Pixel, DPR 0,9; Quell- und Ergebnisaufnahmen 1562 × 889 Pixel. Die vollständige Vorschau misst 1561 × 1876 Pixel. Native Rundung und Scrollleisten werden nicht als Gestaltungsunterschied bewertet.
- Quelle und Umsetzung wurden gemeinsam im selben Bildvergleich geöffnet. Firmenverzeichnis und Rechnungsverzeichnis haben unterschiedliche fachliche Inhalte. Verglichen wurden Rahmen, Typografie, Ausrichtung, Tabellenrhythmus, Controls und Zustände. Die Details waren in den vollständigen Bildern lesbar; zusätzliche Ausschnitte waren nicht erforderlich.

## Befunde und Nachprüfung

Die erste Prüfung identifizierte verlorene Zahlungsentwürfe und Exportzustände beim Tabwechsel, eine beim ersten Buchstaben zuklappende Absendergruppe, eine unbeabsichtigte Änderung der Menge null bei erneutem Wählen desselben Zeilentyps, fehlende Fokusrückgabe aus Bestätigungsdialogen und zu kleine Schließen-Ziele. Diese Punkte sind korrigiert. Menüs bleiben innerhalb der verfügbaren Höhe scrollbar; mobile Anker berücksichtigen beide Kopfzeilen.

Die visuelle Nachprüfung bestätigt horizontale Bereichsnavigation, objektbezogene Tabs, eine zusammenhängende Formularspalte und eine lesbare separate Papiervorschau. Suchfelder nutzen die verfügbare Breite. Der Bezahlt-Filter zeigt den sichtbaren Zahlungsstatus und ordnet leere Entwürfe nicht als bezahlt ein.

Bewusste Lesbarkeitsabweichungen: größere Controls und Schriftstufen, dunkler Text auf dem Quellblau, Sekundärtext mit dem bestehenden `ink-body`-Token. Inter/Roboto Mono stammen aus den lizenzierten lokalen Quelldateien. Haarlinien, Radien und Farben folgen den Designquellen. Es gibt keine neu erfundenen Bildassets oder Humaify-Embleme; Hugeicons liefert die Bedienelement-Symbole.

## Geprüfte Abläufe

1. Regulärer Import eines fiktiven Schema-1-Bestands in der vorherigen Oberfläche; danach sechs Rechnungen, drei Kunden und drei Produkte im neuen Build erhalten.
2. Suche, Zahlungsfilter und Rücknavigation; Teilzahlung weiterhin 699,36 € gesamt, 250,00 € bezahlt und 449,36 € offen.
3. Zahlungsentwurf `120,50` und Referenz bleiben beim Wechsel Vorschau → Zahlungen erhalten.
4. Menge null bleibt nach erneutem Wählen von „Position“ null; anschließend Ausgangswert wiederhergestellt.
5. Leerer Absender bleibt beim ersten Buchstaben geöffnet und fokussiert; Änderung über Reload erhalten und anschließend Ausgangswert wiederhergestellt.
6. E-Rechnungsprüfung öffnet fehlende Angaben; Fehlerlink fokussiert das konkrete strukturierte Adressfeld. Eingaben werden nicht verworfen.
7. Löschdialog nur geöffnet und abgebrochen; Escape gibt den Fokus an „Weitere Aktionen“ zurück. Keine Rechnung gelöscht.
8. Kunden, Produkte, Einstellungen, Datensicherung und Auswertung über die sichtbare Navigation geöffnet. Browserkonsole ohne Warnungen oder Fehler.
9. Lange Rechnung mit 20 Positionsfeldern und unverändertem Betrag 1.368,60 € geöffnet; der übernommene Anhang bleibt mit Download-Aktion sichtbar. Kein horizontales Überlaufen im gemessenen Desktopfenster.

Typprüfung, ESLint, 46 Tests ohne übersprungene Fälle und Produktionsbuild sind erfolgreich. Die Tests umfassen echte lokale PDF/A-/XML-Validierung sowie sieben zusätzliche Fälle für Schrift-/Bildbereitschaft, defekte Bilder und Zeitlimits vor dem Druck. Das native Linux-Paket besteht Export, Server und CSS mit gebündeltem Electron/Java.

## Grenzen

Die angebotene Browser-Größensteuerung änderte die gemessene Fensterbreite nicht. Ein 320px-/Touch-Test ist deshalb nicht als bestanden ausgewiesen; das responsive Layout und die Touch-Regeln wurden im Code geprüft. Reale Mac-Bedienung, Gatekeeper und Upgrade mit einer Kopie des tatsächlichen Datenordners bleiben Teil der Releaseprüfung. Die normale Bildschirmvorschau wurde visuell geprüft; das unveränderte anpassbare Drucklayout wurde in dieser Runde nicht auf einem physischen Mac gedruckt. Vollständige Barrierefreiheit wird nicht behauptet.

final result: passed
