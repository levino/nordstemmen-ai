#!/usr/bin/env python3
"""Test querying the Qdrant collection"""

import os
from pathlib import Path
from dotenv import load_dotenv
from qdrant_client import QdrantClient

# Load environment variables
load_dotenv(Path(__file__).parent.parent / '.env')

QDRANT_URL = os.getenv('QDRANT_URL')
QDRANT_API_KEY = os.getenv('QDRANT_API_KEY')
QDRANT_COLLECTION = os.getenv('QDRANT_COLLECTION')

print(f"Connecting to: {QDRANT_URL}")
print(f"Collection: {QDRANT_COLLECTION}\n")

client = QdrantClient(
    url=QDRANT_URL,
    api_key=QDRANT_API_KEY,
    timeout=30,
)

# Get collection info
info = client.get_collection(QDRANT_COLLECTION)
print(f"Collection info:")
print(f"  Points count: {info.points_count}")
print(f"  Vector size: {info.config.params.vectors.size}")
print(f"  Distance: {info.config.params.vectors.distance}\n")

# Get a few sample points
points = client.scroll(
    collection_name=QDRANT_COLLECTION,
    limit=3,
    with_payload=True,
    with_vectors=False,
)

print(f"Sample points:")
for point in points[0]:
    payload = point.payload
    print(f"\n  ID: {point.id}")
    print(f"  File: {payload.get('filename')}")
    print(f"  Page: {payload.get('page')}, Chunk: {payload.get('chunk_index')}")
    print(f"  Text preview: {payload.get('text', '')[:100]}...")
    print(f"  OParl ID: {payload.get('oparl_id')}")
    print(f"  Date: {payload.get('date')}")
