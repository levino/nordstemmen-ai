# Review Fulltext Quality

Du bist ein Agent, der die extrahierten Volltexte (`.fulltext.json`) in `documents/` auf Qualitaet prueft und bei Bedarf `.force_ocr` Flags setzt.

## Hintergrund

Einige PDFs im Ratsinformationssystem haben defekten eingebetteten Text:
- **Aspose.PDF Encoding Bug (2019-2020)**: Text sieht im PDF visuell korrekt aus, wird aber als Gibberish extrahiert (z.B. `!"#$%&'()*+,-./0123456` statt lesbarem Text)
- **Unvollstaendige OCR**: Gescannte Dokumente ohne oder mit schlechter Texterkennung
- **Encoding-Fehler**: Kaputte Umlaute, Sonderzeichen-Salat

## Dein Vorgehen

1. **Durchjuckeln**: Lies stichprobenartig `.fulltext.json` Dateien und pruefe den `full_text` Inhalt auf Lesbarkeit
2. **Gibberish erkennen**: Text der offensichtlich kein lesbares Deutsch ist — hoher Anteil an Sonderzeichen, keine erkennbaren Woerter, Zeichensalat
3. **Flag setzen**: Erstelle eine leere `.force_ocr` Datei im Verzeichnis der betroffenen PDF(s)
4. **Dokumentieren**: Gib am Ende eine Zusammenfassung welche Verzeichnisse geflaggt wurden und warum

## Technische Details

- `.fulltext.json` Dateien liegen neben den PDFs in `documents/papers/DS_*/` und `documents/meetings/*/`
- Jede `.fulltext.json` hat: `file_hash`, `filename`, `pages` (Array mit `page` und `text`), `full_text`
- Uebersprungene Dateien haben `"skipped": true`
- Bereits mit OCR verarbeitete haben `"force_ocr": true`
- Die `.force_ocr` Datei ist eine leere Datei im selben Verzeichnis (gilt fuer ALLE PDFs darin)

## Heuristiken fuer Gibberish

- Hoher Anteil nicht-alphabetischer Zeichen (>40% Sonderzeichen ausser Leerzeichen/Interpunktion)
- Keine erkennbaren deutschen Woerter (kein "der", "die", "das", "und", "ist", "Gemeinde", etc.)
- Zeichenfolgen die wie Encoding-Artefakte aussehen
- Sehr kurzer Text bei langen PDFs (Text-Extraktion hat versagt)

## Wichtig

- Nicht ALLE Dateien pruefen — stichprobenartig arbeiten, Fokus auf verdaechtige Zeitraeume (2019-2020)
- Bereits mit `"force_ocr": true` markierte Dateien koennen uebersprungen werden
- Bei Unsicherheit lieber flaggen — OCR ist langsamer aber zuverlaessiger als defekter eingebetteter Text
- Nach dem Setzen der Flags muss `python embeddings/generate_embeddings.py` erneut laufen um die Texte via OCR neu zu extrahieren
