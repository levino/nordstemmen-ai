# Nordstemmen Chat App

Eine Streamlit-basierte Chat-Anwendung zum Abfragen der Nordstemmen-Dokumente über Qdrant und Anthropic Claude.

## Features

- 💬 Chat-Interface mit Verlauf
- 🔍 Semantische Suche in Qdrant
- 🤖 RAG (Retrieval-Augmented Generation) mit Claude
- 📚 Quellenangaben für jede Antwort
- ⚙️ Konfigurierbare Suchparameter

## Installation

```bash
# Virtual Environment erstellen
python3 -m venv venv
source venv/bin/activate

# Dependencies installieren
pip install -r requirements.txt
```

## Verwendung

```bash
# App starten
streamlit run app.py
```

Die App öffnet sich automatisch im Browser unter http://localhost:8501

## Konfiguration

In der Sidebar kannst du folgende Parameter einstellen:

### Qdrant
- **URL**: Die URL deines Qdrant-Servers (Standard: https://qdrant.levinkeller.de:443)
- **API Key**: Dein Qdrant API Key
- **Collection**: Name der Collection (Standard: nordstemmen)

### Anthropic
- **API Key**: Dein Anthropic API Key (https://console.anthropic.com/)

### Suche
- **Anzahl Suchergebnisse**: Wie viele Dokumente sollen für die Antwort verwendet werden (1-10)

## Features im Detail

### Semantische Suche
Die App verwendet das gleiche Embedding-Modell (`paraphrase-multilingual-MiniLM-L12-v2`) wie die Embedding-Generierung, um konsistente Suchergebnisse zu garantieren.

### RAG mit Claude
Die gefundenen Dokumente werden als Kontext an Claude Sonnet 3.5 gesendet, der darauf basierend eine präzise Antwort formuliert.

### Quellenangaben
Zu jeder Antwort werden die verwendeten Quellen angezeigt:
- Dateiname
- Seitenzahl
- Relevanz-Score
- Textausschnitt

## Technologie-Stack

- **Frontend**: Streamlit
- **Vector Database**: Qdrant
- **LLM**: Claude 3.5 Sonnet (Anthropic)
- **Embeddings**: sentence-transformers
- **Model**: paraphrase-multilingual-MiniLM-L12-v2 (384 Dimensionen)
