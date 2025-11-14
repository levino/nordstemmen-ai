#!/usr/bin/env python3
"""
Qdrant Uploader for Nordstemmen Transparent

Uploads pre-generated embeddings from embeddings.json files to Qdrant.
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

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue
from tqdm import tqdm

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

# Update mode: If true, update metadata for already processed files
UPDATE_QDRANT_METADATA = os.getenv('UPDATE_QDRANT_METADATA', 'false').lower() == 'true'


class QdrantUploader:
    """Uploads pre-generated embeddings to Qdrant."""

    def __init__(self):
        """Initialize Qdrant client."""
        print("🚀 Initializing Qdrant Uploader...")

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

        # Ensure collection exists
        self._ensure_collection()

        # Load all processed files into memory cache (performance optimization)
        self.processed_files_cache = self._load_processed_files_cache()
        print(f"✓ Loaded {len(self.processed_files_cache)} already-processed files into cache")

        if UPDATE_QDRANT_METADATA:
            print("⚠️  UPDATE_QDRANT_METADATA mode enabled - will update metadata for already processed files")

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
            # We need to determine vector size from first embeddings file
            # For now, use default Jina v3 size (1024)
            vector_size = 1024
            self.client.create_collection(
                collection_name=QDRANT_COLLECTION,
                vectors_config=VectorParams(
                    size=vector_size,
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

    def _load_embeddings_file(self, embeddings_file: Path) -> Optional[Dict]:
        """Load embeddings.json file."""
        if not embeddings_file.exists():
            return None

        try:
            with open(embeddings_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Error loading embeddings from {embeddings_file}: {e}")
            return None

    def upload_from_embeddings_file(self, embeddings_file: Path) -> Optional[bool]:
        """Upload embeddings from an embeddings.json file to Qdrant.
        Returns:
            True if skipped (already processed)
            False if uploaded successfully
            None if failed (no embeddings found)
        """
        folder_path = embeddings_file.parent

        # Load embeddings data
        embeddings_data = self._load_embeddings_file(embeddings_file)
        if not embeddings_data:
            logger.warning(f"No embeddings data in {embeddings_file}")
            return None

        file_hash = embeddings_data.get('file_hash')
        pdf_filename = embeddings_data.get('filename')
        chunks = embeddings_data.get('chunks', [])

        if not file_hash or not pdf_filename or not chunks:
            logger.warning(f"Invalid embeddings data in {embeddings_file}")
            return None

        # Find the PDF file
        pdf_filepath = folder_path / pdf_filename
        if not pdf_filepath.exists():
            logger.warning(f"PDF file not found: {pdf_filepath}")
            return None

        relative_path = str(pdf_filepath.relative_to(DOCUMENTS_DIR))

        # Check if already processed in Qdrant
        already_processed = self._is_already_processed(relative_path, file_hash)

        if already_processed and not UPDATE_QDRANT_METADATA:
            return True  # Skipped

        # Delete old chunks only if file changed (not when just updating metadata)
        if not already_processed:
            self._delete_old_chunks(relative_path)

        # Load folder metadata
        folder_metadata = self._load_folder_metadata(folder_path)

        # Determine entity type and extract metadata
        entity_type = 'paper' if '/papers/' in str(pdf_filepath) else 'meeting' if '/meetings/' in str(pdf_filepath) else 'unknown'

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
            current_filename = pdf_filepath.name
            pdf_access_url = file_url_map.get(current_filename, '')
            if pdf_access_url:
                base_metadata['pdf_access_url'] = pdf_access_url

        # Create points from chunks
        all_points = []
        for chunk_data in chunks:
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

        return False  # Processed

    def upload_all(self):
        """Upload all embeddings from *.embeddings.json files."""
        embeddings_files = sorted(DOCUMENTS_DIR.rglob('*.embeddings.json'))

        if not embeddings_files:
            print(f"⚠ No *.embeddings.json files found in {DOCUMENTS_DIR}")
            return

        print(f"📁 Found {len(embeddings_files)} *.embeddings.json files\n")

        # Upload each embeddings file with progress bar
        skipped_count = 0
        failed_count = 0
        uploaded_count = 0

        with tqdm(embeddings_files, desc="Uploading", unit="file") as pbar:
            for embeddings_file in pbar:
                try:
                    # Update progress bar with current folder
                    folder_name = embeddings_file.parent.name[:50] + '...' if len(embeddings_file.parent.name) > 50 else embeddings_file.parent.name

                    result = self.upload_from_embeddings_file(embeddings_file)

                    if result is True:
                        skipped_count += 1
                    elif result is False:
                        uploaded_count += 1
                    elif result is None:
                        failed_count += 1

                    # Update display with current stats
                    pbar.set_postfix_str(f"Uploaded: {uploaded_count} | Skipped: {skipped_count} | Failed: {failed_count} | {folder_name}")
                except Exception as e:
                    logger.error(f"Error: {embeddings_file}: {e}")
                    failed_count += 1

        print(f"\n✅ Upload complete!")
        print(f"   Uploaded: {uploaded_count}")
        print(f"   Skipped: {skipped_count} (already in Qdrant)")
        print(f"   Failed: {failed_count} (invalid data)")


def main():
    """Main entry point."""
    try:
        uploader = QdrantUploader()
        uploader.upload_all()
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        raise


if __name__ == '__main__':
    main()
