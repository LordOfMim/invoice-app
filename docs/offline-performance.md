# Speicher- und Performanceprüfung, 28.10.2026

Die Desktop-App überträgt bei normalen Änderungen kleine Deltas an genau einen Hintergrund-Worker. JSON-Serialisierung, Verschlüsselung, Dateiprüfung und Synchronisierung laufen dort. Die Oberfläche veröffentlicht eine Änderung erst nach synchroner Annahme in die Warteschlange; „Lokal gespeichert“ erscheint erst nach bestätigtem Schreiben der zugehörigen Revision. Gleichwertige Änderungen erzeugen keinen Schreibauftrag. Der Browser-Fallback speichert weiterhin vollständige JSON-Snapshots synchron.

## Vergleich mit 10.000 Rechnungen

Synthetische Linux-Messung auf AMD Ryzen AI 7 350 / Node 26.7.0, fünf Stichproben nach Aufwärmen. Jede Rechnung enthält zehn Positionen; zusätzlich wurden 1.000 und 5.000 Rechnungen sowie Bestände mit insgesamt 16 MiB Base64-Anhängen geprüft. Der Gesamtbestand bei 10.000 Rechnungen umfasst etwa 47,5 MiB ohne beziehungsweise 63,5 MiB mit diesen Anhängen. Vergleichsbasis ist der eingefrorene Stand `8603538`.

| Vorgang | Vorher, Median | Danach, Median |
| --- | ---: | ---: |
| Einzelne Rechnung ändern, Desktop-Annahme und Delta-Kopie | 182,0 ms | 2,30 ms |
| Rechnung aktualisieren, Desktop-Annahme und Delta-Kopie | 85,6 ms | 2,58 ms |
| Eine geänderte Listenzeile ableiten | 54,1 ms | 5,38 ms |
| Dashboard-Statistik berechnen | 55,0 ms | 24,7 ms |
| Kalte Validierung und Migration | 321,2 ms | 264,2 ms |
| Kalte Ableitung der gesamten Liste | 54,1 ms | 64,0 ms |

Die ersten beiden Werte enthalten den echten `createDataPatches`-Code und `structuredClone`, jedoch weder Electron-IPC, React-Rendering noch die spätere Datenträgerbestätigung. Es handelt sich nicht um eine gemessene Beschleunigung des gesamten Mac-Programms. Ein gewöhnlicher Feldwechsel erzeugte zwei kleine Set-Operationen mit 168–238 Byte JSON-Repräsentation und keine vollständige Serialisierung im Eingabepfad. Große unveränderte Anhänge werden dabei nicht erneut übertragen. Der echte Worker-Patch-Applier wurde gegen den vollständigen erwarteten Zustand einschließlich Einfügen/Löschen, Zusatzfeldern und SHA256 aller Anhänge geprüft.

Die neue Zeilenableitung verwendet unveränderte Einträge erneut; die anfängliche Liste und Sortierung bleiben linear. Der Browser-Fallback zeigte keine belegte Beschleunigung. In den ursprünglichen getrennten Läufen waren reale Fallback-Updates langsamer; eine spätere gepaarte 5.000er-Kontrolle ergab 72,5 gegenüber 81,6 ms. Die alte Messung schrieb nach dem Aufwärmen denselben Text, die neue variiert ihn. Deshalb wird daraus weder ein allgemeiner Faktor noch eine Verbesserung des Fallbacks abgeleitet.

Eine zusätzliche Messung verwendet den tatsächlichen Worker, Conf und die geprüfte Dateiveröffentlichung auf Btrfs. Drei verschiedene kleine Änderungen wurden jeweils bis zur Datenträgerbestätigung gemessen, anschließend dieselbe Batch wiederholt und der Bestand nach Neustart vollständig über alle sieben Sammlungen und Anhänge geprüft. Alle vier Fälle bestanden:

| Bestand | Median bis Schreibbestätigung | Prozess-RSS-Spitze einschließlich Testaufbau |
| --- | ---: | ---: |
| 1.000 Rechnungen | 114,5 ms | 318 MiB |
| 1.000 + 16 MiB Base64 | 193,4 ms | 563 MiB |
| 10.000 Rechnungen | 1.044,3 ms | 970 MiB |
| 10.000 + 16 MiB Base64 | 1.237,6 ms | 951 MiB |

Während der eigentlichen Speicheraufträge lief ein 5-ms-Timer im Hauptprozess mit höchstens 6,55 ms Abstand weiter. Aufbau und vollständige Vergleichsprüfungen liegen außerhalb dieses Timerfensters; React, Electron-Fenster und physische Mac-Hardware wurden damit nicht gemessen. Der größte Fall lag bei Workerbereitschaft bei etwa 640 MiB und nach Schreibbestätigung bei etwa 746 MiB Prozess-RSS. Die Speicherlast bleibt erheblich. Zwei ursprüngliche große Läufe mit unnötig im Elternprozess gehaltenen Vergleichsdaten überschritten das 1-GiB-Testlimit und wurden beendet. Nach Freigabe dieser Daten und GC zwischen Aufbauphasen bestanden alle vier Fälle unter einem expliziten 1,5-GiB-Limit; die tatsächlich beobachteten Spitzen lagen unter 1 GiB. Dies belegt keine entsprechend niedrige Gesamtspeichernutzung der gesamten Desktop-App und keine unbegrenzte Skalierung.

## Dauerhaftes lokales Speichern

