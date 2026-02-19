# CLAUDE.md

> Machine-readable project context for AI assistants. Human-readable docs: [README.md](README.md)

## Documentation Maintenance Rules

**These rules are mandatory for every commit/push:**

1. **CLAUDE.md ↔ README.md sync**: When you change project structure, commands, architecture, or workflows, update BOTH `CLAUDE.md` (machine-readable) and `README.md` (human-readable). Never let them drift apart.
2. **CHANGELOG.md**: Every user-facing or structural change gets an entry in [CHANGELOG.md](CHANGELOG.md). Follow the existing format (Keep a Changelog). Add entries under `[Unreleased]`. Categories: Added, Changed, Fixed, Removed.
3. **Sub-READMEs**: If changes affect `scraper/`, `embeddings/`, or `mcp-server/`, update their respective `README.md` files too.
4. **Verify before push**: Before pushing, confirm that file paths, command names, and structure descriptions in docs match the actual repository state.

## Project Overview

Semantic search over public documents from the municipality of Nordstemmen (Gemeinde Nordstemmen).
Three components: OParl Scraper, Embedding Generator, MCP Server.
Live at: `https://nordstemmen-mcp.levinkeller.de/mcp`

## Repository Structure

```
nordstemmen-ai/
├── scraper/                    # OParl Scraper (TypeScript, Effect)
│   ├── src/
│   │   ├── index.ts            # CLI entry point
│   │   ├── scraper.ts          # Main scraper logic
│   │   ├── client.ts           # HTTP client
│   │   ├── schema.ts           # OParl type definitions
│   │   └── __tests__/          # Tests (vitest + nock fixtures)
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── README.md               # Detailed OParl data model docs
├── embeddings/                 # Embedding Generator (Python)
│   ├── generate_embeddings.py  # Main: PDF → Embeddings → cache
│   ├── upload_to_qdrant.py     # Upload cached embeddings to Qdrant
│   ├── migrate_embeddings.py   # Migration utility
│   ├── drop_collection.py      # Delete Qdrant collection
│   ├── inspect_data.py         # Data inspection
│   ├── test_*.py               # Various test scripts
│   ├── requirements.txt
│   └── README.md
├── mcp-server/                 # MCP Server (Cloudflare Pages)
│   ├── functions/
│   │   ├── mcp.js              # Core MCP implementation (3 tools)
│   │   └── pdf/
│   │       └── [[sha256]].js   # PDF proxy (serves PDFs by hash)
│   ├── src/
│   │   ├── index.html          # Landing page
│   │   └── style.css           # Tailwind CSS
│   ├── mcp-server.test.js      # MCP protocol tests
│   ├── pdf-proxy.test.js       # PDF proxy tests
│   ├── package.json
│   ├── vite.config.js          # Build config
│   ├── vitest.config.js        # Test config
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── wrangler.test.jsonc     # Cloudflare test config
│   └── README.md               # API docs, deployment guide
├── documents/                  # Downloaded PDFs + metadata (Git LFS)
│   ├── metadata.json           # Master index (all files)
│   ├── papers/                 # ~1578 paper directories
│   │   └── DS_<num>-<year>/
│   │       ├── metadata.json   # OParl paper metadata
│   │       ├── *.pdf           # Main + auxiliary files
│   │       ├── *.fulltext.json # Extracted fulltext (for MCP server)
│   │       ├── *.embeddings.json  # Cached embeddings (LFS)
│   │       └── .force_ocr      # Optional: force OCR re-extraction
│   └── meetings/               # ~1087 meeting directories
│       └── <date>_<name>/
│           ├── metadata.json   # OParl meeting metadata
│           ├── *.pdf           # Invitation, protocol, attachments
│           ├── *.fulltext.json # Extracted fulltext (for MCP server)
│           ├── *.embeddings.json  # Cached embeddings (LFS)
│           └── .force_ocr      # Optional: force OCR re-extraction
├── scripts/
│   ├── lfs-repair.sh           # Detect/fix LFS pointer files
│   └── update-hashes-to-sha256.py
├── .claude/
│   └── commands/
│       └── review-fulltext.md  # Skill: AI review of fulltext quality
├── .github/workflows/
│   └── claude.yml              # Claude Code Action (@claude in issues/PRs)
├── .devcontainer/
│   └── devcontainer.json       # Dev container: Node 22, Python, Git LFS, poppler
├── .env.example                # QDRANT_URL, QDRANT_API_KEY, QDRANT_COLLECTION
├── .gitattributes              # LFS tracking: *.pdf, *.embeddings.json
├── .lfsconfig                  # Custom LFS server: git-lfs.nordstemmen-ai.levinkeller.de
├── biome.json                  # Linter/formatter config
├── CHANGELOG.md                # Project changelog (Keep a Changelog format)
└── package.json                # Root workspace (scraper + mcp-server)
```

