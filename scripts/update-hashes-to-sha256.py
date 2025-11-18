#!/usr/bin/env python3
"""
Update Embedding Hashes from MD5 to SHA256

This script updates all existing embedding files to replace MD5 hashes with SHA256 hashes.
The actual embeddings remain unchanged - only the file_hash field is updated.

Usage: python scripts/update-hashes-to-sha256.py
"""

import json
import hashlib
import os
from pathlib import Path

def compute_sha256(filepath: Path) -> str:
    """Compute SHA256 hash of a file."""
    sha256 = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            sha256.update(chunk)
    return sha256.hexdigest()

def update_embedding_file(embedding_path: Path, pdf_path: Path) -> bool:
    """Update a single embedding file to use SHA256 hash."""
    try:
        # Read existing embedding file
        with open(embedding_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Compute new SHA256 hash
        new_hash = compute_sha256(pdf_path)
        
        # Update the hash
        data['file_hash'] = new_hash
        
        # Write back to file
        with open(embedding_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        
        return True
        
    except Exception:
        return False

def main():
    """Update all embedding files to use SHA256 hashes."""
    documents_dir = Path(__file__).parent.parent / 'documents'
    
    # Find all embedding files
    embedding_files = list(documents_dir.rglob('*.embeddings.json'))
    
    print(f"Processing {len(embedding_files)} embedding files...")
    
    updated_count = 0
    error_count = 0
    
    for embedding_path in embedding_files:
        # Find corresponding PDF file
        pdf_path = embedding_path.with_suffix('.pdf')
        
        if not pdf_path.exists():
            # Try without the .embeddings suffix
            stem = embedding_path.stem
            if stem.endswith('.embeddings'):
                base_name = stem[:-11]  # Remove '.embeddings'
                pdf_path = embedding_path.parent / f"{base_name}.pdf"
        
        if not pdf_path.exists():
            error_count += 1
            continue
        
        if update_embedding_file(embedding_path, pdf_path):
            updated_count += 1
        else:
            error_count += 1
    
    print(f"\n📊 Summary:")
    print(f"   ✅ Updated: {updated_count}")
    print(f"   ❌ Errors:  {error_count}")
    print(f"   📁 Total:   {len(embedding_files)}")

if __name__ == '__main__':
    main()