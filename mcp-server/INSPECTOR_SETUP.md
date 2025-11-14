# MCP Inspector Setup mit Coolify

## Architektur

```
Browser
  ↓
Cloudflare Pages
  ├─ GET /          → public/index.html (static)
  ├─ GET /mcp       → functions/_middleware.js → Coolify Container
  └─ POST /mcp      → functions/mcp.js (API)
```

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
inspector.nordstemmen-mcp.levinkeller.de
```

**Oder einfach die Server-IP nutzen, wenn du nicht public exponieren willst**

### 2. DNS Konfiguration (wenn Subdomain)

In Cloudflare DNS:
```
Type: A
Name: inspector
Content: [DEINE_SERVER_IP]
Proxy: Off (graue Cloud) - direkter Zugriff für Middleware
```

**WICHTIG:** Der Inspector muss vom Internet erreichbar sein, damit die Cloudflare Worker Middleware darauf zugreifen kann.

### 3. Cloudflare Pages Environment Variable

In Cloudflare Pages Dashboard:
```
Settings → Environment Variables → Production

Variable: INSPECTOR_URL
Value: https://inspector.nordstemmen-mcp.levinkeller.de
```

**ODER** wenn du nur über IP gehst:
```
Value: http://DEINE_SERVER_IP:6274
```

## Wie es funktioniert

1. User besucht `https://nordstemmen-mcp.levinkeller.de/mcp`
2. Cloudflare Pages empfängt GET Request
3. `functions/_middleware.js` intercepted den Request
4. Middleware proxied zu `$INSPECTOR_URL/mcp` (dein Container)
5. Inspector Container antwortet mit der UI
6. Middleware gibt Response zurück zum User

**POST /mcp** geht direkt zu `functions/mcp.js` (MCP API) - kein Proxy!

## Testen

1. Container läuft auf `inspector.nordstemmen-mcp.levinkeller.de`
2. Teste direkt: `curl https://inspector.nordstemmen-mcp.levinkeller.de`
3. Deploy Cloudflare Pages mit der neuen Middleware
4. Besuche: `https://nordstemmen-mcp.levinkeller.de/mcp`

## Troubleshooting

### Inspector zeigt "Unavailable"

- Check: Container läuft? `docker ps` in Coolify
- Check: Port 6274 exposed?
- Check: Domain/IP erreichbar? `curl https://inspector...`
- Check: `INSPECTOR_URL` Environment Variable gesetzt in CF Pages?

### POST /mcp funktioniert nicht mehr

- Middleware sollte POST durchlassen (check `functions/_middleware.js`)
- `return next()` für alle Nicht-GET Requests

### CORS Errors

- Inspector Container hat eigene CORS Config
- Sollte okay sein, da alles über same domain läuft

## Alternative: Lokale IP (nicht öffentlich)

Falls du den Inspector NICHT öffentlich exponieren willst:

**Problem:** Cloudflare Workers können nicht auf private IPs zugreifen!

**Lösung:** Du musst den Inspector öffentlich machen ODER Cloudflare Tunnel nutzen:

```bash
# In Coolify/Server
cloudflared tunnel --url http://localhost:6274
```

Dann die Tunnel URL als `INSPECTOR_URL` verwenden.
