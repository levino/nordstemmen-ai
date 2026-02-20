export const GEMINI_MODEL = 'gemini-2.5-flash';

export const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export const JINA_API_URL = 'https://api.jina.ai/v1/embeddings';

export const JINA_MODEL = 'jina-embeddings-v3';

export const JINA_BATCH_SIZE = 64;

/** DNS namespace UUID for uuid v5 — matches Python uuid.NAMESPACE_DNS */
export const UUID_NAMESPACE_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/** Max PDF size for Gemini inline upload (bytes). Larger files use Files API. */
export const GEMINI_INLINE_LIMIT = 15 * 1024 * 1024;

export const OCR_PROMPT = `Transkribiere den Text aus diesem PDF-Dokument WÖRTLICH. Gib den exakten Wortlaut wieder — ändere, ergänze oder paraphrasiere NICHTS.

Trenne die Ausgabe SEITENWEISE. Beginne jede Seite mit dem Marker "--- Page N ---" (wobei N die Seitenzahl ist, startend bei 1).

Regeln:
- Lies die GESAMTE Seite ab: Kopfzeilen, Fußzeilen, Seitenvermerke, Aktenzeichen, Datumsangaben in Ecken
- Handschriftliche Unterschriften als [Unterschrift] markieren
- Unleserliche Stellen als [unleserlich] markieren
- Tabellen als Markdown-Tabellen wiedergeben
- Falls das Dokument ein Brief ist: Strukturiere mit Markdown (## Absender, ## Empfänger, ## Betreff, dann Brieftext). Behalte dabei den exakten Wortlaut bei.
- Falls eine Seite eine Karte, einen Plan, eine Skizze oder eine technische Zeichnung zeigt: Gib KEINE Kartenbeschriftungen wieder. Stattdessen: (1) Beschreibe in eckigen Klammern kurz, was die Karte zeigt. (2) Gib nur den Kartentitel, Untertitel, Planvermerk, Maßstab und Planungsbüro wieder.
- Falls es ein sonstiges Textdokument ist: Gib den Text in der natürlichen Lesereihenfolge wieder, nutze Markdown-Überschriften wo sinnvoll.
- Gib NUR den transkribierten Text aus — keine Einleitung, keine Erklärung, keine Code-Blöcke`;
