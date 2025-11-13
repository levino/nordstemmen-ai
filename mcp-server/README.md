# Nordstemmen MCP Server

MCP (Model Context Protocol) Server für semantische Suche in Nordstemmen-Dokumenten via Qdrant.

Deployed auf Cloudflare Pages unter: `nordstemmen-mcp.levinkeller.de`

## Features

- 🔍 Semantische Suche in Gemeinderatsdokumenten
- ⚡ Cloudflare Pages (global edge network)
- 🤖 HuggingFace Inference API für Embeddings
- 📡 MCP-Standard kompatibel (JSON-RPC 2.0)

## Deployment via Cloudflare Pages

### 1. Cloudflare Pages Projekt erstellen

1. Cloudflare Dashboard → Pages → Create a project
2. Connect to Git → GitHub Repo auswählen
3. Build Settings:
   - **Framework preset**: None
   - **Build command**: (leer lassen)
   - **Build output directory**: (leer lassen)
   - **Root directory**: `mcp-server`
4. Environment Variables setzen:
   - `QDRANT_URL`: `https://qdrant.levinkeller.de:443`
   - `QDRANT_COLLECTION`: `nordstemmen`
   - `QDRANT_API_KEY`: Dein Qdrant API Key
   - `HUGGINGFACE_API_KEY`: (Optional) Dein HuggingFace API Key
5. Save and Deploy

### 2. Custom Domain hinzufügen

1. Pages Projekt → Custom domains
2. Add custom domain: `nordstemmen-mcp.levinkeller.de`
3. DNS Records werden automatisch erstellt

## API Endpoints

### GET /

Health check / Info endpoint

```bash
curl https://nordstemmen-mcp.levinkeller.de/
```

### POST /mcp

MCP JSON-RPC Endpoint

**Initialize:**
```bash
curl -X POST https://nordstemmen-mcp.levinkeller.de/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {}
  }'
```

**List Tools:**
```bash
curl -X POST https://nordstemmen-mcp.levinkeller.de/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }'
```

**Search Documents:**
```bash
curl -X POST https://nordstemmen-mcp.levinkeller.de/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "search_documents",
      "arguments": {
        "query": "Bürgermeisterwahl",
        "limit": 5
      }
    }
  }'
```

**Get Paper by Reference:**
```bash
curl -X POST https://nordstemmen-mcp.levinkeller.de/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "get_paper_by_reference",
      "arguments": {
        "reference": "101/2012"
      }
    }
  }'
```

**Search Papers:**
```bash
curl -X POST https://nordstemmen-mcp.levinkeller.de/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 5,
    "method": "tools/call",
    "params": {
      "name": "search_papers",
      "arguments": {
        "name_contains": "Bebauungsplan",
        "date_from": "2024-01-01",
        "limit": 10
      }
    }
  }'
```

## MCP Tools

Der Server stellt drei Tools bereit:

### `search_documents`

Semantische Suche durch die Dokumentinhalte via Qdrant Vector DB.

**Parameter:**
- `query` (string, required): Suchbegriff oder Suchanfrage
- `limit` (number, optional): Anzahl der Ergebnisse (Standard: 5, Max: 10)

**Rückgabe:**
Formatierte Suchergebnisse mit:
- Dateiname und Seitenzahl
- Relevanz-Score
- Textausschnitt
- URL zum Originaldokument

### `get_paper_by_reference`

Direkter Lookup einer Drucksache anhand der Drucksachennummer.

**Parameter:**
- `reference` (string, required): Drucksachennummer (z.B. "DS 101/2012", "101/2012", oder "101-2012")

**Rückgabe:**
Vollständige Paper-Metadaten inklusive:
- OParl ID und URLs zu allen Dokumenten
- Name und Typ der Drucksache
- Datum
- mainFile und auxiliaryFiles mit direkten Links
- Verknüpfte Beratungen (consultations)
- Verwandte Drucksachen (relatedPapers)

**Beispiel:**
```json
{
  "reference": "DS 101/2012",
  "name": "Bekanntgabe des Berichts über...",
  "paperType": "Mitteilungsvorlage",
  "date": "2012-12-13",
  "oparl_id": "https://nordstemmen.ratsinfomanagement.net/webservice/oparl/v1.1/body/1/paper/787",
  "mainFile": {
    "oparl_id": "...",
    "name": "...",
    "accessUrl": "...",
    "downloadUrl": "..."
  }
}
```

### `search_papers`

Strukturierte Suche durch Paper-Metadaten mit Filtern.

**Parameter:**
- `reference_pattern` (string, optional): Pattern für Drucksachennummer (z.B. "*/2024" für alle aus 2024)
- `name_contains` (string, optional): Text der im Namen vorkommen muss
- `paper_type` (string, optional): Filterung nach Dokumenttyp (z.B. "Beschlussvorlage", "Mitteilungsvorlage", "Antrag")
- `date_from` (string, optional): Startdatum im Format YYYY-MM-DD
- `date_to` (string, optional): Enddatum im Format YYYY-MM-DD
- `limit` (number, optional): Maximale Anzahl Ergebnisse (Standard: 10, Max: 50)

**Rückgabe:**
Liste von Papers mit:
- reference, name, paperType, date
- OParl ID und Links zu Dokumenten
- Anzahl der mainFile und auxiliaryFiles

**Beispiele:**
- Alle Bebauungspläne aus 2024: `name_contains: "Bebauungsplan", date_from: "2024-01-01"`
- Alle Drucksachen aus 2023: `reference_pattern: "*/2023"`
- Beschlussvorlagen mit "Haushalt": `paper_type: "Beschlussvorlage", name_contains: "Haushalt"`

## Verwendung mit Claude

### Claude Desktop

In `~/.config/claude-desktop/config.json`:

```json
{
  "mcpServers": {
    "nordstemmen": {
      "url": "https://nordstemmen-mcp.levinkeller.de/mcp"
    }
  }
}
```

### Andere MCP Clients

Der Server implementiert den MCP Standard (2024-11-05) und kann mit jedem kompatiblen Client verwendet werden.

## Projektstruktur

```
mcp-server/
├── _worker.js           # Cloudflare Pages Worker (Advanced Mode)
├── package.json         # Dependencies
├── .gitignore
├── .dev.vars.example    # Template für lokale Environment Variables
└── README.md
```

## Technologie

- **Runtime**: Cloudflare Pages (Workers)
- **Vector DB**: Qdrant
- **Embeddings**: Jina AI Embeddings API (`jina-embeddings-v3`, 1024 Dimensionen)
- **Protocol**: MCP (Model Context Protocol)
- **Transport**: JSON-RPC 2.0 over HTTP
- **Metadata**: Direkt aus OParl metadata.json files

## Hinweise

- Der Server nutzt Jina AI Embeddings API für semantische Suche
- Paper-Metadaten werden direkt aus `documents/papers/*/metadata.json` gelesen
- Meeting-Metadaten werden direkt aus `documents/meetings/*/metadata.json` gelesen
- Alle Ergebnisse enthalten direkte OParl-Links zu Originaldokumenten

## Environment Variables

In Cloudflare Pages Settings konfiguriert:
- `QDRANT_URL`: Qdrant Server URL
- `QDRANT_COLLECTION`: Collection Name (z.B. "nordstemmen")
- `QDRANT_API_KEY`: Qdrant API Key (erforderlich)
- `JINA_API_KEY`: Jina AI API Key (erforderlich)
