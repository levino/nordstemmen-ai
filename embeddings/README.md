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
4. For new/changed files:
   - Extracts text from PDF
   - Splits into chunks (500 chars, 50 overlap)
   - Generates embeddings using `paraphrase-multilingual-MiniLM-L12-v2`
   - Uploads to Qdrant with metadata from `metadata.json`

## Payload Schema

Each chunk is stored with:
- `filename`: Relative path to PDF
- `file_hash`: MD5 hash of PDF
- `page`: Page number
- `chunk_index`: Chunk index within page
- `text`: Actual text content
- `source`: Always "oparl"
- `oparl_id`: OParl ID from metadata
- `date`: Document date
- `name`: Document name
- `access_url`: Download URL

## Re-processing

Files are automatically re-processed when:
- Hash changes (file was modified)
- Not found in Qdrant

To force re-processing:
```bash
# Delete all chunks in Qdrant for a specific file
# (will be re-processed on next run)
```
