#!/usr/bin/env python3
"""
Migration script to rename embeddings.json to <pdf-name>.embeddings.json format.

This preserves existing embeddings without regenerating them.
"""

import json
from pathlib import Path

DOCUMENTS_DIR = Path(__file__).parent.parent / 'documents'


def migrate_embeddings():
    """Migrate old embeddings.json files to new naming format."""

    # Find all old-style embeddings.json files
    old_files = list(DOCUMENTS_DIR.rglob('embeddings.json'))

    if not old_files:
        print("✓ No old embeddings.json files found - nothing to migrate")
        return

    print(f"📁 Found {len(old_files)} embeddings.json files to migrate\n")

    migrated = 0
    skipped = 0
    errors = 0

    for old_file in old_files:
        try:
            # Read the embeddings file
            with open(old_file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            # Get the PDF filename from the data
            pdf_filename = data.get('filename')
            if not pdf_filename:
                print(f"⚠️  Skipping {old_file} - no filename in data")
                skipped += 1
                continue

            # Create new filename: <pdf-name>.embeddings.json
            pdf_stem = Path(pdf_filename).stem
            new_filename = f"{pdf_stem}.embeddings.json"
            new_file = old_file.parent / new_filename

            # Check if new file already exists
            if new_file.exists():
                print(f"⚠️  Skipping {old_file} - {new_filename} already exists")
                skipped += 1
                continue

            # Rename the file
            old_file.rename(new_file)
            print(f"✓ Migrated: {old_file.parent.name}/{old_file.name} → {new_filename}")
            migrated += 1

        except Exception as e:
            print(f"❌ Error migrating {old_file}: {e}")
            errors += 1

    print(f"\n{'='*70}")
    print(f"Migration complete!")
    print(f"  Migrated: {migrated}")
    print(f"  Skipped: {skipped}")
    print(f"  Errors: {errors}")
    print(f"{'='*70}")


if __name__ == '__main__':
    migrate_embeddings()
