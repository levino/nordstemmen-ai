# CLAUDE.md

> Machine-readable project context for AI assistants. Human-readable docs: [README.md](README.md)

## Documentation Maintenance Rules

**These rules are mandatory for every commit/push:**

1. **CLAUDE.md ↔ README.md sync**: When you change project structure, commands, architecture, or workflows, update BOTH `CLAUDE.md` (machine-readable) and `README.md` (human-readable). Never let them drift apart.
2. **CHANGELOG.md**: Every user-facing or structural change gets an entry in [CHANGELOG.md](CHANGELOG.md). Follow the existing format (Keep a Changelog). Add entries under `[Unreleased]`. Categories: Added, Changed, Fixed, Removed.
3. **Sub-READMEs**: If changes affect `scraper/`, `pipeline/`, or `mcp-server/`, update their respective `README.md` files too.
4. **Verify before push**: Before pushing, confirm that file paths, command names, and structure descriptions in docs match the actual repository state.

## Project Overview

Semantic search over public documents from the municipality of Nordstemmen (Gemeinde Nordstemmen).
Three components: OParl Scraper, Document Pipeline, MCP Server.
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
├── pipeline/                   # Document Pipeline (TypeScript, async/await)
│   ├── src/
│   │   ├── index.ts            # CLI entry point (parseArgs)
│   │   ├── pipeline.ts         # Orchestrator: per-document processing
│   │   ├── types.ts            # TypeScript interfaces
│   │   ├── config.ts           # Constants (API URLs, models, limits)
│   │   ├── discovery.ts        # Document discovery + metadata parsing
│   │   ├── hash.ts             # SHA256 hashing, LFS pointer detection
│   │   ├── cache.ts            # .fulltext.json / .embeddings.json / .completed I/O
│   │   ├── ocr.ts              # Gemini API: PDF → page-level text
│   │   ├── jina.ts             # Jina API: text → 1024D vectors (with semaphore)
│   │   ├── qdrant.ts           # Qdrant upload (upsert, deduplicate)
│   │   ├── retry.ts            # Retry + concurrency helpers
│   │   ├── rebuild-qdrant.ts   # Standalone: rebuild Qdrant from cached embeddings
│   │   └── __tests__/          # Tests (vitest)
│   │       └── jina-load.test.ts  # Jina API load test (run manually)
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
├── mcp-server/                 # MCP Server (Cloudflare Pages)
│   ├── functions/
│   │   └── mcp.js              # Core MCP implementation (4 tools)
│   ├── src/
│   │   ├── index.html          # Landing page
│   │   └── style.css           # Tailwind CSS
│   ├── mcp-server.test.js      # MCP protocol tests
│   ├── package.json
│   ├── vite.config.js          # Build config
│   ├── vitest.config.js        # Test config
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── wrangler.test.jsonc     # Cloudflare test config
│   └── README.md               # API docs, deployment guide
├── embeddings/                 # Legacy (Python, deprecated — use pipeline/)
├── documents/                  # Downloaded PDFs + metadata (Git LFS)
│   ├── metadata.json           # Master index (all files)
│   ├── papers/                 # ~1578 paper directories
│   │   └── DS_<num>-<year>/
│   │       ├── metadata.json   # OParl paper metadata
│   │       ├── *.pdf           # Main + auxiliary files
│   │       ├── *.fulltext.json # Gemini OCR output (cached)
│   │       ├── *.embeddings.json  # Cached embeddings (LFS)
│   │       └── *.completed     # Completion flag (all steps succeeded)
│   └── meetings/               # ~1087 meeting directories
│       └── <date>_<name>/
│           ├── metadata.json   # OParl meeting metadata
│           ├── *.pdf           # Invitation, protocol, attachments
│           ├── *.fulltext.json # Gemini OCR output (cached)
│           ├── *.embeddings.json  # Cached embeddings (LFS)
│           └── *.completed     # Completion flag (all steps succeeded)
├── scripts/
│   ├── lfs-repair.sh           # Detect/fix LFS pointer files
│   └── update-hashes-to-sha256.py
├── .github/workflows/
│   ├── data-sync.yml           # Hourly CI: scraper + pipeline
│   └── claude.yml              # Claude Code Action (@claude in issues/PRs)
├── .devcontainer/
│   └── devcontainer.json       # Dev container: Node 22, Python, Git LFS
├── .env.example                # All env vars (Qdrant, Jina, Gemini)
├── .gitattributes              # LFS tracking: *.pdf, *.embeddings.json
├── .lfsconfig                  # Custom LFS server: git-lfs.nordstemmen-ai.levinkeller.de
├── biome.json                  # Linter/formatter config
├── CHANGELOG.md                # Project changelog (Keep a Changelog format)
└── package.json                # Root workspace (scraper, pipeline, mcp-server)
```

## Development Commands

```bash
# Root (workspaces: scraper, pipeline, mcp-server)
npm test                        # Run all workspace tests
npm run lint                    # Biome check
npm run lint:fix                # Biome auto-fix
npm run format                  # Biome format
npm run lfs-pull                # Download all LFS files
npm run lfs:repair              # Detect/repair LFS pointer files

# Scraper
cd scraper && npm run scrape    # Run OParl scraper
cd scraper && npm test          # Run scraper tests