Dateiname, Schlüssel, Verschlüsselung, App-ID und macOS-Datenordner bleiben kompatibel. Conf serialisiert und verschlüsselt mit dem bisherigen Format ausschließlich in eine neue Staging-Datei. Vor Veröffentlichung wird diese entschlüsselt und bytegenau mit der erwarteten Serialisierung verglichen, privat berechtigt und synchronisiert. Die bisherige bestätigte Generation bleibt als `last-good` erhalten; veröffentlicht wird per Umbenennen. Wo unterstützt wird auch das Verzeichnis synchronisiert. Fehler nach dem Umbenennen gelten ausdrücklich als unbestätigter Zustand, nicht als nachgewiesen unverändertes Original.

Wiederholte Batches behalten ihre Sitzungs- und Sequenznummern. Deren höchste bestätigte Nummern stehen im selben verschlüsselten Container wie die Daten, damit ein wiederholter Array-Splice nach verlorener Antwort und Neustart nicht doppelt läuft. Ein ungültiger Auftrag mit mehreren Batches veröffentlicht auch keine vorherige Teiländerung bei einem späteren Flush. Wiederherstellung sperrt gleichzeitig ankommende Änderungen sichtbar und blockiert das Schließen bis zur Bestätigung.

Recovery-Snapshots liegen als eigene unveränderliche verschlüsselte Dateien außerhalb des häufig geschriebenen Hauptcontainers. Historische, durch Conf-Punktnotation verschachtelte Recovery-Schlüssel bleiben lesbar. Erst nach bestätigtem Archivieren wird deren Kopie aus dem Hauptcontainer entfernt. Sieben automatische Tagesgenerationen und die letzte bestätigte Generation ergänzen die dauerhaft erhaltenen Upgrade-/Importkopien. Auf der Seite „Datensicherung“ lassen sich lokale Wiederherstellungspunkte ansehen, als JSON herunterladen und ausdrücklich wiederherstellen. Eine gültige Wiederherstellung darf auch ungültige Anwendungsdaten ersetzen, nachdem das exakte Original gesichert ist. Ein vollständig unlesbarer verschlüsselter Container stoppt weiterhin den Start; dessen Originaldatei bleibt erhalten.

## Nachweise und Grenzen

Der abschließende lokale Lauf besteht `npm ci` (keine bekannten Audit-Schwachstellen), `npm run einvoice:prepare`, `EINVOICE_REQUIRE_INTEGRATION=1 npm run check` mit 124 bestandenen Tests ohne Überspringen, den Produktionsbuild und das native Linux-Testpaket samt Speicher-/Export-/Server-/CSS-Prüfung. Die ausführlichen synthetischen Messprotokolle liegen lokal unter `artifacts/offline-audit-2026-10-28` außerhalb des Quellrepositories; die Regressions- und nativen Paketprüfungen sind eingecheckt.

- Die synthetische Altdatenfixture stammt aus `ae06259`, erzeugt mit dessen tatsächlichem Store-Setup und electron-store 11.0.2 / Conf 15.0.2. Nur die Electron-OS-Umgebung wurde ersetzt. Entschlüsseln, alle sieben Sammlungen, IDs, Beträge, Anhänge, unabhängige Bearbeitung, Schließen, Wiederöffnen und Export sind geprüft. Die unveränderte Sicherung bleibt mit dem bisherigen Dateiformat lesbar.
- Fehlerprüfungen decken verkürzte und beschädigte Staging-Dateien, ENOSPC, EIO, EXDEV, Datei-/Verzeichnis-Syncfehler und einen fehlgeschlagenen Retry nach unbestätigtem Umbenennen ab. Ungültige Zahlen, unbekannte Schemas, doppelte IDs und defekte verschachtelte Sammlungen erzeugen keinen leeren Ersatzbestand.
- Der explizite native Test `node scripts/run-electron.mjs tests/native` verwendet ein unsichtbares Wegwerf-Fenster, den produktiven Preload und den echten Speicher-Worker. Er prüft asynchrone Main-Handler für synchrones Close-IPC, Schließen vor Ablauf des 250-ms-Puffers, dauerhaftes Wiederöffnen, Fehlerveto und Retry. Das ist echtes Linux-Electron, kein physischer Mac-Test.
- `node scripts/smoke-packaged.mjs` prüft den tatsächlichen Worker, Conf, historische Verschlüsselung und beide Offline-E-Rechnungsformate mit dem Electron/Java des gepackten Programms. System-Node oder System-Java ersetzen diese Laufzeiten nicht.

Vollständige Checkpoints und JSON-Exporte bleiben proportional zur gesamten Historie samt eingebetteten Anhängen. Es gibt keine zugesagte unbegrenzte Größe und keine zertifizierte Stromausfallsicherheit. Ein erzwungenes Beenden kann noch nicht bestätigte Änderungen verlieren; der Status zeigt deshalb die tatsächliche Bestätigung. Eine spätere Datenbank-/Anhangsauslagerung braucht einen eigenen verlustfreien, getesteten Migrationspfad. Regelmäßige unabhängige JSON-Sicherungen schützen zusätzlich vor einem Defekt des gesamten Datenträgers.

Die tatsächlichen Daten des Vaters wurden nicht geöffnet oder verändert. Vor produktiver Mac-Installation bleiben Signierung/Notarisierung und der Upgrade-Test mit einer Kopie seines echten Datenordners erforderlich; siehe [macOS-Upgrade](macOS-upgrade.md). Die aktuelle Arbeit wurde durch Codex umgesetzt und geprüft; Claude wurde nach dem Widerruf nicht mehr beauftragt.
