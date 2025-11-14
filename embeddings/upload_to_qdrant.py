#!/usr/bin/env python3
"""
Qdrant Uploader for Nordstemmen Transparent

Uploads pre-generated embeddings from *.embeddings.json files to Qdrant.
Uses metadata.json as source of truth for file information.
"""

import os
import json
import hashlib
import logging
import uuid
from pathlib import Path
from typing import List, Dict, Optional, Tuple
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

# Update mode: If true, update metadata for already processed files
UPDATE_QDRANT_METADATA = os.getenv('UPDATE_QDRANT_METADATA', 'false').lower() == 'true'


class QdrantUploader:
    """Uploads pre-generated embeddings to Qdrant using metadata-driven approach."""

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
            timeout=30,
        )
        print(f"✓ Connected to Qdrant")

        # Ensure collection exists
        self._ensure_collection()

        # Load all processed files into memory cache
        self.processed_files_cache = self._load_processed_files_cache()
        print(f"✓ Loaded {len(self.processed_files_cache)} already-processed files into cache")

        if UPDATE_QDRANT_METADATA:
            print("⚠️  UPDATE_QDRANT_METADATA mode enabled - will update metadata for already processed files")

        print()

    def _ensure_collection(self):
        """Create Qdrant collection if it doesn't exist."""
        collections = [c.name for c in self.client.get_collections().collections]

        if QDRANT_COLLECTION not in collections:
            logger.info(f"Creating collection: {QDRANT_COLLECTION}")
            vector_size = 1024  # Jina v3 default
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
        """Load all processed (filename, hash) tuples from Qdrant into memory."""
        print("🔄 Loading processed files cache from Qdrant...")
        processed = set()

        try:
            offset = None
            while True:
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
        """Check if file with this hash is already in Qdrant."""
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

    def _get_file_objects_from_paper(self, metadata: Dict) -> List[Dict]:
        """Extract file objects from paper metadata."""
        files = []

        # mainFile
        main_file = metadata.get('mainFile')
        if isinstance(main_file, dict) and main_file.get('accessUrl'):
            files.append({
                'file_type': 'mainFile',
                'file_id': main_file.get('id', ''),
                'access_url': main_file.get('accessUrl', ''),
                'download_url': main_file.get('downloadUrl', ''),
                'name': main_file.get('name', ''),
            })

        # auxiliaryFile
        aux_files = metadata.get('auxiliaryFile', [])
        if isinstance(aux_files, list):
            for aux in aux_files:
                if isinstance(aux, dict) and aux.get('accessUrl'):
                    files.append({
                        'file_type': 'auxiliaryFile',
                        'file_id': aux.get('id', ''),
                        'access_url': aux.get('accessUrl', ''),
                        'download_url': aux.get('downloadUrl', ''),
                        'name': aux.get('name', ''),
                    })

        return files

    def _get_file_objects_from_meeting(self, metadata: Dict) -> List[Dict]:
        """Extract file objects from meeting metadata."""
        files = []

        # invitation
        invitation = metadata.get('invitation')
        if isinstance(invitation, dict) and invitation.get('accessUrl'):
            files.append({
                'file_type': 'invitation',
                'file_id': invitation.get('id', ''),
                'access_url': invitation.get('accessUrl', ''),
                'download_url': invitation.get('downloadUrl', ''),
                'name': invitation.get('name', ''),
            })

        # resultsProtocol
        results_protocol = metadata.get('resultsProtocol')
        if isinstance(results_protocol, dict) and results_protocol.get('accessUrl'):
            files.append({
                'file_type': 'resultsProtocol',
                'file_id': results_protocol.get('id', ''),
                'access_url': results_protocol.get('accessUrl', ''),
                'download_url': results_protocol.get('downloadUrl', ''),
                'name': results_protocol.get('name', ''),
            })

        # auxiliaryFile from agendaItems
        agenda_items = metadata.get('agendaItem', [])
        if isinstance(agenda_items, list):
            for item in agenda_items:
                if not isinstance(item, dict):
                    continue
                aux_files = item.get('auxiliaryFile', [])
                if isinstance(aux_files, list):
                    for aux in aux_files:
                        if isinstance(aux, dict) and aux.get('accessUrl'):
                            files.append({
                                'file_type': 'auxiliaryFile',
                                'file_id': aux.get('id', ''),
                                'access_url': aux.get('accessUrl', ''),
                                'download_url': aux.get('downloadUrl', ''),
                                'name': aux.get('name', ''),
                            })

        return files

    def _upload_file_embeddings(
        self,
        folder_path: Path,
        file_obj: Dict,
        base_metadata: Dict
    ) -> Optional[bool]:
        """Upload embeddings for a single file.

        Returns:
            True if skipped (already processed)
            False if uploaded successfully
            None if failed (no embeddings or error)
        """
        # Extract filename from URL
        access_url = file_obj['access_url']
        pdf_filename = self._extract_filename_from_url(access_url)
        if not pdf_filename:
            logger.warning(f"Could not extract filename from URL: {access_url}")
            return None

        # Find embeddings file
        pdf_stem = Path(pdf_filename).stem
        embeddings_file = folder_path / f"{pdf_stem}.embeddings.json"

        if not embeddings_file.exists():
            # No embeddings for this file yet - not an error, just skip
            return None

        # Load embeddings
        try:
            with open(embeddings_file, 'r', encoding='utf-8') as f:
                embeddings_data = json.load(f)
        except Exception as e:
            logger.warning(f"Error loading {embeddings_file}: {e}")
            return None

        file_hash = embeddings_data.get('file_hash')
        chunks = embeddings_data.get('chunks', [])

        if not file_hash or not chunks:
            logger.warning(f"Invalid embeddings data in {embeddings_file}")
            return None

        # Check if PDF exists
        pdf_filepath = folder_path / pdf_filename
        if not pdf_filepath.exists():
            logger.warning(f"PDF not found: {pdf_filepath}")
            return None

        relative_path = str(pdf_filepath.relative_to(DOCUMENTS_DIR))

        # Check if already processed
        already_processed = self._is_already_processed(relative_path, file_hash)

        if already_processed and not UPDATE_QDRANT_METADATA:
            return True  # Skipped

        # Delete old chunks if file changed
        if not already_processed:
            self._delete_old_chunks(relative_path)

        # Build metadata for this file
        file_metadata = {
            **base_metadata,
            'file_type': file_obj['file_type'],
            'file_id': file_obj['file_id'],
            'pdf_access_url': access_url,
            'pdf_download_url': file_obj.get('download_url', ''),
        }

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
                    **file_metadata
                }
            )
            all_points.append(point)

        # Upload to Qdrant
        if all_points:
            self.client.upsert(
                collection_name=QDRANT_COLLECTION,
                points=all_points
            )
            self.processed_files_cache.add((relative_path, file_hash))

        return False  # Processed

    def _process_folder(self, metadata_file: Path) -> Tuple[int, int, int]:
        """Process all files in a folder based on its metadata.json.

        Returns:
            (uploaded_count, skipped_count, failed_count)
        """
        folder_path = metadata_file.parent

        # Load metadata
        try:
            with open(metadata_file, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
        except Exception as e:
            logger.warning(f"Error loading {metadata_file}: {e}")
            return (0, 0, 1)

        # Determine entity type
        entity_type = 'paper' if '/papers/' in str(folder_path) else 'meeting' if '/meetings/' in str(folder_path) else 'unknown'

        # Build base metadata
        base_metadata = {
            'source': 'oparl',
            'entity_type': entity_type,
            'entity_id': metadata.get('id', ''),
            'entity_name': metadata.get('name', ''),
            'date': metadata.get('date', metadata.get('start', '')),
        }

        # Add paper-specific metadata
        if entity_type == 'paper':
            base_metadata.update({
                'paper_reference': metadata.get('reference', ''),
                'paper_type': metadata.get('paperType', ''),
            })

        # Get file objects based on entity type
        if entity_type == 'paper':
            file_objects = self._get_file_objects_from_paper(metadata)
        elif entity_type == 'meeting':
            file_objects = self._get_file_objects_from_meeting(metadata)
        else:
            logger.warning(f"Unknown entity type for {folder_path}")
            return (0, 0, 1)

        # Process each file
        uploaded = 0
        skipped = 0
        failed = 0

        for file_obj in file_objects:
            result = self._upload_file_embeddings(folder_path, file_obj, base_metadata)

            if result is True:
                skipped += 1
            elif result is False:
                uploaded += 1
            elif result is None:
                failed += 1

        return (uploaded, skipped, failed)

    def upload_all(self):
        """Upload all embeddings using metadata.json as source of truth."""
        # Find all metadata.json files
        metadata_files = sorted(DOCUMENTS_DIR.rglob('metadata.json'))

        if not metadata_files:
            print(f"⚠ No metadata.json files found in {DOCUMENTS_DIR}")
            return

        print(f"📁 Found {len(metadata_files)} folders with metadata.json\n")

        # Process each folder
        total_uploaded = 0
        total_skipped = 0
        total_failed = 0

        with tqdm(metadata_files, desc="Processing", unit="folder") as pbar:
            for metadata_file in pbar:
                try:
                    uploaded, skipped, failed = self._process_folder(metadata_file)

                    total_uploaded += uploaded
                    total_skipped += skipped
                    total_failed += failed

                    # Update display with compact format
                    pbar.set_postfix(up=total_uploaded, skip=total_skipped, fail=total_failed)

                except Exception as e:
                    logger.error(f"Error processing {metadata_file}: {e}")
                    total_failed += 1

        print(f"\n✅ Upload complete!")
        print(f"   Uploaded: {total_uploaded}")
        print(f"   Skipped: {total_skipped} (already in Qdrant)")
        print(f"   Failed: {total_failed} (no embeddings or errors)")


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