# Pipeline
npm run pipeline                          # Process all unprocessed documents
npm run pipeline -- --limit 500           # Limit to 500 documents
npm run pipeline -- --force               # Re-process everything (ignore .completed)
npm run pipeline -- --dry-run             # List files without processing
npm run pipeline -- --skip-qdrant         # Skip Qdrant upload
npm run pipeline -- --only DS_1-2007      # Only matching documents
npm run pipeline -- --concurrency 10      # 10 parallel (default 5)
npm run pipeline -- --max-pdf-size 100    # Max PDF size in MB (default 50)

# MCP Server
cd mcp-server && npm run dev    # Local dev server (Vite + Wrangler)
cd mcp-server && npm test       # Run tests
cd mcp-server && npm run build  # Production build
```

## Architecture

- **Scraper**: TypeScript + Effect library. Crawls OParl API (`/paper` + `/meeting` collections), downloads PDFs, saves structured metadata per entity
- **Pipeline**: TypeScript, plain async/await. Document-oriented processing: PDF → Gemini OCR → Jina Embeddings → Qdrant. No build step (`node --experimental-strip-types`). No partial cache reuse — each run always does fresh OCR + embeddings for unprocessed files. `.completed` flag per PDF is only written after ALL steps succeed
- **MCP Server**: Cloudflare Pages Functions. Four MCP tools: `search_documents` (semantic vector search), `get_paper_by_reference` (direct DS lookup), `search_papers` (filtered metadata search), `get_document_text` (fulltext by hash). Fulltext is served from Cloudflare static assets (bundled `.txt` files), not from an external storage service
- **Vector DB**: Qdrant (self-hosted at qdrant.levinkeller.de)
- **Embeddings API**: Jina AI v3 — `retrieval.passage` for indexing (pipeline), `retrieval.query` for search (MCP server)
- **OCR**: Gemini 2.5 Flash — sends entire PDF as inline data, page-level text extraction via `--- Page N ---` markers
- **Git LFS**: Custom server at git-lfs.nordstemmen-ai.levinkeller.de; tracks PDFs + embedding caches. `.lfsconfig` has `fetchexclude = *` (opt-in download)

## AI Model Choices

- **OCR — Gemini 2.5 Flash**: Chosen after comparing Gemini, GPT-4o, and GPT-4o-mini. Gemini is cheapest (~$0.0001/page vs ~$0.0014 for GPT-4o), produces no hallucinations, and handles rotated PDFs correctly. GPT-4o paraphrases instead of transcribing (rewrites content in its own words, distorting meaning). GPT-4o-mini refuses rotated PDFs and misses content blocks
- **Embeddings — Jina v3 (1024D)**: Multilingual model with German support, task-specific LoRA adapters (`retrieval.passage` for indexing, `retrieval.query` for search). Used via API for both pipeline and MCP server query-time embeddings

## Key Design Decisions

- **Document-oriented pipeline**: Each document goes through the complete chain (OCR → Embeddings → Qdrant) before moving to the next. Simpler error handling, resumable
- **No partial cache reuse**: When processing, always do fresh OCR + embeddings. `.fulltext.json` and `.embeddings.json` are saved as artifacts but never read back by the pipeline. This ensures consistency
- **`.completed` tracking**: A `.completed` file per PDF is written ONLY after all steps (OCR → Embeddings → Qdrant) succeed. On re-run, only files without `.completed` (or with mismatched hash) are processed
- **Gemini OCR**: Sends entire PDF as inline data to Gemini 2.5 Flash — no pdf2image, no poppler dependency. Page-level text via `--- Page N ---` markers in prompt
- **Page-level embeddings**: 1 embedding per page (Jina v3, 1024D). `chunk_index` is always 0. No sub-page chunking
- **Hash-based change detection**: SHA256 per PDF, checked in `.completed` file
- **Fulltext as static assets**: The MCP server serves fulltext from Cloudflare static assets (`.txt` files bundled at deploy time), not from external object storage
- **Custom LFS server**: Separate from GitHub LFS for cost/control
- **OParl metadata preserved**: Full paper/meeting context (DS-numbers, consultations, agenda items) stored in Qdrant payload for rich search results

## Environment Variables

See `.env.example`:
- `QDRANT_URL` — Qdrant server URL
- `QDRANT_API_KEY` — Qdrant API key
- `QDRANT_PORT` — Qdrant port (443)
- `QDRANT_COLLECTION` — Collection name (`nordstemmen`)
- `GOOGLE_API_KEY` — Gemini API key (for pipeline OCR)
- `JINA_API_KEY` — Jina AI API key (for pipeline embeddings + MCP query)

MCP Server additionally needs (set in Cloudflare dashboard):
- `JINA_API_KEY` — Jina AI API key for query embeddings
- `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_PORT`, `QDRANT_COLLECTION`

## Data Update Workflow

1. `cd scraper && npm run scrape` — Download new/changed PDFs + metadata from OParl API
2. `npm run pipeline` — Process all new documents (OCR → Embeddings → Qdrant)
3. `git add documents/ && git commit && git push` — Commit new data (PDFs + caches via LFS)

This runs automatically every hour via GitHub Actions (`data-sync.yml`).
MCP Server deployment is automatic via Cloudflare Pages (on push to main).
