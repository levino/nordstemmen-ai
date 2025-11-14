# Migration to Standard Cloudflare Pages Structure

## Old Structure (Deprecated)
- `_worker.js` - Hono app with all routes and HTML embedded as strings

## New Structure

```
mcp-server/
├── public/              # Static assets (served from CDN)
│   ├── index.html      # Homepage (GET /)
│   └── mcp/
│       └── index.html  # MCP Inspector page (GET /mcp)
├── functions/          # Serverless Functions
│   └── mcp.js         # MCP API (POST /mcp)
├── package.json
└── README.md
```

## Benefits

### Static Assets (public/)
- ✅ Served directly from Cloudflare CDN (faster)
- ✅ Browser caching optimized
- ✅ No serverless function invocation cost for static pages
- ✅ Real HTML files with proper IDE support
- ✅ Easy to edit and maintain

### Functions (functions/)
- ✅ Only POST /mcp requires serverless execution
- ✅ Clean separation of concerns
- ✅ No Hono dependency needed
- ✅ Native Cloudflare Pages Functions API

## How It Works

### GET / and GET /mcp
- Served as static HTML from `public/` directory
- No JavaScript execution required
- Fast CDN delivery

### POST /mcp
- Handled by `functions/mcp.js`
- Full MCP protocol implementation
- CORS enabled
- Supports batch and single requests

## Deployment

Cloudflare Pages automatically:
1. Serves everything in `public/` as static assets
2. Routes `/mcp` POST requests to `functions/mcp.js`
3. Serves `public/mcp/index.html` for GET `/mcp` requests
4. Serves `public/index.html` for GET `/` requests

No configuration needed!

## Environment Variables

Same as before:
- `QDRANT_URL`
- `QDRANT_COLLECTION`
- `QDRANT_API_KEY`
- `JINA_API_KEY`
- `QDRANT_PORT` (optional)
- `ENVIRONMENT` (optional, defaults to production)
