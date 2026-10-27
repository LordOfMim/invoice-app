# Lokale E-Rechnungen

Die bestehenden Rechnungen benötigen keine Migration. `Invoice.einvoice` ist optional. Fehlende strukturierte Daten verhindern ausschließlich den E-Rechnungsexport; gewöhnliche PDFs und das Öffnen alter Rechnungen bleiben möglich.

## Export und Datenfluss

`prepareEInvoice(invoice, 'zugferd' | 'xrechnung')` in `src/lib/einvoice/index.ts` liefert `{ ok, errors: [{ field, message }], document? }`. Nur ein erfolgreich vorbereitetes Dokument an die Electron-Bridge übergeben. `validateEInvoice` liefert dieselben Feldfehler ohne Mutation der Rechnung. Keine Adressdaten, Steuernummern oder Leitweg-IDs werden aus Freitext geraten.

Der Electron-Main-Prozess ruft `exportEInvoice({ format, document, runtimeDir?, assetsDir? })` aus `electron/einvoice.cjs` auf. Ergebnis: `{ bytes: Buffer, extension, mimeType, validation }`. Erst danach einen Speicherdialog öffnen beziehungsweise die Datei schreiben. `getEInvoiceRuntimeStatus()` kann fehlende Installationsressourcen vorab melden. Die Pfade kommen ausschließlich aus dem Main-Prozess, nicht vom Renderer.

- **XRechnung:** eigenständige CII-XML, Profil `urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0`. Eine XML-Datei innerhalb eines PDFs ersetzt diesen Export nicht.
- **ZUGFeRD:** PDFKit erzeugt PDF/A-3b mit eingebetteten Noto-Sans-Fonts und sRGB-Farbprofil. `factur-x.xml`, AFRelationship `Alternative`, Factur-X-XMP einschließlich Schemaerweiterung und EN16931-CII werden eingebettet. Das PDF zeigt die strukturierten Namen/Adressen, dieselben Positionen, Steuern und Summen. Editierbare Beschriftungen, PNG/JPEG-Logo, Hinweise und Fußtexte werden berücksichtigt. Das Archivlayout ist bewusst unabhängig von der normalen Druckvorlage.
- Jeder Export läuft **offline** durch Mustangproject 2.26.0 mit dessen XML/Schematron- und veraPDF-Prüfung. Freigabe erfordert gültige XML-/Gesamtberichte; beim PDF zusätzlich das tatsächliche veraPDF-Ergebnis `isCompliant=true`. Ein erfolgreicher Prozess-Exit oder zu Warnungen herabgestufte PDF/A-Fehler reichen nicht. Die Datei wird bei Fehlern nicht zurückgegeben. Temporäre Dateien liegen in einem privaten temporären Ordner und werden im `finally` entfernt.

Die Anwendung erzeugt die CII-Struktur selbst aus dem normalisierten Modell; Konformität wird erst nach der unabhängigen Bibliotheks-/Regelprüfung beansprucht. Allgemeine EN16931-ZUGFeRD-Rechnungen können Hinweise aus Mustangs zusätzlicher XRechnung-Prüfung enthalten (beispielsweise abweichende Profilkennung). Hinweise bleiben im Prüfbericht erhalten; sie machen eine EN16931-Rechnung nicht zur XRechnung.

## Grenzen und Rundung

Unterstützt werden positive Rechnungspositionen, mehrere Umsatzsteuersätze, die global gewählte Kategorie für Nullsteuersätze, Fälligkeit, Bank-/Barzahlung, Leistungsdatum und Steuerbefreiungsgrund. Keine künstlich erfundenen Pflichtangaben. Rabatte, Zuschläge, negative Positionen und separate Gutschriften sind in diesem Modul nicht modelliert.

Die vorhandene `calc.ts` rundet Steuer pro Position; EN16931 verlangt die Berechnung pro Steuergruppe. Wenn diese Ergebnisse voneinander abweichen, wird der Export mit einem deutschen Fehler blockiert. Er verändert keine Beträge stillschweigend. Überschriften mit einem Betrag werden ebenfalls blockiert, da die alte Summenberechnung sie einschließt. Nicht erkannte Freitexteinheiten benötigen einen expliziten UNECE-Code (`einvoice.unitCodes[item.id]`). Beschreibungen, die eine gesamte Tabellenseite überschreiten, müssen in mehrere Positionen aufgeteilt werden. Mehrseitige Tabellen wiederholen den Tabellenkopf; Summen und nachfolgende Texte erhalten Seitenumbrüche.

Die technische Prüfung ersetzt keine Prüfung der tatsächlichen Leistungen, Steuersachverhalte, Empfängeranforderungen und Übermittlungswege. `payments` ist eine interne Zahlungsübersicht; der Export beschreibt den ursprünglichen Rechnungsbetrag und setzt keine beliebigen Zahlungseingänge als steuerliche Vorauszahlungen um.

## Reproduzierbares Desktop-Paket

