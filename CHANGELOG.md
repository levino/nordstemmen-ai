# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `.force_ocr` flag support in embedding generator: place an empty `.force_ocr` file in a document directory to force OCR re-extraction, bypassing broken embedded text (e.g. Aspose.PDF encoding bug)
- `/project:review-fulltext` skill for AI-assisted quality review of extracted fulltext
- `CLAUDE.md` with accurate project context for AI assistants
- Documentation maintenance rules (CLAUDE.md ↔ README.md sync, changelog, sub-READMEs)
- `CHANGELOG.md` to track project changes

### Fixed
- Wrong file names in README (`generate.py` → `generate_embeddings.py`, `_worker.js` → `functions/mcp.js`)
- Outdated repository structure in README (now reflects papers/meetings subdirs, functions/, src/, scripts/, .devcontainer/, .github/)
- README now documents all 3 MCP tools instead of just `search_documents`
- Missing documentation for PDF proxy, embedding cache, OCR support, custom LFS server
- GitHub URLs corrected (`yourusername` → `levinkeller`)
- Qdrant description corrected from "Cloud" to "Self-hosted"
- `embeddings/README.md` and `mcp-server/README.md` structure diagrams updated

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
