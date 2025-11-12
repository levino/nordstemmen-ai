#!/usr/bin/env python3
"""
Embedding Generator for Nordstemmen Transparent

Processes PDFs from documents/ directory and uploads embeddings to Qdrant.
Uses hash-based change detection to avoid reprocessing unchanged files.
"""

import os
import json
import hashlib
import logging
import uuid
from pathlib import Path
from typing import List, Dict, Optional
from dotenv import load_dotenv

from pypdf import PdfReader
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue
from tqdm import tqdm
from langchain_text_splitters import RecursiveCharacterTextSplitter

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv(Path(__file__).parent.parent / '.env')

# Configuration
QDRANT_URL = os.getenv('QDRANT_URL')
QDRANT_API_KEY = os.getenv('QDRANT_API_KEY')
QDRANT_PORT = int(os.getenv('QDRANT_PORT', 443))
QDRANT_COLLECTION = os.getenv('QDRANT_COLLECTION', 'nordstemmen')
DOCUMENTS_DIR = Path(__file__).parent.parent / 'documents'
METADATA_FILE = DOCUMENTS_DIR / 'metadata.json'

# Embedding model configuration
EMBEDDING_MODEL = 'jinaai/jina-embeddings-v3'
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200


class EmbeddingGenerator:
    """Generates and uploads embeddings for PDF documents."""

    def __init__(self):
        """Initialize Qdrant client and embedding model."""
        logger.info("Initializing Embedding Generator...")

        # Validate configuration
        if not QDRANT_URL or not QDRANT_API_KEY:
            raise ValueError("QDRANT_URL and QDRANT_API_KEY must be set in .env")

        # Initialize Qdrant client
        self.client = QdrantClient(
            url=QDRANT_URL,
            api_key=QDRANT_API_KEY,
            port=QDRANT_PORT,
            timeout=30,  # Increase timeout for remote server
        )
        logger.info(f"Connected to Qdrant at {QDRANT_URL}:{QDRANT_PORT}")

        # Initialize embedding model
        logger.info(f"Loading embedding model: {EMBEDDING_MODEL}")
        self.model = SentenceTransformer(EMBEDDING_MODEL, trust_remote_code=True)
        self.vector_size = self.model.get_sentence_embedding_dimension()
        logger.info(f"Model loaded, vector size: {self.vector_size}")

        # Initialize text splitter
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=CHUNK_SIZE,
            chunk_overlap=CHUNK_OVERLAP,
            length_function=len,
            separators=["\n\n", "\n", ". ", " ", ""]
        )
        logger.info(f"Text splitter configured: {CHUNK_SIZE} chars, {CHUNK_OVERLAP} overlap")

        # Load metadata
        self.metadata = self._load_metadata()
        logger.info(f"Loaded metadata for {len(self.metadata)} files")

        # Ensure collection exists
        self._ensure_collection()

    def _load_metadata(self) -> Dict:
        """Load OParl metadata from metadata.json."""
        if not METADATA_FILE.exists():
            logger.warning(f"Metadata file not found: {METADATA_FILE}")
            return {}

        with open(METADATA_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)

    def _ensure_collection(self):
        """Create Qdrant collection if it doesn't exist."""
        collections = [c.name for c in self.client.get_collections().collections]

        if QDRANT_COLLECTION not in collections:
            logger.info(f"Creating collection: {QDRANT_COLLECTION}")
            self.client.create_collection(
                collection_name=QDRANT_COLLECTION,
                vectors_config=VectorParams(
                    size=self.vector_size,
                    distance=Distance.COSINE
                )
            )
        else:
            logger.info(f"Collection exists: {QDRANT_COLLECTION}")

    def _compute_file_hash(self, filepath: Path) -> str:
        """Compute MD5 hash of file."""
        md5 = hashlib.md5()
        with open(filepath, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                md5.update(chunk)
        return md5.hexdigest()

    def _is_already_processed(self, filename: str, file_hash: str) -> bool:
        """Check if file with this hash is already in Qdrant."""
        try:
            result = self.client.scroll(
                collection_name=QDRANT_COLLECTION,
                scroll_filter=Filter(
                    must=[
                        FieldCondition(
                            key="filename",
                            match=MatchValue(value=filename)
                        ),
                        FieldCondition(
                            key="file_hash",
                            match=MatchValue(value=file_hash)
                        )
                    ]
                ),
                limit=1
            )
            return len(result[0]) > 0
        except Exception as e:
            logger.warning(f"Error checking if file processed: {e}")
            return False

    def _delete_old_chunks(self, filename: str):
        """Delete old chunks for a file (when file changed)."""
        try:
            self.client.delete(
                collection_name=QDRANT_COLLECTION,
                points_selector=Filter(
                    must=[
                        FieldCondition(
                            key="filename",
                            match=MatchValue(value=filename)
                        )
                    ]
                )
            )
            logger.info(f"Deleted old chunks for {filename}")
        except Exception as e:
            logger.warning(f"Error deleting old chunks: {e}")

    def _extract_text_from_pdf(self, filepath: Path) -> List[tuple[int, str]]:
        """Extract text from PDF, returns list of (page_num, text) tuples."""
        try:
            reader = PdfReader(str(filepath))
            pages = []

            for i, page in enumerate(reader.pages):
                text = page.extract_text()
                if text.strip():
                    pages.append((i + 1, text))

            return pages
        except Exception as e:
            logger.error(f"Error extracting text from {filepath}: {e}")
            return []

    def _chunk_text(self, text: str) -> List[str]:
        """Split text into overlapping chunks using LangChain."""
        chunks = self.text_splitter.split_text(text)
        return [c.strip() for c in chunks if c.strip()]

    def _get_metadata_for_file(self, filename: str) -> Dict:
        """Get OParl metadata for a file."""
        # Find metadata by matching filename
        for oparl_id, meta in self.metadata.items():
            if meta.get('filename', '').endswith(filename):
                return {
                    'oparl_id': oparl_id,
                    'date': meta.get('date'),
                    'name': meta.get('name'),
                    'mime_type': meta.get('mime_type'),
                    'access_url': meta.get('access_url')
                }
        return {}

    def process_pdf(self, filepath: Path):
        """Process a single PDF file."""
        filename = filepath.name
        relative_path = str(filepath.relative_to(DOCUMENTS_DIR))

        # Compute hash
        file_hash = self._compute_file_hash(filepath)

        # Check if already processed
        if self._is_already_processed(relative_path, file_hash):
            logger.info(f"⊘ Skipping {filename} (already processed)")
            return

        logger.info(f"📄 Processing {filename}")

        # Delete old chunks if file changed
        self._delete_old_chunks(relative_path)

        # Extract text
        pages = self._extract_text_from_pdf(filepath)
        if not pages:
            logger.warning(f"No text extracted from {filename}")
            return

        # Get metadata
        file_metadata = self._get_metadata_for_file(filename)

        # Process each page
        all_points = []
        point_id = 0

        for page_num, page_text in pages:
            chunks = self._chunk_text(page_text)

            for chunk_idx, chunk_text in enumerate(chunks):
                if not chunk_text.strip():
                    continue

                # Generate embedding (use retrieval.passage task for documents)
                embedding = self.model.encode(
                    chunk_text,
                    task='retrieval.passage'
                ).tolist()

                # Create deterministic UUID for this chunk
                chunk_id_string = f"{file_hash}_{page_num}_{chunk_idx}"
                chunk_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, chunk_id_string))

                # Create point
                point = PointStruct(
                    id=chunk_uuid,
                    vector=embedding,
                    payload={
                        'filename': relative_path,
                        'file_hash': file_hash,
                        'page': page_num,
                        'chunk_index': chunk_idx,
                        'text': chunk_text,
                        'source': 'oparl',
                        **file_metadata
                    }
                )
                all_points.append(point)
                point_id += 1

        # Upload to Qdrant
        if all_points:
            self.client.upsert(
                collection_name=QDRANT_COLLECTION,
                points=all_points
            )
            logger.info(f"✓ Uploaded {len(all_points)} chunks for {filename}")
        else:
            logger.warning(f"No chunks generated for {filename}")

    def process_all(self):
        """Process all PDFs in documents directory."""
        pdf_files = list(DOCUMENTS_DIR.rglob('*.pdf'))

        if not pdf_files:
            logger.warning(f"No PDF files found in {DOCUMENTS_DIR}")
            return

        logger.info(f"Found {len(pdf_files)} PDF files")

        for pdf_file in tqdm(pdf_files, desc="Processing PDFs"):
            try:
                self.process_pdf(pdf_file)
            except Exception as e:
                logger.error(f"Error processing {pdf_file.name}: {e}")

        logger.info("✅ Processing complete!")


def main():
    """Main entry point."""
    try:
        generator = EmbeddingGenerator()
        generator.process_all()
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        raise


if __name__ == '__main__':
    main()