Runtime-Abhängigkeit: exakt gepinntes `pdfkit` (im integrierten Projekt 0.20.2). PDFKit muss einschließlich seiner `js/data`-ICC-Ressource als Node-Paket verfügbar bleiben. Kein System-Java und kein externer Dienst sind zur Nutzung erforderlich, **wenn** die unten genannten Ressourcen gebündelt wurden.

Vor jedem Release-Build die zum Ziel passende Laufzeit vorbereiten und anschließend prüfen:

```sh
node scripts/einvoice-prepare.mjs --platform darwin --arch arm64
node scripts/einvoice-prepare.mjs --platform darwin --arch arm64 --check
```

Unterstützte Ziele: `darwin/arm64`, `darwin/x64`, `linux/x64`, `win32/x64`. Mac-Architekturen getrennt bauen; ein gemeinsames Ressourcenverzeichnis darf nicht gleichzeitig für beide Architekturen verwendet werden. Für Windows wird das offizielle ZIP entpackt (Windows-BSD-tar; beim Cross-Build auf Unix `unzip`).

Das Build-Skript lädt nur gepinnte offizielle Quellen, prüft SHA256 vor dem Entpacken und schreibt ein Manifest mit Dateiprüfsummen. Pins: Mustangproject **2.26.0**; Eclipse Temurin JRE **21.0.13+9** (Mac/Linux), **21.0.12.1+1** (Windows); Noto-Fonts-Commit `ffebf8c1ee449e544955a7e813c54f9b73848eac`. Das Skript lädt auch OFL und legt Lizenzhinweise ab. Java-Lizenzen/Notices im JRE und Abhängigkeitsinformationen im Mustang-JAR mitliefern. Pin-Updates sind bewusste Wartungsänderungen und benötigen erneute Exporttests.

Mit dem fertigen Paket ausliefern:

- `electron/einvoice*.cjs`
- `electron/einvoice-runtime/**` (JRE, Mustang-JAR, Manifest, Notices)
- `electron/einvoice-assets/**` (beide TTFs, OFL)
- `node_modules/pdfkit` und dessen Produktionsabhängigkeiten/ICC-Daten

Die Standardpfade des Helpers sind relativ zu `electron/einvoice.cjs`. Bei `extraResources` den tatsächlichen Pfad über `runtimeDir`/`assetsDir` aus `process.resourcesPath` übergeben. Release-Checks müssen ohne Ressourcen fehlschlagen; das normale Entwicklungs-PDF benötigt diese Ressourcen nicht. macOS-Signierung muss die eingebettete Java-Laufzeit einschließen; Signierung/Notarisierung auf echten Mac-Builds prüfen.

## Tests und belegter Stand

```sh
node scripts/einvoice-prepare.mjs --platform linux --arch x64
EINVOICE_REQUIRE_INTEGRATION=1 node tests/einvoice/export.test.cjs
```

Abweichende Prüfpfade: `EINVOICE_RUNTIME_DIR`, `EINVOICE_ASSETS_DIR`. Mit `EINVOICE_TEST_OUTPUT_DIR` wird die mehrseitige Testdatei zur Sichtprüfung abgelegt. Ohne Ressourcen werden reine Daten-/Fehlerprüfungen ausgeführt und der Integrationstest sichtbar übersprungen. Release-CI muss `EINVOICE_REQUIRE_INTEGRATION=1` verwenden.

Am 27.10.2026 lokal geprüft: echte XRechnung-CII und echtes ZUGFeRD-PDF bestanden Mustang 2.26.0; PDF/A-3b wurde mit dessen integriertem veraPDF bestätigt. Dieselbe XRechnung bestand zusätzlich den offiziellen **KoSIT Validator 1.6.3** mit **Konfiguration 2026-08-31**, Ergebnis **ACCEPTABLE**, Schema und Schematron erfolgreich. Die automatisierte Integration prüft außerdem 65 Handwerkerpositionen über mehrere Seiten, Steuerbefreiung und den tatsächlichen Ablehnungsfall einer fehlenden steuerlichen Verkäuferkennung.

Aktuelle Standards laut Herausgebern am Recherchetag: XRechnung **3.0.2** (4.0 nur Vorversion), ZUGFeRD **2.5.2 / Factur-X 1.09.2**. Das Paket behauptet keine automatisch aktuelle Regelversion: es verwendet die oben explizit gepinnte Validator-Version und meldet sie im Prüfbericht.

Quellen:

- [KoSIT: Format, Konformität, aktuelle Version](https://xeinkauf.de/xrechnung/)
- [KoSIT: aktuelle Prüfkonfiguration und Releaseänderungen](https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/tag/v2026-08-31)
- [FeRD: veröffentlichte ZUGFeRD-Versionen](https://www.ferd-net.de/downloads/veroeffentlichungen)
- [FNFE-MPE: Factur-X und Profile](https://fnfe-mpe.org/factur-x/)
- [Mustangproject Quellcode und Apache-2.0-Lizenz](https://github.com/ZUGFeRD/mustangproject)
- [PDFKit: PDF/A-Voraussetzungen](https://pdfkit.org/docs/getting_started.html)
- [veraPDF: PDF/A-Validierung](https://docs.verapdf.org/cli/validation/)
