# Coolify Port-Konfiguration für MCP Inspector

## Das Problem

Der MCP Inspector braucht **zwei Ports**:
- `6274` - MCPI Client UI (Web-Interface)
- `6277` - MCPP Proxy Server (Backend)

Aber eine Domain mit HTTPS läuft nur auf Port `443`.

## Lösung 1: --network host (EINFACHSTE) ✅

### Container-Konfiguration in Coolify:

```yaml
Name: nordstemmen-mcp-inspector
Image: ghcr.io/modelcontextprotocol/inspector:latest

Network Mode: host
```

**Dann in Coolify:**
- Domain: `mcp-inspector.levinkeller.de`
- Port Mapping: `6274` (nur die UI!)

**Warum das funktioniert:**
- Container läuft mit `--network host`
- UI (Port 6274) und Proxy (Port 6277) laufen auf localhost
- Sie kommunizieren intern über localhost
- Nach außen wird nur Port 6274 exposed (die UI)
- Die UI verbindet sich intern zu localhost:6277

### DNS in Cloudflare:
```
Type: A
Name: mcp-inspector
Content: [DEINE_SERVER_IP]
Proxy: Proxied (orange) - für SSL
```

---

## Lösung 2: Zwei Subdomains (falls host nicht geht)

### Container 1 - UI:
```yaml
Name: mcp-inspector-ui
Image: ghcr.io/modelcontextprotocol/inspector:latest
Port: 6274:6274
Domain: mcp-inspector.levinkeller.de
```

### Container 2 - Proxy:
```yaml
Name: mcp-inspector-proxy
Image: ghcr.io/modelcontextprotocol/inspector:latest
Port: 6277:6277
Domain: mcp-inspector-proxy.levinkeller.de
```

**Problem:** Du müsstest dann den Inspector so konfigurieren, dass er weiß,
wo der Proxy läuft (über Environment Variable).

---

## Lösung 3: Nginx Reverse Proxy (KOMPLEX)

Ein Nginx vor dem Container:

```nginx
server {
  listen 443 ssl;
  server_name mcp-inspector.levinkeller.de;

  location / {
    proxy_pass http://localhost:6274;
  }

  location /proxy {
    proxy_pass http://localhost:6277;
  }
}
```

**Problem:** Der Inspector erwartet den Proxy auf Port 6277, nicht auf einem Path.

---

## Empfehlung: Lösung 1 (host network)

Das ist die einfachste und sollte mit Coolify funktionieren:

### In Coolify:

1. **Service erstellen:**
   - Type: Docker Image
   - Image: `ghcr.io/modelcontextprotocol/inspector:latest`

2. **Network Settings:**
   - Network Mode: `host` (wichtig!)

3. **Domain Settings:**
   - Domain: `mcp-inspector.levinkeller.de`
   - Port: `6274` (nur die UI)

4. **Environment Variables:**
   ```
   CLIENT_PORT=6274
   SERVER_PORT=6277
   ```

### Testen:

```bash
# Sollte die Inspector UI zeigen
curl https://mcp-inspector.levinkeller.de

# Im Browser öffnen
https://mcp-inspector.levinkeller.de
```

Die UI verbindet sich dann intern zu `localhost:6277` für den Proxy.

---

## Falls host network nicht funktioniert:

Versuche **Bridge Network** mit beiden Ports:

```yaml
Ports:
  - 6274:6274
  - 6277:6277

Domain: mcp-inspector.levinkeller.de:6274
```

Dann musst du eventuell in der URL explizit den Port angeben:
`https://mcp-inspector.levinkeller.de:6274`

Aber das wird mit HTTPS und Cloudflare Proxy kompliziert.
