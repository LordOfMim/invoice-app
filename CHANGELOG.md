# Änderungsprotokoll

Alle nennenswerten Änderungen an Helferlein. Versionen folgen [Semantic Versioning](https://semver.org/lang/de/).

## Unveröffentlicht

Bestehende Daten werden beim ersten Start automatisch umgestellt. Vorher legt Helferlein eine Wiederherstellungskopie des bisherigen Stands an.

### Geändert

- **Anhänge, Logos und das Unterschriftsbild liegen als eigene Dateien** im Ordner `attachments` neben der Datendatei (Desktop-App). In den Daten steht nur noch ein Verweis mit Name, Größe und Prüfsumme. Bisher steckten die Dateien als Text in der Datendatei, die bei jeder Änderung vollständig neu geschrieben wird; mit einigen größeren Anhängen dauerte dadurch jedes Speichern spürbar länger. Gleiche Dateien, etwa dasselbe Logo auf vielen Rechnungen, werden nur einmal gespeichert.
- **Datensicherung als ZIP** (Desktop-App): Die Sicherung von Hand enthält die Daten und alle Anhänge, Logos und Bilder in einer Datei. Die automatische Sicherung legt die Anhänge einmal im Unterordner `attachments` des Sicherungsordners ab, statt sie in jede Sicherungsdatei zu kopieren; Sicherungsdatei und Unterordner gehören zusammen. Sicherungen älterer Versionen (JSON) lassen sich weiterhin einlesen. Fehlen einer Sicherung Anhänge, nennt Helferlein die Anzahl, bevor es die Daten wiederherstellt.
- Die Sicherung zum Wiederherstellen wird in der Desktop-App über den Öffnen-Dialog gewählt; Anhänge werden über „Speichern unter …“ gespeichert.

### Hinweise

- Dateien im Ordner `attachments` werden nicht automatisch gelöscht, auch wenn ein Anhang aus einer Rechnung entfernt wird: Wiederherstellungspunkte und ältere Sicherungen können noch auf sie verweisen.
- Eine einzelne Datei über 100 MB bleibt wie bisher in der Datendatei.
- Versionen bis 1.3 kennen die ausgelagerten Dateien nicht. Wer zu einer älteren Version zurückkehrt, sieht dort Rechnungen ohne Logo und Anhänge ohne Inhalt; die Dateien bleiben im Ordner erhalten und erscheinen mit der neuen Version wieder.

## 1.3.0 – 2026-11-16

Bestehende Daten werden unverändert übernommen; alle neuen Angaben sind freiwillig.

### Neu

- **E-Mail-Postfach**: eigener Menüpunkt „E-Mail“ mit Eingang, Ausgang und Gesprächen. Ein Postfach wird per IMAP/SMTP angebunden (Servervorschläge für gängige Anbieter). Rechnungen, Angebote, Zahlungserinnerungen und E-Rechnungen lassen sich mit PDF-Anhang direkt aus der App senden; beim Kunden stehen „E-Mail schreiben“ und „E-Mails anzeigen“. Das Passwort wird im Schlüsselbund des Betriebssystems verschlüsselt und ist weder in den App-Daten noch in Sicherungen enthalten. Verbindungen sind immer verschlüsselt; E-Mails werden nur als Text angezeigt, Anhänge nur auf Wunsch gespeichert. Das Postfach gibt es in der installierten Desktop-App. Konten bei Outlook.com, Hotmail und Live werden noch nicht unterstützt, weil Microsoft dort eine andere Anmeldung verlangt; Rechnungen lassen sich dafür weiterhin als Entwurf an das E-Mail-Programm übergeben.
- **Nächste Rechnungsnummer** wird vorgeschlagen (auch über den Jahreswechsel); doppelte Nummern werden gemeldet.
- **Pflichtangaben**: Der Editor listet bei Rechnungen auf, was noch fehlt (Steuernummer oder USt-IdNr., Leistungsdatum, Name und Anschrift von Empfänger und Absender, Rechnungsnummer), und führt mit einem Klick zum passenden Feld. Der Hinweis erscheint nur am Bildschirm und hindert weder am Speichern noch am PDF. Steuernummer, USt-IdNr. und Bankverbindung aus den Einstellungen erscheinen in der Fußzeile des PDF.
- **Bauleistungen nach § 13b UStG**: Rechnung ohne Umsatzsteuer mit dem vorgeschriebenen Hinweis, auch als E-Rechnung. Kunden lassen sich dafür vormerken. Wird § 13b wieder ausgeschaltet, erhalten die Positionen ihre vorherigen Steuersätze zurück.
- **Angebote** mit eigener Liste und Nummernfolge; ein Angebot wird mit einem Klick zur Rechnung.
- **Abschlags- und Schlussrechnungen**: Die Schlussrechnung zieht gestellte Abschläge mit ihrer Umsatzsteuer ab und weist den Restbetrag aus. Wird eine abgezogene Abschlagsrechnung später storniert, gutgeschrieben, geändert oder gelöscht, weist die Schlussrechnung darauf hin und bietet „Abzug aktualisieren“ oder „Abzug entfernen“ an; die Auswertung nennt solche Schlussrechnungen unter „Braucht Aufmerksamkeit“. Beträge werden dabei nie ohne Ihr Zutun geändert.
- **Bauvorhaben** als eigenes Feld auf Rechnung, Angebot und E-Rechnung.
- **Zahlungserinnerungen und Mahnungen** zu überfälligen Rechnungen (nach Ablauf des Zahlungsziels, solange ein Betrag offen ist), mit Verlauf an der Rechnung.
- **Fachunternehmererklärung direkt aus einer Rechnung**, mit Kunde und Bauvorhaben vorausgefüllt. Gibt es zur Rechnung schon eine Erklärung, wird sie geöffnet; eine weitere entsteht nur auf ausdrücklichen Wunsch.
- **Export für die Steuer**: Belege eines Monats, Quartals, Jahres oder frei gewählten Zeitraums als CSV-Liste (öffnet in Excel) und, in der Desktop-App, als ZIP mit der Liste und den PDFs der Rechnungen. Stornos und Gutschriften stehen in der Liste; eigene PDFs gibt es für sie nicht. Die PDFs werden beim Export neu aus den gespeicherten Daten erstellt.
- **Automatische wöchentliche Datensicherung** in einen gewählten Ordner (Desktop-App, beim Öffnen der App).
- **Wiederkehrende Rechnungen** können fällige Rechnungen beim Öffnen der App automatisch als Entwurf anlegen (Schalter je wiederkehrender Rechnung); die Rechnungsnummer vergeben Sie selbst. Die Liste zeigt, welche Rechnungen automatisch entstehen. Nach einer längeren Pause wird nur die jüngste fällige Rechnung angelegt; frühere Termine werden übersprungen, und ein Hinweis nennt, wie viele. Ist der Kunde für § 13b vorgemerkt, entsteht der Entwurf ohne Umsatzsteuer.
- **Schriftgröße** der Oberfläche in drei Stufen.
- Positionen lassen sich schneller erfassen: Die Eingabetaste im Feld „MwSt. %“ der letzten Position oder ⌘/Strg + Eingabetaste in jedem Feld legt die nächste Position an; beim Tippen der Beschreibung werden passende Produkte und Leistungen vorgeschlagen, und die Positionen des letzten Belegs desselben Kunden lassen sich übernehmen.

### Geändert

- **Neue Oberfläche** nach dem Palermo Design System: ruhigere Flächen in Weiß und hellem Grau, fast schwarze Hauptaktion, Karten mit feinem Schatten statt Rahmen, Reiter mit Unterstrich, Statusangaben als Pillen. Für gute Lesbarkeit weicht Helferlein bewusst ab: dunklerer Nebentext, größere Felder und Schaltflächen, deutlich sichtbarer Tastaturfokus. Die Schriftgröße der App bleibt einstellbar; gedruckte Dokumente und PDFs sehen aus wie bisher.
- Der Fußtext einer Rechnung (bei neuen Rechnungen der Standard-Fußtext aus den Einstellungen) wird mittig gedruckt, solange keine eigene Fußzeile links oder rechts eingetragen ist.
- Datumsangaben und Beträge auf PDFs stehen immer im deutschen Format (31.12.2026, 1.234,56 €), auch wenn die Oberfläche auf Englisch gestellt ist.
- Ein gespeichertes PDF wird immer neu aus den gespeicherten Daten im aktuellen Layout erstellt. Das PDF einer älteren Rechnung kann deshalb etwas anders aussehen als das damals verschickte Exemplar.
- Datensicherung und CSV-Liste werden in der Desktop-App über den Speichern-Dialog abgelegt. „Gespeichert“ erscheint erst, wenn die Datei geschrieben ist; nach „Abbrechen“ gilt die Sicherung nicht als erledigt.
- Im Feld Rechnungsnummer steht nicht mehr der Nummernvorschlag als blasser Text; er wird nur noch über „Nächste Nummer übernehmen“ angeboten.
- Next.js auf 16.4.6 aktualisiert (Sicherheitsupdate).
- Eine kopierte Rechnung übernimmt weder Leistungsdatum, Zahlungserinnerungen noch die Verknüpfung zu einer wiederkehrenden Rechnung.
- Auswertung und Steuer-Export zählen bei Schlussrechnungen nur den Restbetrag, damit Abschläge nicht doppelt erscheinen.

### Behoben

- Wiederkehrende Rechnungen konnten hängen bleiben, wenn für den Lauf bereits eine Rechnung vorhanden war; ungültige Datumsangaben erzeugen keine Rechnungen mehr.
- Sehr lange Dateinamen mit Umlauten im ZIP-Export wurden mitten im Zeichen abgeschnitten.
- § 13b: Nach der Wahl eines falschen Kunden blieb die Rechnung ohne Umsatzsteuer, auch wenn danach ein Kunde ohne § 13b gewählt wurde. Jetzt weist ein Hinweis darauf hin und stellt die Umsatzsteuer mit einem Klick wieder her. Beim Ausschalten von § 13b wurden zudem alle Positionen auf den Standardsteuersatz gesetzt (aus 7 % wurden 19 %).
- Zahlungserinnerungen ließen sich für noch nicht fällige Rechnungen schreiben; im Schreiben stand „Fällig seit“ mit einem künftigen oder ohne Datum. Das Schreiben nennt jetzt „Fällig am“ und lässt die Zeile ohne Zahlungsziel weg.
- „Fachunternehmererklärung erstellen“ legte bei jedem Klick eine weitere Erklärung an.
- „Positionen der letzten Rechnung übernehmen“ nannte auch ein Angebot „Rechnung“ und schrieb „1 Positionen“.
- Nach dem Storno einer Schlussrechnung wurden ihre Abschlagsrechnungen in der neuen Schlussrechnung nicht mehr zum Abzug angeboten; die neue Rechnung hätte den vollen Betrag verlangt. Ist eine Abschlagsrechnung bereits in einer anderen Schlussrechnung abgezogen, steht das jetzt dabei.
- Der Nummernvorschlag hielt einen Zähler, der zufällig dem Vorjahr entsprach, für die Jahreszahl (nach „K12-25“ im Jahr 2026 kam „K01-26“ statt „K12-26“).
- § 13b: Beim Ein- und Ausschalten ging die Steuerkategorie der E-Rechnung verloren (etwa bei Kleinunternehmern nach § 19), und die E-Rechnung ließ sich nicht mehr erstellen. Bei einer kopierten Rechnung oder einer Rechnung aus einem Angebot wurden nach dem Ausschalten alle Positionen auf den Standardsteuersatz gesetzt.
- Datensicherung und CSV-Liste meldeten Erfolg, bevor die Datei gespeichert war, auch wenn der Speichern-Dialog abgebrochen wurde.

## 1.2.0 – 2026-11-14

Erste Veröffentlichung der modernisierten App. Bestehende Daten werden unverändert übernommen; beim ersten Start sichert Helferlein die bisherige Datendatei zusätzlich.

### Neu

- Neue Oberfläche mit Seitenleiste, klaren Tabellen und Rechnungseditor mit Live-Vorschau.
- E-Rechnung: ZUGFeRD-PDF/A-3b und XRechnung (CII), offline erzeugt und vor dem Speichern lokal geprüft; Speichern oder als E-Mail-Entwurf vorbereiten.
- Normale PDFs lassen sich direkt speichern.
- Speicherung im Hintergrund mit Wiederherstellungskopien, Sicherung vor Importen und vor jedem Versionswechsel.
- Linux-Pakete (AppImage, deb) zusätzlich zu macOS (Intel, Apple Silicon) und Windows.

### Geändert

- Fachunternehmererklärung: Der Satz „Siehe Anhang Datenblätter“ entfällt. Titel und Anrede sind korrigiert („Übereinstimmungs- / Fachunternehmererklärung“, Komma nach der Anrede).
- Windows: Installer und portable Version haben getrennte Dateinamen; zuvor überschrieb die portable Datei den Installer.

### Behoben

- Ein unvollständiger Währungscode in den Einstellungen (z. B. „EU“) ließ Auswertung, Rechnungsliste und Editor abstürzen.
- Überfällige Tage wurden über die Zeitumstellung im Frühjahr um einen Tag zu niedrig berechnet.
- Wiederkehrende Rechnungen ohne nächstes Datum blieben nach dem Erstellen dauerhaft fällig.
- Auswertung: Leere Entwürfe zählten als „Bezahlt“; Kunden ohne Namen erschienen als „Unnamed customer“; „1 Tage überfällig“.
- Zahlungen: „Als bezahlt markiert“ erschien als „manual_paid · Marked paid“. „Als unbezahlt markieren“ wird nur noch angeboten, wenn es etwas bewirkt.
- Beim Wechsel der Grundvorlage blieben Farben und Schriften der zuvor gewählten Variante aktiv.
- Dieselbe Logo- oder Unterschriftsdatei ließ sich nach dem Entfernen nicht erneut auswählen.
- Fachunternehmererklärung: Drucken im Bearbeitungsmodus druckte die Eingabefelder mit.
- E-Mail-Entwürfe (`.eml`) öffnen sich in Outlook als bearbeitbarer Entwurf.
- Die Sicherung vor dem Upgrade funktioniert auch auf Datenträgern ohne Hardlinks (exFAT, Netzlaufwerke).
- Ein unerwartet beendeter interner Server wird beim erneuten Öffnen des Fensters neu gestartet.
- Das Fenster öffnet sich nicht mehr außerhalb des sichtbaren Bereichs, wenn ein Monitor entfernt wurde.
- Die installierte App wechselt nicht mehr in den Entwicklungsmodus, wenn `NODE_ENV=development` gesetzt ist.

## 1.1.0 – 2026-02-24

- Windows- und macOS-Pakete der ursprünglichen App.
