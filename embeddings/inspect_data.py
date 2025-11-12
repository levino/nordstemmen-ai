#!/usr/bin/env python3
"""Inspect what's actually stored in Qdrant"""

import os
from pathlib import Path
from dotenv import load_dotenv
from qdrant_client import QdrantClient

load_dotenv(Path(__file__).parent.parent / '.env')

client = QdrantClient(
    url=os.getenv('QDRANT_URL'),
    api_key=os.getenv('QDRANT_API_KEY'),
    timeout=30,
    port=int(os.getenv('QDRANT_PORT', 443))
)

# Get a few sample points
points = client.scroll(
    collection_name=os.getenv('QDRANT_COLLECTION'),
    limit=5,
    with_payload=True,
    with_vectors=False,
)

print(f"Found {len(points[0])} points\n")

for i, point in enumerate(points[0]):
    payload = point.payload
    text = payload.get('text', '')
    print(f"=== Point {i+1} ===")
    print(f"File: {payload.get('filename')}")
    print(f"Page: {payload.get('page')}, Chunk: {payload.get('chunk_index')}")
    print(f"Text length: {len(text)} chars")
    print(f"Text: {text[:200]}...")
    print()
