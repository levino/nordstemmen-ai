# Embedding Generator

Generates embeddings for PDF documents and uploads them to Qdrant.

## Setup

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

## Usage

```bash
# Make sure .env is configured with Qdrant credentials
cd embeddings
source venv/bin/activate
python generate.py
```

## What it does

1. Loads all PDFs from `../documents/`
2. Computes MD5 hash for each file
3. Checks Qdrant if file already processed (by filename + hash)
4. Checks for cached embeddings in `embeddings.json` (Git LFS tracked)
5. For new/changed files:
   - Extracts text from PDF (tries pdfplumber first, falls back to OCR for scanned documents)
   - Splits into chunks (1000 chars, 200 overlap)
   - Generates embeddings using `jinaai/jina-embeddings-v3`
   - Saves embeddings to `embeddings.json` cache file
   - Uploads to Qdrant with metadata from `metadata.json`

## Payload Schema

Each chunk is stored with:
- `filename`: Relative path to PDF
- `file_hash`: MD5 hash of PDF
- `page`: Page number
- `chunk_index`: Chunk index within page
- `text`: Actual text content
- `source`: Always "oparl"
- `entity_type`: "paper" or "meeting"
- `entity_id`: OParl ID
- `entity_name`: Name/title
- `date`: Document date
- `paper_reference`: Drucksachennummer (for papers only)
- `paper_type`: Type like "Beschlussvorlage", "Mitteilungsvorlage" (for papers only)

## OCR Support

The generator automatically handles scanned PDFs:
- First tries pdfplumber for text extraction (fast)
- Falls back to tesseract OCR if no text found (slower)
- Uses German + English language support (`deu+eng`)
- OCR results are cached in `embeddings.json` like regular text

## Embedding Cache

Embeddings are cached to disk in `embeddings.json` files:
- Tracked via Git LFS (large binary files)
- Significantly speeds up rebuilds
- Cache is invalidated when PDF hash changes
- Contains vectors and text chunks

## Re-processing

Files are automatically re-processed when:
- Hash changes (file was modified)
- Not found in Qdrant
- Cache is missing or invalid

Cached embeddings are reused when available (no recomputation needed).
