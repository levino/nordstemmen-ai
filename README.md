# Nordstemmen Transparent - Daten-Pipeline

RAG-basierte Suchmaschine für öffentliche Dokumente der Gemeinde Nordstemmen.

## Überblick

Dieses Repository enthält die Daten-Pipeline für das Nordstemmen Transparent Projekt:

1. **OParl-Scraper**: Lädt PDF-Dokumente vom Ratsinformationssystem herunter
2. **Embedding-Generator**: Verarbeitet PDFs und lädt Vektoren zu Qdrant hoch

Die Pipeline läuft lokal (Mac Studio) und pusht Embeddings zu einer externen Qdrant-Instanz.

## Repository-Struktur

```
nordstemmen-transparent/
├── documents/              # Heruntergeladene PDFs und Metadaten
│   ├── *.pdf              # PDF-Dokumente
│   ├── metadata.json      # OParl-Metadaten
│   └── .gitkeep
├── scraper/               # OParl-Scraper
│   ├── oparl_scraper.py
│   └── requirements.txt
├── embeddings/            # Embedding-Generator
│   ├── generate.py
│   └── requirements.txt
├── .env.example          # Template für Umgebungsvariablen
├── .gitignore
└── README.md
```

## Setup

### Voraussetzungen

- Python 3.11 oder höher
- Externe Qdrant-Instanz (selbst deployed)
- Optional: Tesseract OCR für gescannte PDFs

### Installation

1. Repository klonen:

```bash
git clone <repo-url>
cd nordstemmen-transparent
```

2. Umgebungsvariablen konfigurieren:

```bash
cp .env.example .env
# Bearbeite .env und füge deine Qdrant-URL und API-Key ein
```

3. Dependencies installieren:

```bash
# Scraper
cd scraper
python -m venv venv
source venv/bin/activate  # Auf Windows: venv\Scripts\activate
pip install -r requirements.txt

# Embedding-Generator
cd ../embeddings
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

#### Optional: OCR-Support

Für gescannte PDFs (wenn kein Text extrahierbar ist):

```bash
# macOS
brew install tesseract tesseract-lang

# In embeddings/requirements.txt die OCR-Zeilen uncomment und installieren:
pip install pytesseract pillow pdf2image
```

### Qdrant Setup

1. Deploye eine Qdrant-Instanz (z.B. auf VPS via Docker)
2. Notiere URL und API-Key
3. Trage Credentials in `.env` ein

Die Collection `nordstemmen` wird automatisch beim ersten Lauf erstellt.

## Usage

### Schritt 1: OParl-Scraper

PDFs vom Ratsinformationssystem herunterladen:

```bash
cd scraper
source venv/bin/activate
python oparl_scraper.py
```

**Was passiert:**
- Traversiert OParl-API rekursiv
- Lädt neue/geänderte PDFs in `documents/` herunter
- Speichert Metadaten in `documents/metadata.json`
- Erkennt bereits heruntergeladene Dokumente (via OParl-ID)

**Output:**
```
documents/
├── 2024-11-12_Gemeinderat_Protokoll.pdf
├── 2024-10-15_Bauausschuss_Beschluss.pdf
└── metadata.json
```

### Schritt 2: Embedding-Generator

PDFs verarbeiten und zu Qdrant hochladen:

```bash
cd embeddings
source venv/bin/activate
python generate.py
```

**Was passiert:**
- Liest alle PDFs aus `documents/`
- Berechnet MD5-Hash pro Datei
- Fragt Qdrant: "Schon verarbeitet?"
- Bei neuen/geänderten Dateien:
  - Text extrahieren (mit OCR-Fallback)
  - Text in Chunks aufteilen (500 Zeichen, 50 Overlap)
  - Embeddings generieren (multilingual-MiniLM)
  - Alte Chunks löschen, neue hochladen

**Embedding-Modell:**
- `paraphrase-multilingual-MiniLM-L12-v2`
- 384 Dimensionen
- Deutsch-taugliches Sentence-Transformer-Modell

### Change Detection

Der Embedding-Generator nutzt Hash-basierte Change Detection:

1. MD5-Hash der PDF wird berechnet
2. Qdrant wird gefragt: "Existiert `filename` mit diesem Hash?"
3. Bei Match: Skip (bereits verarbeitet)
4. Bei Miss oder Änderung: Neu verarbeiten

**Vorteil:** Qdrant ist Single Source of Truth, keine lokale State-Datei nötig.

## Qdrant Payload Schema

Jeder Chunk wird mit folgendem Schema gespeichert:

```json
{
  "vector": [0.123, -0.456, ...],  // 384 Dimensionen
  "payload": {
    "filename": "2024-11-12_Gemeinderat_Protokoll.pdf",
    "file_hash": "abc123def456...",
    "page": 3,
    "chunk_index": 5,
    "text": "Der Gemeinderat beschließt...",
    "source": "oparl",
    "oparl_id": "https://nordstemmen.../paper/123",
    "date": "2024-11-12",
    "gremium": "Gemeinderat",
    "paper_name": "Haushaltsbeschluss 2024",
    "paper_reference": "2024/001",
    "meeting_name": "12. Sitzung des Gemeinderats"
  }
}
```

**Metadaten:** Werden aus `documents/metadata.json` (vom Scraper erzeugt) gelesen.

## Entwicklung

### Logging

Beide Scripts nutzen Python Logging:

```python
# Scraper
logger.info("Downloaded: filename.pdf")
logger.debug("Processing paper: title")

# Embeddings
logger.info("Processing filename.pdf")
logger.info("Uploading 42 chunks for filename.pdf")
```

Level per Default: `INFO`

### Testing Lokal

1. Scraper laufen lassen (lädt PDFs)
2. Embedding-Generator laufen lassen (verarbeitet PDFs)
3. In Qdrant Dashboard überprüfen: Collection `nordstemmen` sollte Punkte enthalten

### Re-Processing

**Erzwungenes Neu-Verarbeiten einer Datei:**

1. Option A: PDF löschen und neu scrapen (Hash ändert sich)
2. Option B: In Qdrant alle Chunks dieser Datei manuell löschen

## Roadmap

Diese Pipeline ist **Phase 1** (Daten-Ingestion). Als nächstes kommen:

- [ ] Streamlit/Next.js App (Query-Handling)
- [ ] Pocketbase (User-Auth)
- [ ] Docker-Setup für VPS-Deployment
- [ ] GitHub Actions (automatisches Scraping + Embedding-Generation)

## Lizenz

MIT (oder andere, nach Wahl)

---

**Hinweis:** Dies ist ein unabhängiges Transparenz-Tool, keine offizielle Gemeinde-Anwendung.
