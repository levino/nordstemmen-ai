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
Four components: OParl Scraper, Document Pipeline, MCP Server, and legacy Embedding Generator (Python, deprecated).
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
│   │   ├── cache.ts            # .fulltext.json / .embeddings.json I/O
│   │   ├── ocr.ts              # Gemini API: PDF → page-level text
│   │   ├── sparse.ts           # BM25-TF sparse vectors (FNV-1a hash, German stopwords)
│   │   ├── migrate-sparse.ts   # One-time migration script (delete after use)
│   │   ├── embeddings.ts       # Jina API: text → 1024D vectors
│   │   ├── qdrant.ts           # Qdrant upload (named vectors: dense + sparse)
│   │   ├── b2.ts               # Backblaze B2 upload (PDF + fulltext)
│   │   └── retry.ts            # Retry + concurrency helpers
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
├── embeddings/                 # Embedding Generator (Python, deprecated)
│   ├── generate_embeddings.py  # Main: PDF → Embeddings → cache
│   ├── upload_to_qdrant.py     # Upload cached embeddings to Qdrant
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
│   │       ├── *.fulltext.json # Gemini OCR output (cached)
│   │       └── *.embeddings.json  # Cached embeddings (LFS)
│   └── meetings/               # ~1087 meeting directories
│       └── <date>_<name>/
│           ├── metadata.json   # OParl meeting metadata
│           ├── *.pdf           # Invitation, protocol, attachments
│           ├── *.fulltext.json # Gemini OCR output (cached)
│           └── *.embeddings.json  # Cached embeddings (LFS)
├── scripts/
│   ├── lfs-repair.sh           # Detect/fix LFS pointer files
│   └── update-hashes-to-sha256.py
├── .github/workflows/
│   └── claude.yml              # Claude Code Action (@claude in issues/PRs)
├── .devcontainer/
│   └── devcontainer.json       # Dev container: Node 22, Python, Git LFS, poppler
├── .env.example                # All env vars (Qdrant, Jina, Gemini, B2)
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

# Pipeline (replaces all Python scripts)
npm run migrate:sparse -w pipeline        # One-time: rebuild Qdrant with sparse vectors (no API calls)
npm run pipeline                          # Process all unprocessed documents
npm run pipeline -- --limit 500           # Limit to 500 documents
npm run pipeline -- --force               # Re-process everything (ignore cache)
npm run pipeline -- --dry-run             # List files without processing
npm run pipeline -- --skip-b2             # Skip B2 upload
npm run pipeline -- --skip-qdrant         # Skip Qdrant upload
npm run pipeline -- --only DS_1-2007      # Only matching documents
npm run pipeline -- --concurrency 3       # 3 parallel (default 5)
npm run pipeline -- --max-pdf-size 100    # Max PDF size in MB (default 50)

# Embeddings (Python, deprecated — use pipeline instead)
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
- **Pipeline**: TypeScript, plain async/await. Document-oriented processing: PDF → Gemini OCR → Jina Embeddings + local Sparse Vectors → Qdrant → B2. Replaces all Python scripts. No build step (`node --experimental-strip-types`). Uses `@google/genai` SDK for Gemini, raw `fetch` for Jina, `@qdrant/js-client-rest` for Qdrant, raw `fetch` for B2
- **MCP Server**: Cloudflare Pages Functions. Three MCP tools: `search_documents` (hybrid search: dense + sparse with RRF fusion), `get_paper_by_reference` (direct DS lookup), `search_papers` (filtered metadata search). Also serves PDFs via proxy at `/pdf/<sha256>`
- **Embeddings (deprecated)**: Python. Replaced by pipeline. Kept for reference
- **Vector DB**: Qdrant (self-hosted at qdrant.levinkeller.de). Named vectors: `dense` (Jina 1024D, Cosine) + `sparse` (BM25-TF)
- **Hybrid Search**: MCP Server uses Qdrant Query API with `prefetch` (dense + sparse) and RRF (Reciprocal Rank Fusion). Combines semantic similarity with keyword matching
- **Sparse Vectors**: Locally computed BM25-TF weights with FNV-1a token hashing. Same tokenizer in pipeline (`sparse.ts`) and MCP server (`mcp.js`). German stopwords, no external API needed
- **Embeddings API**: Jina AI v3 — `retrieval.passage` for indexing (pipeline), `retrieval.query` for search (MCP server)
- **OCR**: Gemini 2.5 Flash — sends entire PDF as inline data, page-level text extraction via `--- Page N ---` markers
- **PDF/Text Storage**: Backblaze B2 — PDFs as `{sha256}`, fulltext as `{sha256}.txt`
- **Git LFS**: Custom server at git-lfs.nordstemmen-ai.levinkeller.de; tracks PDFs + embedding caches. `.lfsconfig` has `fetchexclude = *` (opt-in download)

## Key Design Decisions

- **Document-oriented pipeline**: Each document goes through the complete chain (OCR → Embeddings → Qdrant → B2) before moving to the next. Simpler error handling, resumable
- **Gemini OCR**: Sends entire PDF as inline data to Gemini 2.5 Flash — no pdf2image, no poppler dependency. Page-level text via `--- Page N ---` markers in prompt
- **Page-level embeddings**: 1 dense embedding + 1 sparse vector per page (Jina v3, 1024D). `chunk_index` is always 0. No sub-page chunking
- **Hybrid search via RRF**: Dense vectors (semantic) + sparse vectors (keyword/BM25) combined via Reciprocal Rank Fusion. Improves results for exact names, numbers, street names
- **Hash-based change detection**: SHA256 per PDF, tracked in Qdrant payload — no local state needed
- **Cache files**: `.fulltext.json` and `.embeddings.json` alongside PDFs — avoids recomputation. Pipeline reuses cached OCR and dense embeddings, only computes sparse vectors locally
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
- `B2_KEY_ID` — Backblaze B2 key ID (for pipeline upload)
- `B2_APP_KEY` — Backblaze B2 application key
- `B2_BUCKET_ID` — Backblaze B2 bucket ID
- `B2_BUCKET_NAME` — Backblaze B2 bucket name

MCP Server additionally needs (set in Cloudflare dashboard):
- `JINA_API_KEY` — Jina AI API key for query embeddings

## Data Update Workflow

1. `cd scraper && npm run scrape` — Download new/changed PDFs + metadata from OParl API
2. `npm run pipeline` — Process all new documents (OCR → Embeddings → Qdrant → B2)
3. `git add documents/ && git commit && git push` — Commit new data (PDFs + caches via LFS)

MCP Server deployment is automatic via Cloudflare Pages (on push to main).
