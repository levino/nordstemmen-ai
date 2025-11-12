# Nordstemmen MCP Server

MCP (Model Context Protocol) Server für semantische Suche in Nordstemmen-Dokumenten via Qdrant.

Deployed auf Cloudflare Pages unter: `nordstemmen-mcp.levinkeller.de`

## Features

- 🔍 Semantische Suche in Gemeinderatsdokumenten
- ⚡ Cloudflare Pages (global edge network)
- 🤖 HuggingFace Inference API für Embeddings
- 📡 MCP-Standard kompatibel (JSON-RPC 2.0)

## Deployment via Cloudflare Pages

### 1. GitHub Repository erstellen

```bash
cd /workspaces/nordstemmen-ai/mcp-server
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/DEIN_USERNAME/nordstemmen-mcp-server.git
git push -u origin main
```

### 2. Cloudflare Pages Projekt erstellen

1. Cloudflare Dashboard → Pages → Create a project
2. Connect to Git → Dein GitHub Repo auswählen
3. Build Settings:
   - **Framework preset**: None
   - **Build command**: (leer lassen)
   - **Build output directory**: (leer lassen)
4. Environment Variables setzen:
   - `QDRANT_URL`: `https://qdrant.levinkeller.de:443`
   - `QDRANT_COLLECTION`: `nordstemmen`
   - `QDRANT_API_KEY`: Dein Qdrant API Key
   - `HUGGINGFACE_API_KEY`: (Optional) Dein HuggingFace API Key
5. Save and Deploy

### 3. Custom Domain hinzufügen

1. Pages Projekt → Custom domains
2. Add custom domain: `nordstemmen-mcp.levinkeller.de`
3. DNS Records werden automatisch erstellt

## Lokale Entwicklung

```bash
npm install
npm run dev
```

Server läuft auf `http://localhost:8788`

### Environment Variables für lokale Entwicklung

Erstelle `.dev.vars`:

```
QDRANT_URL=https://qdrant.levinkeller.de:443
QDRANT_COLLECTION=nordstemmen
QDRANT_API_KEY=dein_api_key
HUGGINGFACE_API_KEY=dein_hf_key  # Optional
```

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

## MCP Tool

Der Server stellt ein Tool bereit:

### `search_documents`

Durchsucht die Nordstemmen-Dokumentendatenbank.

**Parameter:**
- `query` (string, required): Suchbegriff oder Suchanfrage
- `limit` (number, optional): Anzahl der Ergebnisse (Standard: 5, Max: 10)

**Rückgabe:**
Formatierte Suchergebnisse mit:
- Dateiname und Seitenzahl
- Relevanz-Score
- Textausschnitt
- URL zum Originaldokument

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
├── _worker.ts           # Cloudflare Pages Worker (Advanced Mode)
├── package.json         # Dependencies
├── tsconfig.json        # TypeScript Config
├── .gitignore
├── .dev.vars           # Lokale Environment Variables (nicht committen!)
└── README.md
```

## Technologie

- **Runtime**: Cloudflare Pages (Workers)
- **Vector DB**: Qdrant
- **Embeddings**: HuggingFace Inference API (`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`, 384 Dimensionen)
- **Protocol**: MCP (Model Context Protocol)
- **Transport**: JSON-RPC 2.0 over HTTP

## Hinweise

- Der Server nutzt HuggingFace Inference API für Embeddings (kostenlos, rate-limited)
- Optional: HuggingFace API Key für bessere Rate Limits
- Qdrant Collection nutzt 384-dimensionale Vektoren von `paraphrase-multilingual-MiniLM-L12-v2`
- Das gleiche Modell wie in der Streamlit-App für konsistente Ergebnisse

## Environment Variables

In Cloudflare Pages Settings konfiguriert:
- `QDRANT_URL`: Qdrant Server URL
- `QDRANT_COLLECTION`: Collection Name
- `QDRANT_API_KEY`: Qdrant API Key (erforderlich)
- `HUGGINGFACE_API_KEY`: HuggingFace API Key (optional)
