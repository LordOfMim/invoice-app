# Helferlein

Lokale Rechnungsverwaltung für macOS, mit Kunden, Produkten, Vorlagen, Zahlungen, Gutschriften und JSON-Sicherungen. Daten bleiben auf dem Gerät; die installierte App und ihre E-Rechnungsexporte funktionieren offline.

## Entwickeln und prüfen

Node.js ab 22.12 verwenden. Abhängigkeiten sind exakt gepinnt.

```sh
npm ci
npm run dev
```

Die Webansicht öffnet die Rechnungsliste unter `http://localhost:3000`. Für die Desktop-App `npm run electron:dev` verwenden. Die geprüften E-Rechnungsexporte benötigen die einmalige Vorbereitung mit `npm run einvoice:prepare`; gewöhnlicher Druck/PDF bleibt davon unabhängig.

```sh
npm run einvoice:prepare
npm run check
npm run build:app
```

`EINVOICE_REQUIRE_INTEGRATION=1` verhindert, dass ein fehlender lokaler Validator in Release-Prüfungen als übersprungener Test durchgeht. Die CI verwendet diese Einstellung und prüft XML sowie echte mehrseitige PDF/A-Dateien.

## Desktop-Pakete

```sh
npm run electron:build:mac -- --arm64 --publish never
npm run electron:build:mac -- --x64 --publish never
npm run electron:build:win -- --x64 --publish never
npm run electron:build:linux -- --x64 --publish never
```

Intel und Apple Silicon werden getrennt gebaut. Der Build lädt die passende Java-Laufzeit, den Rechnungsvalidator und eingebettete Schriftdateien aus gepinnten offiziellen Quellen, prüft ihre SHA256-Prüfsummen und packt sie mit ein. Auf dem Rechner des Nutzers ist keine Java- oder Node-Installation nötig. Die Quellen unter `electron/einvoice-runtime` und `electron/einvoice-assets` sind generierte, ignorierte Buildressourcen.

Die macOS-Mindestversion bleibt mit Electron 43 bei macOS 12. Ein neuer Electron-Hauptversionssprung muss gegen die tatsächlich eingesetzte macOS-Version geprüft werden. Abhängigkeiten und E-Rechnungsregeln brauchen regelmäßige Wartung; eine unbegrenzt unveränderte Installation kann nicht für zukünftige Betriebssysteme zugesichert werden.

Die CI erzeugt getrennte Mac-DMGs und Windows-Installer als Prüfartefakte. Ein Build ohne Apple-Zertifikat ist nicht signiert oder notarisiert. Veröffentlichungen bleiben Entwürfe; vor der Freigabe sind Signierung, Gatekeeper und der Upgrade-Test auf echten Macs erforderlich.

## Bestandsdaten und Upgrade

Anwendungs-ID, Produktname „Helferlein“, Speicherschlüssel und bisherige Verschlüsselung bleiben erhalten. Daten liegen auf macOS weiterhin unter `~/Library/Application Support/Helferlein`. Das neue optionale E-Rechnungsmodell erfordert keine Umwandlung alter Rechnungen. Beim ersten Start einer neuen Version sichert Helferlein die vorhandene verschlüsselte Datei zusätzlich unverändert. Vor dem Installationswechsel trotzdem den vollständigen Datenordner kopieren und eine JSON-Sicherung aus der alten App exportieren.

Eine vorhandene gültige Desktop-Sicherung ist immer maßgeblich, auch wenn sie bewusst leer ist. Ungültige Daten werden nicht durch einen leeren Bestand ersetzt. Vor einem JSON-Import wird der bisherige Stand zusätzlich gesichert. Bei nicht lesbaren Daten bietet die Oberfläche Originalexport und Wiederherstellung an. Alte browserbasierte Daten eines anderen historischen localhost-Ports müssen aus der alten App als JSON exportiert werden.

- [Upgrade- und Mac-Prüfung](docs/macOS-upgrade.md)
- [E-Rechnungen, unterstützte Fälle und technische Prüfung](docs/einvoice.md)
- [Umsetzung, Prüfstand und Freigabe](docs/modernization.md)
- [Bisherige Produktanforderungen](REQUIREMENTS.md)
