#!/usr/bin/env python3
"""
Embedding Generator for Nordstemmen Transparent

Processes PDFs from documents/ directory and generates embeddings.
Uses hash-based change detection to avoid reprocessing unchanged files.
Saves embeddings to .embeddings.json files in each folder.

Supports two modes:
- Local: Uses sentence-transformers with Jina v3 model (requires PyTorch)
- API: Uses Jina AI API for embeddings (CI-friendly, no PyTorch needed)

Set JINA_API_KEY env var to use API mode automatically.
"""

import os
import json
import hashlib
import logging
import signal
from pathlib import Path
from typing import List, Dict, Optional
from abc import ABC, abstractmethod
from dotenv import load_dotenv

import pdfplumber
import pytesseract
from pdf2image import convert_from_path
from PIL import Image
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
DOCUMENTS_DIR = Path(__file__).parent.parent / 'documents'
PAPERS_DIR = DOCUMENTS_DIR / 'papers'
MEETINGS_DIR = DOCUMENTS_DIR / 'meetings'

# Embedding model configuration
EMBEDDING_MODEL = 'jinaai/jina-embeddings-v3'
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200


def _is_lfs_pointer(filepath: Path) -> bool:
    """Check if a file is a Git LFS pointer (not actual content)."""
    try:
        size = filepath.stat().st_size
        if size > 200:
            return False
        with open(filepath, 'rb') as f:
            header = f.read(40)
        return header.startswith(b'version https://git-lfs')
    except Exception:
        return False


def _backfill_single_file(pdf_file: Path, file_hash: str) -> bool:
    """Backfill fulltext for a single PDF. Top-level function for multiprocessing."""
    try:
        gen = _BackfillHelper()
        pages = gen._extract_text_from_pdf(pdf_file)
        if pages:
            gen._save_fulltext(pdf_file, file_hash, pages)
            return True
        else:
            gen._save_fulltext_skip(pdf_file, file_hash)
            return False
    except Exception as e:
        try:
            gen._save_fulltext_skip(pdf_file, file_hash, reason=str(e))
        except Exception:
            pass
        return False


class _BackfillHelper:
    """Lightweight helper for text extraction in subprocess (no model loading)."""

    def _extract_text_with_ocr(self, filepath: Path, timeout_per_page: int = 30) -> List[tuple[int, str]]:
        try:
            images = convert_from_path(filepath, dpi=200)
            pages = []
            for i, image in enumerate(images):
                try:
                    text = pytesseract.image_to_string(
                        image, lang='deu+eng', timeout=timeout_per_page
                    )
                    if text and text.strip():
                        pages.append((i + 1, text))
                except RuntimeError:
                    continue
                except Exception:
                    continue
            return pages
        except Exception:
            return []

    def _extract_text_from_pdf(self, filepath: Path) -> List[tuple[int, str]]:
        pages = []
        use_ocr = False
        try:
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore", message=".*Cannot set gray.*")
                warnings.filterwarnings("ignore", message=".*invalid float value.*")
                with pdfplumber.open(filepath) as pdf:
                    for i, page in enumerate(pdf.pages):
                        try:
                            text = page.extract_text()
                            if text and text.strip():
                                pages.append((i + 1, text))
                        except Exception:
                            continue
        except Exception:
            use_ocr = True
        if not pages or use_ocr:
            pages = self._extract_text_with_ocr(filepath)
        return pages

    def _save_fulltext(self, filepath: Path, file_hash: str, pages: List[tuple[int, str]]):
        fulltext_file = filepath.parent / (filepath.stem + '.fulltext.json')
        full_text = "\n\n".join(text for _, text in pages)
        fulltext_data = {
            'file_hash': file_hash,
            'filename': filepath.name,
            'pages': [{'page': page_num, 'text': text} for page_num, text in pages],
            'full_text': full_text
        }
        with open(fulltext_file, 'w', encoding='utf-8') as f:
            json.dump(fulltext_data, f, ensure_ascii=False, indent=2)

    def _save_fulltext_skip(self, filepath: Path, file_hash: str, reason: str = 'no text extracted'):
        fulltext_file = filepath.parent / (filepath.stem + '.fulltext.json')
        skip_data = {
            'file_hash': file_hash,
            'filename': filepath.name,
            'skipped': True,
            'reason': reason,
            'pages': [],
            'full_text': ''
        }
        with open(fulltext_file, 'w', encoding='utf-8') as f:
            json.dump(skip_data, f, ensure_ascii=False, indent=2)


