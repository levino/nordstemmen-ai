# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Hybrid Search**: `search_documents` now combines dense (Jina v3) and sparse (BM25-TF) vectors via Reciprocal Rank Fusion (RRF). Improves results for exact names, numbers, and street names
- **Sparse Vectors** (`pipeline/src/sparse.ts`): Local BM25-TF computation with FNV-1a token hashing and German stopwords. No external API needed
- **Migration script** (`npm run migrate:sparse` in pipeline): One-time Qdrant rebuild from cached embeddings — no API calls needed. Delete `migrate-sparse.ts` after use
- **Document Pipeline** (`pipeline/`): New TypeScript workspace replacing all Python processing scripts. Single command (`npm run pipeline`) processes documents end-to-end: PDF → Gemini OCR → Jina Embeddings → Qdrant
- Pipeline CLI flags: `--limit`, `--force`, `--dry-run`, `--skip-qdrant`, `--only`, `--concurrency`, `--max-pdf-size`
- Gemini 2.5 Flash OCR: sends entire PDF as inline data (no pdf2image/poppler dependency)
- Page-level embeddings via Jina v3 API (`retrieval.passage` task, 1024D vectors)
- `.completed` tracking per PDF — written only after all steps (OCR → Embeddings → Qdrant) succeed, enables reliable resume on interruption
- Jina API semaphore for concurrency limiting (handles both free and paid tier limits)
- `rebuild-qdrant.ts` script to rebuild Qdrant from cached `.embeddings.json` files without API costs
- Jina load test (`pipeline/src/__tests__/jina-load.test.ts`) for verifying API limits
- `CLAUDE.md` with accurate project context for AI assistants
- Documentation maintenance rules (CLAUDE.md ↔ README.md sync, changelog, sub-READMEs)
- `CHANGELOG.md` to track project changes
- AI model choice documentation (why Gemini 2.5 Flash for OCR, why Jina v3 for embeddings)

### Changed
- **Qdrant collection schema**: Switched from unnamed vectors to named vectors (`dense` + `sparse`). Requires collection rebuild
- **MCP `search_documents`**: Uses Qdrant Query API with `prefetch` + `fusion: 'rrf'` instead of simple `search()`
- MCP tool responses now return JSON in `content.text` instead of formatted Markdown, so AI clients can reliably access all fields including `file_hash`
- Removed `structuredContent` from MCP responses (most clients ignored it)
- Data update workflow simplified from 4 Python scripts to single `npm run pipeline` command
- Pipeline always does fresh OCR + embeddings per file (no partial cache reuse from `.fulltext.json`/`.embeddings.json`)

### Removed
- **Backblaze B2 integration** — PDF and fulltext storage removed from pipeline. MCP server now serves fulltext from Cloudflare static assets (bundled `.txt` files)
- **PDF proxy endpoint** (`/pdf/<sha256>`) — removed from MCP server, PDFs are linked directly to the Ratsinformationssystem
- `--skip-b2` CLI flag (B2 no longer exists)
- Partial cache reuse (pipeline no longer reads existing `.fulltext.json`/`.embeddings.json` to skip steps)

### Deprecated
- Python embedding scripts (`embeddings/generate_embeddings.py`, `embeddings/upload_to_qdrant.py`, `scripts/vision_ocr.py`, `scripts/upload_to_b2.py`) — replaced by `pipeline/`

### Fixed
- `searchPapers` was not fetching `file_hash` from Qdrant (missing in `with_payload`)
- `file_hash` was invisible to AI clients because it only existed in `structuredContent`, which most MCP clients ignore
- Wrong file names in README (`generate.py` → `generate_embeddings.py`, `_worker.js` → `functions/mcp.js`)
- Outdated repository structure in README
- GitHub URLs corrected (`yourusername` → `levino`)
- Qdrant description corrected from "Cloud" to "Self-hosted"
- Documentation updated: removed all B2 and PDF proxy references, added AI model rationale, corrected MCP tool count (4 not 3)

## [1.0.0] - 2025-11-12 – 2026-02-18

Initial production release, developed incrementally.

### Added
- **OParl Scraper** (TypeScript/Effect): Crawls Paper and Meeting collections, downloads PDFs with structured OParl metadata
- **Embedding Generator** (Python): PDF text extraction (pdfplumber + OCR fallback), chunking, Jina v3 embeddings (1024D), `.embeddings.json` cache files
- **MCP Server** (Cloudflare Pages): Three tools — `search_documents` (semantic vector search), `get_paper_by_reference` (DS-number lookup), `search_papers` (filtered metadata search)
- **PDF Proxy**: Serves PDFs by SHA256 hash via `/pdf/<sha256>`
- **Landing Page**: Setup instructions for Claude and ChatGPT integration
- **Git LFS**: Custom LFS server (`git-lfs.nordstemmen-ai.levinkeller.de`) for PDF and embedding cache storage
- **Dev Container**: Node 22, Python, Git LFS, poppler-utils
- **Claude Code Action**: GitHub Actions workflow for @claude mentions in issues/PRs
- **ChatGPT support**: Documentation for ChatGPT MCP connector setup
- Hash-based change detection (SHA256) for incremental processing
- Production error sanitization in MCP server
- Deep links to original documents in Ratsinformationssystem
- ~5,800 PDFs indexed from 2006 to present
