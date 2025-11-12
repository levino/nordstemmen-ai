#!/usr/bin/env python3
"""Drop the Qdrant collection to start fresh"""

import os
from pathlib import Path
from dotenv import load_dotenv
from qdrant_client import QdrantClient

load_dotenv(Path(__file__).parent.parent / '.env')

QDRANT_URL = os.getenv('QDRANT_URL')
QDRANT_API_KEY = os.getenv('QDRANT_API_KEY')
QDRANT_COLLECTION = os.getenv('QDRANT_COLLECTION', 'nordstemmen')
QDRANT_PORT = int(os.getenv('QDRANT_PORT', 443))

print(f"Connecting to: {QDRANT_URL}:{QDRANT_PORT}")
print(f"Collection to drop: {QDRANT_COLLECTION}\n")

client = QdrantClient(
    url=QDRANT_URL,
    api_key=QDRANT_API_KEY,
    timeout=30,
    port=QDRANT_PORT
)

# Drop collection
try:
    client.delete_collection(collection_name=QDRANT_COLLECTION)
    print(f"✓ Collection '{QDRANT_COLLECTION}' deleted successfully!")
except Exception as e:
    print(f"Error: {e}")
