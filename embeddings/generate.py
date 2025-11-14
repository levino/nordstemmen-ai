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

import pdfplumber
import pytesseract
from pdf2image import convert_from_path
from PIL import Image
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue
from tqdm import tqdm
from langchain_text_splitters import RecursiveCharacterTextSplitter
import warnings

# Configure logging (only errors and warnings)
logging.basicConfig(
    level=logging.WARNING,
    format='%(levelname)s - %(message)s'
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
PAPERS_DIR = DOCUMENTS_DIR / 'papers'
MEETINGS_DIR = DOCUMENTS_DIR / 'meetings'

# Embedding model configuration
EMBEDDING_MODEL = 'jinaai/jina-embeddings-v3'
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200
MIN_CHUNK_LENGTH = 100  # Skip chunks shorter than this (e.g., from charts, maps)


class EmbeddingGenerator:
    """Generates and uploads embeddings for PDF documents."""

    def __init__(self):
        """Initialize Qdrant client and embedding model."""
        print("🚀 Initializing Embedding Generator...")

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
        print(f"✓ Connected to Qdrant")

        # Initialize embedding model
        print(f"📦 Loading model: {EMBEDDING_MODEL}")
        self.model = SentenceTransformer(EMBEDDING_MODEL, trust_remote_code=True)
        self.vector_size = self.model.get_sentence_embedding_dimension()
        print(f"✓ Model loaded ({self.vector_size}D vectors)")

        # Initialize text splitter
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=CHUNK_SIZE,
            chunk_overlap=CHUNK_OVERLAP,
            length_function=len,
            separators=["\n\n", "\n", ". ", " ", ""]
        )

        # Ensure collection exists
        self._ensure_collection()

        # Load all processed files into memory cache (performance optimization)
        self.processed_files_cache = self._load_processed_files_cache()
        print(f"✓ Loaded {len(self.processed_files_cache)} already-processed files into cache")
        print()

    def _load_folder_metadata(self, folder_path: Path) -> Dict:
        """Load metadata.json from a paper/meeting folder."""
        metadata_file = folder_path / 'metadata.json'
        if not metadata_file.exists():
            return {}

        try:
            with open(metadata_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Error loading metadata from {metadata_file}: {e}")
            return {}

    def _extract_filename_from_url(self, url: str) -> str:
        """Extract filename from accessUrl or downloadUrl."""
        try:
            from urllib.parse import unquote
            parts = url.split('/')
            last = parts[-1]
            # Decode URL-encoded characters
            filename = unquote(last)
            # Sanitize filename (remove invalid chars)
            filename = filename.replace('/', '_').replace('\\', '_').replace(':', '_')
            return filename
        except Exception as e:
            logger.warning(f"Error extracting filename from URL {url}: {e}")
            return ''

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

    def _load_processed_files_cache(self) -> set:
        """Load all processed (filename, hash) tuples from Qdrant into memory.

        This is a performance optimization to avoid N individual Qdrant calls
        for checking if files are already processed.
        """
        print("🔄 Loading processed files cache from Qdrant...")
        processed = set()

        try:
            offset = None
            while True:
                # Scroll through all points, only fetch filename and file_hash
                result = self.client.scroll(
                    collection_name=QDRANT_COLLECTION,
                    limit=1000,
                    offset=offset,
                    with_payload=['filename', 'file_hash'],
                    with_vectors=False
                )

                points, next_offset = result

                for point in points:
                    payload = point.payload
                    filename = payload.get('filename')
                    file_hash = payload.get('file_hash')
                    if filename and file_hash:
                        processed.add((filename, file_hash))

                # Check if there are more results
                if next_offset is None:
                    break
                offset = next_offset

        except Exception as e:
            logger.warning(f"Error loading processed files cache: {e}")

        return processed

    def _compute_file_hash(self, filepath: Path) -> str:
        """Compute MD5 hash of file."""
        md5 = hashlib.md5()
        with open(filepath, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                md5.update(chunk)
        return md5.hexdigest()

    def _is_already_processed(self, filename: str, file_hash: str) -> bool:
        """Check if file with this hash is already in Qdrant (using in-memory cache)."""
        return (filename, file_hash) in self.processed_files_cache

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

    def _extract_text_with_ocr(self, filepath: Path) -> List[tuple[int, str]]:
        """Extract text from PDF using OCR (fallback for scanned documents)."""
        try:
            # Convert PDF pages to images
            images = convert_from_path(filepath, dpi=300)
            pages = []

            for i, image in enumerate(images):
                try:
                    # Perform OCR with German and English
                    text = pytesseract.image_to_string(image, lang='deu+eng')
                    if text and text.strip():
                        pages.append((i + 1, text))
                except Exception as page_error:
                    logger.warning(f"OCR error on page {i+1} of {filepath.name}: {page_error}")
                    continue

            return pages
        except Exception as e:
            logger.error(f"OCR failed for {filepath.name}: {e}")
            return []

    def _extract_text_from_pdf(self, filepath: Path) -> List[tuple[int, str]]:
        """Extract text from PDF, returns list of (page_num, text) tuples.

        First tries pdfplumber for text extraction. If no text is found
        or extraction fails, falls back to OCR for scanned documents.
        """
        pages = []
        use_ocr = False

        # Try pdfplumber first (fast for text-based PDFs)
        try:
            # Suppress pdfplumber warnings about malformed PDFs
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore", message=".*Cannot set gray.*")
                warnings.filterwarnings("ignore", message=".*invalid float value.*")

                with pdfplumber.open(filepath) as pdf:
                    for i, page in enumerate(pdf.pages):
                        try:
                            text = page.extract_text()
                            if text and text.strip():
                                pages.append((i + 1, text))
                        except Exception as page_error:
                            logger.warning(f"Error extracting page {i+1} from {filepath.name}: {page_error}")
                            continue

        except Exception as e:
            logger.warning(f"pdfplumber failed for {filepath.name}: {e}")
            use_ocr = True

        # Fall back to OCR if no text was extracted
        if not pages or use_ocr:
            logger.info(f"Falling back to OCR for {filepath.name} (no text extracted)")
            pages = self._extract_text_with_ocr(filepath)

        return pages

    def _chunk_text(self, text: str) -> List[str]:
        """Split text into overlapping chunks using LangChain."""
        chunks = self.text_splitter.split_text(text)
        return [c.strip() for c in chunks if c.strip()]

    def _save_embeddings_cache(self, filepath: Path, file_hash: str, chunks_data: List[Dict]):
        """Save embeddings to cache file."""
        cache_file = filepath.parent / 'embeddings.json'
        cache_data = {
            'file_hash': file_hash,
            'filename': filepath.name,
            'chunks': chunks_data
        }

        try:
            with open(cache_file, 'w', encoding='utf-8') as f:
                json.dump(cache_data, f)
        except Exception as e:
            logger.warning(f"Error saving embeddings cache: {e}")

    def _load_embeddings_cache(self, filepath: Path, file_hash: str) -> Optional[List[Dict]]:
        """Load embeddings from cache if file_hash matches."""
        cache_file = filepath.parent / 'embeddings.json'
        if not cache_file.exists():
            return None

        try:
            with open(cache_file, 'r', encoding='utf-8') as f:
                cache_data = json.load(f)

            # Verify hash matches
            if cache_data.get('file_hash') != file_hash:
                return None

            # Verify filename matches
            if cache_data.get('filename') != filepath.name:
                return None

            return cache_data.get('chunks', [])
        except Exception as e:
            logger.warning(f"Error loading embeddings cache: {e}")
            return None

    def process_pdf(self, filepath: Path) -> Optional[bool]:
        """Process a single PDF file.
        Returns:
            True if skipped (already processed)
            False if processed successfully
            None if failed (no text extracted)
        """
        filename = filepath.name
        folder_path = filepath.parent
        relative_path = str(filepath.relative_to(DOCUMENTS_DIR))

        # Compute hash
        file_hash = self._compute_file_hash(filepath)

        # Check if already processed in Qdrant
        if self._is_already_processed(relative_path, file_hash):
            return True  # Skipped

        # Delete old chunks if file changed
        self._delete_old_chunks(relative_path)

        # Load folder metadata
        folder_metadata = self._load_folder_metadata(folder_path)

        # Determine entity type and extract metadata
        entity_type = 'paper' if '/papers/' in str(filepath) else 'meeting' if '/meetings/' in str(filepath) else 'unknown'

        base_metadata = {
            'source': 'oparl',
            'entity_type': entity_type,
            'entity_id': folder_metadata.get('id', ''),
            'entity_name': folder_metadata.get('name', ''),
            'date': folder_metadata.get('date', folder_metadata.get('start', '')),
        }

        # Add paper-specific metadata
        if entity_type == 'paper':
            base_metadata.update({
                'paper_reference': folder_metadata.get('reference', ''),
                'paper_type': folder_metadata.get('paperType', ''),
            })

            # Build filename to accessUrl mapping for all files (main + auxiliary)
            file_url_map = {}

            # Add mainFile
            main_file = folder_metadata.get('mainFile', {})
            if isinstance(main_file, dict) and main_file.get('accessUrl'):
                main_filename = self._extract_filename_from_url(main_file['accessUrl'])
                if main_filename:
                    file_url_map[main_filename] = main_file['accessUrl']

            # Add auxiliaryFiles
            aux_files = folder_metadata.get('auxiliaryFile', [])
            if isinstance(aux_files, list):
                for aux in aux_files:
                    if isinstance(aux, dict) and aux.get('accessUrl'):
                        aux_filename = self._extract_filename_from_url(aux['accessUrl'])
                        if aux_filename:
                            file_url_map[aux_filename] = aux['accessUrl']

            # Find accessUrl for current PDF file
            current_filename = filepath.name
            pdf_access_url = file_url_map.get(current_filename, '')
            if pdf_access_url:
                base_metadata['pdf_access_url'] = pdf_access_url

        # Try to load from cache
        cached_chunks = self._load_embeddings_cache(filepath, file_hash)

        if cached_chunks:
            # Use cached embeddings
            all_points = []
            for chunk_data in cached_chunks:
                # Skip chunks that are too short (e.g., from charts, maps)
                if len(chunk_data.get('text', '').strip()) < MIN_CHUNK_LENGTH:
                    continue

                chunk_id_string = f"{file_hash}_{chunk_data['page']}_{chunk_data['chunk_index']}"
                chunk_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, chunk_id_string))

                point = PointStruct(
                    id=chunk_uuid,
                    vector=chunk_data['vector'],
                    payload={
                        'filename': relative_path,
                        'file_hash': file_hash,
                        'page': chunk_data['page'],
                        'chunk_index': chunk_data['chunk_index'],
                        'text': chunk_data['text'],
                        **base_metadata
                    }
                )
                all_points.append(point)

            # Upload to Qdrant
            if all_points:
                self.client.upsert(
                    collection_name=QDRANT_COLLECTION,
                    points=all_points
                )
                # Update cache with newly processed file
                self.processed_files_cache.add((relative_path, file_hash))

            return False  # Processed from cache

        # Extract text
        pages = self._extract_text_from_pdf(filepath)
        if not pages:
            logger.warning(f"No text extracted from {filename}")
            return None  # Failed

        # Process each page and generate embeddings
        all_points = []
        chunks_for_cache = []

        for page_num, page_text in pages:
            chunks = self._chunk_text(page_text)

            for chunk_idx, chunk_text in enumerate(chunks):
                # Skip empty chunks or chunks that are too short (e.g., from charts, maps)
                if not chunk_text.strip() or len(chunk_text.strip()) < MIN_CHUNK_LENGTH:
                    continue

                # Generate embedding
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
                        **base_metadata
                    }
                )
                all_points.append(point)

                # Save for cache
                chunks_for_cache.append({
                    'page': page_num,
                    'chunk_index': chunk_idx,
                    'text': chunk_text,
                    'vector': embedding
                })

        # Save to cache
        if chunks_for_cache:
            self._save_embeddings_cache(filepath, file_hash, chunks_for_cache)

        # Upload to Qdrant
        if all_points:
            self.client.upsert(
                collection_name=QDRANT_COLLECTION,
                points=all_points
            )
            # Update cache with newly processed file
            self.processed_files_cache.add((relative_path, file_hash))

        return False  # Processed

    def process_all(self):
        """Process all PDFs in documents directory."""
        pdf_files = sorted(DOCUMENTS_DIR.rglob('*.pdf'))

        if not pdf_files:
            print(f"⚠ No PDF files found in {DOCUMENTS_DIR}")
            return

        print(f"📁 Found {len(pdf_files)} PDF files\n")

        # Process each PDF with progress bar
        skipped_count = 0
        failed_count = 0
        processed_count = 0

        with tqdm(pdf_files, desc="Processing", unit="file") as pbar:
            for pdf_file in pbar:
                try:
                    # Update progress bar with current file
                    filename = pdf_file.name[:50] + '...' if len(pdf_file.name) > 50 else pdf_file.name

                    result = self.process_pdf(pdf_file)

                    if result is True:
                        skipped_count += 1
                    elif result is False:
                        processed_count += 1
                    elif result is None:
                        failed_count += 1

                    # Update display with current stats
                    pbar.set_postfix_str(f"Processed: {processed_count} | Skipped: {skipped_count} | Failed: {failed_count} | {filename}")
                except Exception as e:
                    logger.error(f"Error: {pdf_file.name}: {e}")
                    failed_count += 1

        print(f"\n✅ Processing complete!")
        print(f"   Processed: {processed_count}")
        print(f"   Skipped: {skipped_count} (already processed)")
        print(f"   Failed: {failed_count} (no text extracted)")


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
