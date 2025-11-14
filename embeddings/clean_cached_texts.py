#!/usr/bin/env python3
"""
Clean Text in Cached Embeddings

Goes through all embeddings.json files and cleans the text fields
using the same _clean_text() logic from generate.py.
This fixes texts that were extracted with spacing issues.
"""

import json
import re
from pathlib import Path
from tqdm import tqdm

DOCUMENTS_DIR = Path(__file__).parent.parent / 'documents'


def clean_text(text: str) -> str:
    """Clean up poorly extracted text (e.g., spaced letters, excessive whitespace)."""
    # Fix single-letter spacing (e.g., "B r a n d s c h u tz" -> "Brandschutz")
    text = re.sub(r'\b([a-zA-ZäöüÄÖÜß])\s+(?=[a-zA-ZäöüÄÖÜß]\s|[a-zA-ZäöüÄÖÜß]\b)', r'\1', text)

    # Replace multiple spaces with single space
    text = re.sub(r'\s+', ' ', text)

    # Replace multiple newlines with max 2
    text = re.sub(r'\n{3,}', '\n\n', text)

    return text.strip()


def clean_embeddings_file(filepath: Path) -> bool:
    """Clean text in a single embeddings.json file. Returns True if cleaned."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # Check if there are chunks to clean
        chunks = data.get('chunks', [])
        if not chunks:
            return False

        # Clean text in all chunks
        changed = False
        for chunk in chunks:
            if 'text' in chunk:
                original = chunk['text']
                cleaned = clean_text(original)
                if cleaned != original:
                    chunk['text'] = cleaned
                    changed = True

        # Save if changed
        if changed:
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return True

        return False

    except Exception as e:
        print(f"Error cleaning {filepath}: {e}")
        return False


def main():
    """Clean all embeddings.json files in documents directory."""
    print("🧹 Cleaning cached embedding texts...")

    # Find all embeddings.json files
    embeddings_files = list(DOCUMENTS_DIR.rglob('embeddings.json'))

    if not embeddings_files:
        print("⚠ No embeddings.json files found")
        return

    print(f"📁 Found {len(embeddings_files)} embeddings.json files\n")

    # Process each file
    cleaned_count = 0
    skipped_count = 0

    with tqdm(embeddings_files, desc="Cleaning", unit="file") as pbar:
        for filepath in pbar:
            if clean_embeddings_file(filepath):
                cleaned_count += 1
            else:
                skipped_count += 1

            pbar.set_postfix_str(f"Cleaned: {cleaned_count} | Unchanged: {skipped_count}")

    print(f"\n✅ Cleaning complete!")
    print(f"   Cleaned: {cleaned_count}")
    print(f"   Unchanged: {skipped_count}")
    print(f"\n💡 Next step: Run with UPDATE_QDRANT_METADATA=true to update Qdrant")


if __name__ == '__main__':
    main()
