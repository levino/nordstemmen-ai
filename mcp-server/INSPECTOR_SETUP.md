# MCP Inspector Setup mit Coolify

## Architektur

```
Browser
  ↓
Cloudflare Pages (nordstemmen-mcp.levinkeller.de)
  ├─ GET /          → public/index.html (static homepage)
  └─ POST /mcp      → functions/mcp.js (MCP API)

Browser (via Link von Homepage)
  ↓
Coolify Container (mcp-inspector.levinkeller.de)
  ├─ Port 6274      → MCPI Client UI
  └─ Port 6277      → MCPP Proxy Server
```

Der Inspector läuft **separat** auf einer eigenen Domain, da er:
- Zwei Ports benötigt (6274 + 6277)
- Wahrscheinlich WebSockets zwischen UI und Proxy nutzt
- Zu komplex für einfaches HTTP-Proxying ist

## Coolify Container Setup

### 1. Neuen Service erstellen

**Image:**
```
ghcr.io/modelcontextprotocol/inspector:latest
```

**Ports:**
```
6274:6274
6277:6277
```

**Domain:**
```
mcp-inspector.levinkeller.de
```

**Wichtig:** Beide Ports müssen gemappt werden!
- `6274` für die Web-UI (MCPI Client)
- `6277` für den Proxy-Server (MCPP)

### 2. DNS Konfiguration

In Cloudflare DNS:
```
Type: A
Name: mcp-inspector
Content: [DEINE_SERVER_IP]
Proxy: Proxied (orange Cloud) - für SSL via Cloudflare
```

**WICHTIG:** Coolify muss beide Ports auf die Domain routen:
- Entweder über Coolify's Proxy-Konfiguration
- Oder mit einem Nginx Reverse Proxy davor

### 3. Keine Environment Variables nötig!

Da der Inspector separat läuft, brauchst du **keine** Cloudflare Pages Environment Variables.

## Wie es funktioniert

1. User besucht Homepage: `https://nordstemmen-mcp.levinkeller.de/`
2. Klickt auf "MCP Inspector öffnen"
3. Neuer Tab öffnet sich: `https://mcp-inspector.levinkeller.de`
4. User verbindet Inspector manuell mit: `https://nordstemmen-mcp.levinkeller.de/mcp`
5. Inspector kommuniziert über POST mit dem MCP Server

**Cleanere Separation!** Jeder Service auf seiner eigenen Domain.

## Testen

1. Container läuft auf `mcp-inspector.levinkeller.de`
2. Teste UI direkt: `curl https://mcp-inspector.levinkeller.de` (sollte HTML zurückgeben)
3. Öffne im Browser: `https://mcp-inspector.levinkeller.de`
4. Verbinde mit MCP Server: `https://nordstemmen-mcp.levinkeller.de/mcp`

## Troubleshooting

### Inspector lädt nicht

- Check: Container läuft? `docker ps` in Coolify
- Check: Port 6274 exposed?
- Check: Domain erreichbar? `curl https://mcp-inspector.levinkeller.de`
- Check: Coolify Proxy korrekt konfiguriert?

### Ports-Problem

Der Inspector braucht **beide Ports**:
- 6274: Web-UI
- 6277: Proxy-Server

In Coolify musst du beide Ports auf Port 80/443 der Domain routen (via Proxy).
Das kann komplex sein! Eventuell ist es einfacher, den Container auf einem Sub-Path zu routen.

### CORS Errors beim Verbinden zum MCP Server

- Check: `functions/mcp.js` hat CORS Headers (sollte bereits konfiguriert sein)
- Check: POST zu `/mcp` funktioniert direkt: `curl -X POST https://nordstemmen-mcp.levinkeller.de/mcp`

### Alternative: Ohne Domain

Falls die Domain-Konfiguration zu kompliziert ist:

```bash
# Einfach per IP und Port
http://DEINE_IP:6274
```

Dann wird die Verbindung aber ohne SSL sein.