## Development Commands

```bash
# Root (workspaces: scraper, mcp-server)
npm test                        # Run all workspace tests
npm run lint                    # Biome check
npm run lint:fix                # Biome auto-fix
npm run format                  # Biome format
npm run lfs-pull                # Download all LFS files
npm run lfs:repair              # Detect/repair LFS pointer files

# Scraper
cd scraper && npm run scrape    # Run OParl scraper
cd scraper && npm test          # Run scraper tests

# Embeddings
cd embeddings
python generate_embeddings.py   # Generate embeddings (PDF → chunks → vectors)
python upload_to_qdrant.py      # Upload to Qdrant
python drop_collection.py       # ⚠️ Delete entire Qdrant collection

# MCP Server
cd mcp-server && npm run dev    # Local dev server (Vite + Wrangler)
cd mcp-server && npm test       # Run tests
cd mcp-server && npm run build  # Production build
```

## Architecture

- **Scraper**: TypeScript + Effect library. Crawls OParl API (`/paper` + `/meeting` collections), downloads PDFs, saves structured metadata per entity
- **Embeddings**: Python. Extracts text (pdfplumber, OCR fallback; `.force_ocr` flag forces OCR), chunks (1000 chars, 200 overlap), generates embeddings (Jina v3, 1024D), caches to `.embeddings.json`, uploads to Qdrant
- **MCP Server**: Cloudflare Pages Functions. Three MCP tools: `search_documents` (semantic vector search), `get_paper_by_reference` (direct DS lookup), `search_papers` (filtered metadata search). Also serves PDFs via proxy at `/pdf/<sha256>`
- **Vector DB**: Qdrant (self-hosted at qdrant.levinkeller.de)
- **Embeddings API**: Jina AI v3 (query-time embeddings)
- **Git LFS**: Custom server at git-lfs.nordstemmen-ai.levinkeller.de; tracks PDFs + embedding caches. `.lfsconfig` has `fetchexclude = *` (opt-in download)

## Key Design Decisions

- **Two-phase embeddings**: Generate locally (free, GPU), query via Jina API (cheap per query)
- **Hash-based change detection**: SHA256 per PDF, tracked in Qdrant payload — no local state needed
- **Embedding cache**: `.embeddings.json` files alongside PDFs, tracked in Git LFS — avoids recomputation
- **Custom LFS server**: Separate from GitHub LFS for cost/control
- **OParl metadata preserved**: Full paper/meeting context (DS-numbers, consultations, agenda items) stored in Qdrant payload for rich search results

## Environment Variables

See `.env.example`:
- `QDRANT_URL` — Qdrant server URL
- `QDRANT_API_KEY` — Qdrant API key
- `QDRANT_PORT` — Qdrant port (443)
- `QDRANT_COLLECTION` — Collection name (`nordstemmen`)

MCP Server additionally needs (set in Cloudflare dashboard):
- `JINA_API_KEY` — Jina AI API key for query embeddings

## OCR Quality Review

Some PDFs have broken embedded text (e.g. Aspose.PDF encoding bug in 2019-2020 documents). The `.force_ocr` flag mechanism handles this:

- **`.force_ocr` flag**: Empty file placed in a document directory. Forces OCR re-extraction for all PDFs in that folder, bypassing pdfplumber.
- **`/project:review-fulltext` skill**: AI agent reviews `.fulltext.json` files for gibberish text and sets `.force_ocr` flags where needed. Run occasionally, not in CI.
- When `generate_embeddings.py` runs, it detects `.force_ocr` flags and invalidates cached fulltext/embeddings that were generated without OCR.

## Data Update Workflow (current — manual/local)

1. `cd scraper && npm run scrape` — Download new/changed PDFs + metadata from OParl API
2. `cd embeddings && python generate_embeddings.py` — Generate embeddings for new PDFs
3. `cd embeddings && python upload_to_qdrant.py` — Upload new embeddings to Qdrant
4. `git add documents/ && git commit && git push` — Commit new data (PDFs + embeddings via LFS)

MCP Server deployment is automatic via Cloudflare Pages (on push to main).
