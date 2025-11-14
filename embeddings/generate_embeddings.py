#!/usr/bin/env python3
"""
Embedding Generator for Nordstemmen Transparent

Processes PDFs from documents/ directory and generates embeddings locally.
Uses hash-based change detection to avoid reprocessing unchanged files.
Saves embeddings to embeddings.json files in each folder.
"""

import os
import json
import hashlib
import logging
from pathlib import Path
from typing import List, Dict, Optional
from dotenv import load_dotenv

# Set tokenizers parallelism before importing transformers/sentence-transformers
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import pdfplumber
import pytesseract
from pdf2image import convert_from_path
from PIL import Image
from sentence_transformers import SentenceTransformer
from tqdm import tqdm
from langchain_text_splitters import RecursiveCharacterTextSplitter
import warnings

# Suppress the torch_dtype deprecation warning from sentence-transformers
warnings.filterwarnings("ignore", message=".*torch_dtype.*is deprecated.*")

# Configure logging (only errors and warnings)
logging.basicConfig(
    level=logging.WARNING,
    format='%(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv(Path(__file__).parent.parent / '.env')

# Configuration
DOCUMENTS_DIR = Path(__file__).parent.parent / 'documents'
PAPERS_DIR = DOCUMENTS_DIR / 'papers'
MEETINGS_DIR = DOCUMENTS_DIR / 'meetings'

# Embedding model configuration
EMBEDDING_MODEL = 'jinaai/jina-embeddings-v3'
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200


class LocalEmbeddingGenerator:
    """Generates embeddings for PDF documents and saves them locally."""

    def __init__(self):
        """Initialize embedding model."""
        print("🚀 Initializing Local Embedding Generator...")
        
        # Check for MPS (Apple Silicon GPU) availability
        import torch
        if torch.backends.mps.is_available():
            device = "mps"
            print(f"🎮 Using Apple Silicon GPU (MPS)")
        else:
            device = "cpu"
            print(f"💻 Using CPU (MPS not available)")

        # Initialize embedding model
        print(f"📦 Loading model: {EMBEDDING_MODEL}")
        self.model = SentenceTransformer(EMBEDDING_MODEL, trust_remote_code=True, device=device)
        
        # Optimize PyTorch for maximum GPU performance
        if device == "mps":
            import torch
            # Enable optimized attention and compilation (if supported)
            torch.backends.mps.enable_fallback = False
            print("🔥 Enabled MPS optimizations for maximum GPU performance")
        
        self.vector_size = self.model.get_sentence_embedding_dimension()
        print(f"✓ Model loaded ({self.vector_size}D vectors) on {device.upper()}")

        # Initialize text splitter
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=CHUNK_SIZE,
            chunk_overlap=CHUNK_OVERLAP,
            length_function=len,
            separators=["\n\n", "\n", ". ", " ", ""]
        )

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

    def _compute_file_hash(self, filepath: Path) -> str:
        """Compute MD5 hash of file."""
        md5 = hashlib.md5()
        with open(filepath, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                md5.update(chunk)
        return md5.hexdigest()

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
        # Use PDF filename (without extension) + .embeddings.json to avoid overwrites
        cache_filename = filepath.stem + '.embeddings.json'
        cache_file = filepath.parent / cache_filename
        cache_data = {
            'file_hash': file_hash,
            'filename': filepath.name,
            'chunks': chunks_data
        }

        try:
            with open(cache_file, 'w', encoding='utf-8') as f:
                json.dump(cache_data, f, indent=2)
            logger.info(f"Saved embeddings to {cache_file}")
        except Exception as e:
            logger.warning(f"Error saving embeddings cache: {e}")

    def _load_embeddings_cache(self, filepath: Path, file_hash: str) -> Optional[List[Dict]]:
        """Load embeddings from cache if file_hash matches."""
        # Use PDF filename (without extension) + .embeddings.json
        cache_filename = filepath.stem + '.embeddings.json'
        cache_file = filepath.parent / cache_filename
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
        """Process a single PDF file and generate embeddings.
        Returns:
            True if skipped (already processed)
            False if processed successfully
            None if failed (no text extracted)
        """
        filename = filepath.name
        folder_path = filepath.parent

        # Compute hash
        file_hash = self._compute_file_hash(filepath)

        # Check if embeddings already exist and are up-to-date
        cached_chunks = self._load_embeddings_cache(filepath, file_hash)
        if cached_chunks:
            return True  # Already processed

        # Load folder metadata
        folder_metadata = self._load_folder_metadata(folder_path)

        # Extract text
        pages = self._extract_text_from_pdf(filepath)
        if not pages:
            logger.warning(f"No text extracted from {filename}")
            return None  # Failed

        # Process each page and generate embeddings
        chunks_for_cache = []
        all_chunks_text = []
        chunk_metadata = []

        # First, collect all chunks and their metadata
        for page_num, page_text in pages:
            chunks = self._chunk_text(page_text)

            for chunk_idx, chunk_text in enumerate(chunks):
                if not chunk_text.strip():
                    continue
                
                all_chunks_text.append(chunk_text)
                chunk_metadata.append({
                    'page_num': page_num,
                    'chunk_idx': chunk_idx
                })

        # Batch encode all chunks at once for better GPU utilization
        if all_chunks_text:
            # Increase batch size for better GPU utilization
            embeddings = self.model.encode(
                all_chunks_text,
                task='retrieval.passage',
                batch_size=32,  # Optimal batch size to avoid RAM overload
                show_progress_bar=False,
                normalize_embeddings=True,  # Enable normalization on GPU
                convert_to_tensor=False  # Return as numpy for faster processing
            ).tolist()

            # Save for cache - pair each embedding with its metadata
            for i, (embedding, metadata) in enumerate(zip(embeddings, chunk_metadata)):
                chunks_for_cache.append({
                    'page': metadata['page_num'],
                    'chunk_index': metadata['chunk_idx'],
                    'text': all_chunks_text[i],
                    'vector': embedding
                })

        # Save to cache
        if chunks_for_cache:
            self._save_embeddings_cache(filepath, file_hash, chunks_for_cache)

        return False  # Processed

    def process_all(self):
        """Process all PDFs in documents directory."""
        pdf_files = sorted(DOCUMENTS_DIR.rglob('*.pdf'))

        if not pdf_files:
            print(f"⚠ No PDF files found in {DOCUMENTS_DIR}")
            return

        print(f"📁 Found {len(pdf_files)} PDF files")
        
        # First pass: identify files that need processing
        print("🔍 Checking which files need processing...")
        files_to_process = []
        skipped_count = 0
        
        for pdf_file in tqdm(pdf_files, desc="Scanning", unit="file"):
            file_hash = self._compute_file_hash(pdf_file)
            cached_chunks = self._load_embeddings_cache(pdf_file, file_hash)
            if cached_chunks:
                skipped_count += 1
            else:
                files_to_process.append(pdf_file)
        
        print(f"📊 Analysis complete: {len(files_to_process)} files to process, {skipped_count} already done\n")

        if not files_to_process:
            print("✅ All files are already processed!")
            return

        # Second pass: process only files that need it
        failed_count = 0
        processed_count = 0

        with tqdm(files_to_process, desc="Processing", unit="file") as pbar:
            for pdf_file in pbar:
                try:
                    # Update progress bar with current file
                    filename = pdf_file.name[:50] + '...' if len(pdf_file.name) > 50 else pdf_file.name

                    result = self.process_pdf(pdf_file)

                    if result is False:  # Successfully processed
                        processed_count += 1
                    elif result is None:  # Failed
                        failed_count += 1

                    # Update display with current stats
                    pbar.set_postfix_str(f"Processed: {processed_count} | Failed: {failed_count} | {filename}")
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
        generator = LocalEmbeddingGenerator()
        generator.process_all()
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        raise


if __name__ == '__main__':
    main()