class EmbeddingGeneratorBase(ABC):
    """Base class for embedding generators. Handles text extraction, chunking, and caching."""

    def __init__(self):
        """Initialize text splitter."""
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=CHUNK_SIZE,
            chunk_overlap=CHUNK_OVERLAP,
            length_function=len,
            separators=["\n\n", "\n", ". ", " ", ""]
        )

    @abstractmethod
    def _encode_chunks(self, texts: List[str]) -> List[List[float]]:
        """Encode a batch of text chunks into embedding vectors."""
        pass

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
            filename = unquote(last)
            filename = filename.replace('/', '_').replace('\\', '_').replace(':', '_')
            return filename
        except Exception as e:
            logger.warning(f"Error extracting filename from URL {url}: {e}")
            return ''

    def _compute_file_hash(self, filepath: Path) -> str:
        """Compute SHA256 hash of file."""
        sha256 = hashlib.sha256()
        with open(filepath, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                sha256.update(chunk)
        return sha256.hexdigest()

    def _extract_text_with_ocr(self, filepath: Path, timeout_per_page: int = 30) -> List[tuple[int, str]]:
        """Extract text from PDF using OCR (fallback for scanned documents)."""
        try:
            images = convert_from_path(filepath, dpi=200)
            pages = []

            for i, image in enumerate(images):
                try:
                    # Timeout per page to avoid hanging on corrupt/complex pages
                    text = pytesseract.image_to_string(
                        image, lang='deu+eng', timeout=timeout_per_page
                    )
                    if text and text.strip():
                        pages.append((i + 1, text))
                except RuntimeError:
                    logger.warning(f"OCR timeout on page {i+1} of {filepath.name}")
                    continue
                except Exception as page_error:
                    logger.warning(f"OCR error on page {i+1} of {filepath.name}: {page_error}")
                    continue

            return pages
        except Exception as e:
            logger.error(f"OCR failed for {filepath.name}: {e}")
            return []

    def _extract_text_from_pdf(self, filepath: Path) -> List[tuple[int, str]]:
        """Extract text from PDF, returns list of (page_num, text) tuples."""
        pages = []
        use_ocr = False

        try:
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
        """Load embeddings from cache if file_hash matches.

        Returns:
            List of chunks if cache is valid
            Empty list [] if cache exists but is unreadable (e.g. LFS pointer)
            None if no cache file exists
        """
        cache_filename = filepath.stem + '.embeddings.json'
        cache_file = filepath.parent / cache_filename
        if not cache_file.exists():
            return None

        # LFS pointers exist but can't be parsed — treat as "already processed"
        if _is_lfs_pointer(cache_file):
            return []

        try:
            with open(cache_file, 'r', encoding='utf-8') as f:
                cache_data = json.load(f)

            if cache_data.get('file_hash') != file_hash:
                return None

            if cache_data.get('filename') != filepath.name:
                return None

            return cache_data.get('chunks', [])
        except Exception as e:
            logger.warning(f"Error loading embeddings cache: {e}")
            return None

    def _save_fulltext(self, filepath: Path, file_hash: str, pages: List[tuple[int, str]]):
        """Save extracted fulltext as .fulltext.json for B2 upload."""
        fulltext_file = filepath.parent / (filepath.stem + '.fulltext.json')
        full_text = "\n\n".join(text for _, text in pages)
        fulltext_data = {
            'file_hash': file_hash,
            'filename': filepath.name,
            'pages': [{'page': page_num, 'text': text} for page_num, text in pages],
            'full_text': full_text
        }

        try:
            with open(fulltext_file, 'w', encoding='utf-8') as f:
                json.dump(fulltext_data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.warning(f"Error saving fulltext: {e}")

    def _save_fulltext_skip(self, filepath: Path, file_hash: str, reason: str = 'no text extracted'):
        """Save a skip marker so we don't retry failed text extraction."""
        fulltext_file = filepath.parent / (filepath.stem + '.fulltext.json')
        skip_data = {
            'file_hash': file_hash,
            'filename': filepath.name,
            'skipped': True,
            'reason': reason,
            'pages': [],
            'full_text': ''
        }

        try:
            with open(fulltext_file, 'w', encoding='utf-8') as f:
                json.dump(skip_data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.warning(f"Error saving skip marker: {e}")

    def _load_fulltext(self, filepath: Path) -> Optional[List[tuple[int, str]]]:
        """Load previously extracted text from .fulltext.json if available.

        Returns:
            List of (page, text) tuples if text available
            Empty list [] if file was marked as skipped (no text extractable)
            None if no fulltext file exists
        """
        fulltext_file = filepath.parent / (filepath.stem + '.fulltext.json')
        if not fulltext_file.exists() or _is_lfs_pointer(fulltext_file):
            return None

        try:
            with open(fulltext_file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            # Skipped files — return empty list to signal "already tried, nothing there"
            if data.get('skipped'):
                return []

            pages = [(p['page'], p['text']) for p in data.get('pages', [])]
            return pages if pages else None
        except Exception as e:
            logger.warning(f"Error loading fulltext from {fulltext_file}: {e}")
            return None

    def process_pdf(self, filepath: Path) -> Optional[bool]:
        """Process a single PDF file and generate embeddings.

        Pipeline: PDF → fulltext.json → embeddings.json
        The fulltext.json is the single source of truth for extracted text.

        Returns:
            True if skipped (already processed)
            False if processed successfully
            None if failed (no text extracted)
        """
        # Skip LFS pointers
        if _is_lfs_pointer(filepath):
            return True

        # Compute hash
        file_hash = self._compute_file_hash(filepath)

        # Check if embeddings already exist and are up-to-date
        cached_chunks = self._load_embeddings_cache(filepath, file_hash)
        if cached_chunks is not None:
            return True  # Already processed

        # Step 1: Ensure fulltext.json exists
        pages = self._load_fulltext(filepath)
        if pages is None:
            # No fulltext yet — extract from PDF
            pages = self._extract_text_from_pdf(filepath)
            if pages:
                self._save_fulltext(filepath, file_hash, pages)
            else:
                self._save_fulltext_skip(filepath, file_hash)
        elif not pages:
            # Empty list = previously marked as skipped
            pass

        if not pages:
            return None  # No text available

        # Process each page and generate embeddings
        all_chunks_text = []
        chunk_metadata = []

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

        if not all_chunks_text:
            return None

        # Encode all chunks
        embeddings = self._encode_chunks(all_chunks_text)

        # Save for cache
        chunks_for_cache = []
        for i, (embedding, metadata) in enumerate(zip(embeddings, chunk_metadata)):
            chunks_for_cache.append({
                'page': metadata['page_num'],
                'chunk_index': metadata['chunk_idx'],
                'text': all_chunks_text[i],
                'vector': embedding
            })

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

        fulltext_backfill = []

        for pdf_file in tqdm(pdf_files, desc="Scanning", unit="file"):
            # Skip LFS pointers
            if _is_lfs_pointer(pdf_file):
                skipped_count += 1
                continue

            file_hash = self._compute_file_hash(pdf_file)
            cached_chunks = self._load_embeddings_cache(pdf_file, file_hash)
            if cached_chunks is not None:
                skipped_count += 1
                # Check if fulltext needs backfill
                fulltext_file = pdf_file.parent / (pdf_file.stem + '.fulltext.json')
                if not fulltext_file.exists():
                    fulltext_backfill.append((pdf_file, file_hash))
            else:
                files_to_process.append(pdf_file)

        print(f"📊 Analysis complete: {len(files_to_process)} files to process, {skipped_count} already done")

        # Backfill fulltext for already-processed PDFs (parallelized)
        if fulltext_backfill:
            import multiprocessing
            from concurrent.futures import ProcessPoolExecutor, as_completed

            max_workers = multiprocessing.cpu_count() * 2
            print(f"📝 Backfilling fulltext for {len(fulltext_backfill)} files ({max_workers} workers)...")
            backfill_ok = 0
            backfill_fail = 0

            with ProcessPoolExecutor(max_workers=max_workers) as executor:
                futures = {
                    executor.submit(_backfill_single_file, pdf_file, file_hash): pdf_file
                    for pdf_file, file_hash in fulltext_backfill
                }
                with tqdm(total=len(futures), desc="Fulltext", unit="file") as pbar:
                    for future in as_completed(futures):
                        try:
                            success = future.result()
                            if success:
                                backfill_ok += 1
                            else:
                                backfill_fail += 1
                        except Exception as e:
                            backfill_fail += 1
                        pbar.update(1)
                        pbar.set_postfix(ok=backfill_ok, fail=backfill_fail)

            print(f"   Fulltext: {backfill_ok} generated, {backfill_fail} failed")

        print()

        if not files_to_process:
            print("✅ All files are already processed!")
            return

        # Second pass: process only files that need it
        failed_count = 0
        processed_count = 0

        with tqdm(files_to_process, desc="Processing", unit="file") as pbar:
            for pdf_file in pbar:
                try:
                    filename = pdf_file.name[:50] + '...' if len(pdf_file.name) > 50 else pdf_file.name

                    result = self.process_pdf(pdf_file)

                    if result is False:  # Successfully processed
                        processed_count += 1
                    elif result is None:  # Failed
                        failed_count += 1

                    pbar.set_postfix_str(f"Processed: {processed_count} | Failed: {failed_count} | {filename}")
                except Exception as e:
                    logger.error(f"Error: {pdf_file.name}: {e}")
                    failed_count += 1

        print(f"\n✅ Processing complete!")
        print(f"   Processed: {processed_count}")
        print(f"   Skipped: {skipped_count} (already processed)")
        print(f"   Failed: {failed_count} (no text extracted)")


class LocalEmbeddingGenerator(EmbeddingGeneratorBase):
    """Generates embeddings using local sentence-transformers model."""

    def __init__(self):
        """Initialize embedding model."""
        super().__init__()
        print("🚀 Initializing Local Embedding Generator...")

        # Set tokenizers parallelism before importing transformers
        os.environ["TOKENIZERS_PARALLELISM"] = "false"

        # Suppress the torch_dtype deprecation warning
        warnings.filterwarnings("ignore", message=".*torch_dtype.*is deprecated.*")

        import torch
        from sentence_transformers import SentenceTransformer

        # Check for MPS (Apple Silicon GPU) availability
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
            torch.backends.mps.enable_fallback = False
            print("🔥 Enabled MPS optimizations for maximum GPU performance")

        self.vector_size = self.model.get_sentence_embedding_dimension()
        print(f"✓ Model loaded ({self.vector_size}D vectors) on {device.upper()}")
        print()

    def _encode_chunks(self, texts: List[str]) -> List[List[float]]:
        """Encode chunks using local sentence-transformers model."""
        embeddings = self.model.encode(
            texts,
            task='retrieval.passage',
            batch_size=32,
            show_progress_bar=False,
            normalize_embeddings=True,
            convert_to_tensor=False
        ).tolist()
        return embeddings


class ApiEmbeddingGenerator(EmbeddingGeneratorBase):
    """Generates embeddings using Jina AI API (no PyTorch needed)."""

    JINA_API_URL = 'https://api.jina.ai/v1/embeddings'
    BATCH_SIZE = 64  # Jina API supports up to 2048 inputs

    def __init__(self):
        """Initialize API generator."""
        super().__init__()
        import requests
        self._requests = requests

        self.api_key = os.getenv('JINA_API_KEY')
        if not self.api_key:
            raise ValueError("JINA_API_KEY must be set for API mode")

        print("🚀 Initializing API Embedding Generator (Jina AI)...")
        print(f"📦 Model: {EMBEDDING_MODEL} (via API)")
        print()

    def _encode_chunks(self, texts: List[str]) -> List[List[float]]:
        """Encode chunks using Jina AI API."""
        all_embeddings = []

        for i in range(0, len(texts), self.BATCH_SIZE):
            batch = texts[i:i + self.BATCH_SIZE]

            response = self._requests.post(
                self.JINA_API_URL,
                headers={
                    'Authorization': f'Bearer {self.api_key}',
                    'Content-Type': 'application/json',
                },
                json={
                    'model': 'jina-embeddings-v3',
                    'input': batch,
                    'task': 'retrieval.passage',
                },
                timeout=120,
            )

            if not response.ok:
                raise RuntimeError(f"Jina API error: {response.status_code} {response.text}")

            data = response.json()
            batch_embeddings = [item['embedding'] for item in data['data']]
            all_embeddings.extend(batch_embeddings)

        return all_embeddings


def main():
    """Main entry point."""
    try:
        # Choose generator based on environment
        if os.getenv('JINA_API_KEY'):
            generator = ApiEmbeddingGenerator()
        else:
            generator = LocalEmbeddingGenerator()

        generator.process_all()
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        raise


if __name__ == '__main__':
    main()
