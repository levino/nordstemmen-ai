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

Der Server stellt sechs Tools bereit: `search_documents`, `get_paper_by_reference`, `search_papers`, `get_document_text`, `list_meetings` und `get_meeting`.

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

### `list_meetings`

Listet Sitzungen (Rat, Ausschüsse, Ortsräte) aus den gebündelten Meeting-Assets.

**Parameter:**
- `date_from` / `date_to` (string, optional): Zeitraum im Format YYYY-MM-DD (inklusive)
- `name_contains` (string, optional): Teilstring im Sitzungsnamen, Groß-/Kleinschreibung egal (z.B. "Ortsrat Rössing"; "Rat (" für nur den Gemeinderat)
- `order` (string, optional): "asc" oder "desc" (Standard: "asc" wenn `date_from` gesetzt, sonst "desc")
- `limit` (number, optional): Standard 20, Max 100

**Rückgabe:** `{ total, returned, meetings: [{ id, name, start, location, agenda_items, has_invitation, has_protocol }] }`

### `get_meeting`

Eine Sitzung mit vollständiger Tagesordnung.

**Parameter:**
- `id` (string, optional): Sitzungs-ID aus `list_meetings` (z.B. "5786") oder OParl-URL der Sitzung
- `date` (string, optional): Datum YYYY-MM-DD, falls keine `id` bekannt ist
- `name_contains` (string, optional): Zusammen mit `date` zur Eingrenzung

Bei mehreren Sitzungen am selben Tag wird `{ message, candidates }` zurückgegeben.

**Rückgabe:**
- `id`, `oparl_id`, `name`, `start`, `location`
- `agenda[]`: `number`, `name`, `public`, optional `result`, `paper` (`reference`, `name`, `paper_type`, `oparl_id`, `pdf_url`, `file_hash`) und `files` (Anlagen, Beschlusstexte)
- `files[]`: `role` (`invitation`, `resultsProtocol`, `verbatimProtocol`), `name`, `pdf_url`, `file_hash`, `text_available`
- `alternative_versions` (optional): frühere Namen/Termine, wenn mehrere Ordner dieselbe OParl-ID haben

### Meeting-Assets (Build)

`build-meetings.js` läuft in `npm run build` und schreibt:
- `public/meetings/index.json` – kompakte Liste aller Sitzungen (~260 KB)
- `public/meetings/<id>.json` – Tagesordnung + Dateien je Sitzung (~4 MB gesamt)

Ordner mit derselben OParl-ID (umnummerierte Sitzungen) werden zusammengeführt: Die Variante mit den meisten Daten gewinnt, bei Gleichstand der in natürlicher Sortierung letzte Ordner. Fehlende Felder (`invitation`, `agendaItem`, …) werden toleriert. Der `file_hash` entspricht dem der Pipeline (aus `.fulltext.json`, sonst LFS-Pointer-OID, sonst SHA256 des PDFs).

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
├── functions/
│   └── mcp.js              # MCP-Implementierung (6 Tools)
├── src/
│   ├── index.html          # Landing Page
│   ├── style.css           # Tailwind CSS Styles
│   └── public/
│       └── 404.html        # Custom 404 (verhindert SPA-Fallback auf unbekannten Pfaden)
├── build-text.js           # Build: *.fulltext.json → public/text/<hash>.txt
├── build-meetings.js       # Build: meetings/*/metadata.json → public/meetings/*.json
├── mcp-server.test.js      # MCP-Protokoll-Tests (Meeting-Tools mit Fixture-ASSETS)
├── package.json            # Dependencies
├── vite.config.js          # Build-Konfiguration
├── vitest.config.js        # Test-Konfiguration
├── tailwind.config.js      # Tailwind CSS
├── postcss.config.js       # PostCSS
├── wrangler.test.jsonc     # Cloudflare Test-Konfiguration
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
- `src/public/404.html` sorgt dafür, dass Cloudflare Pages für unbekannte Pfade (z.B. `/.well-known/oauth-authorization-server`) einen echten `404` statt der `index.html` mit Status `200` zurückgibt. Ohne diese Datei interpretieren manche MCP-Clients (z.B. claude.ai) den 200er auf den OAuth-Discovery-Pfaden fälschlich als Hinweis auf einen OAuth-Server und brechen die Verbindung mit einem Registrierungsfehler ab, obwohl der Server keine Authentifizierung benötigt

## Environment Variables

In Cloudflare Pages Settings konfiguriert:
- `QDRANT_URL`: Qdrant Server URL
- `QDRANT_COLLECTION`: Collection Name (z.B. "nordstemmen")
- `QDRANT_API_KEY`: Qdrant API Key (erforderlich)
- `JINA_API_KEY`: Jina AI API Key (erforderlich)
