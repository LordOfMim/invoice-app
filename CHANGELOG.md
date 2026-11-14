# Änderungsprotokoll

Alle nennenswerten Änderungen an Helferlein. Versionen folgen [Semantic Versioning](https://semver.org/lang/de/).

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
