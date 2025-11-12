#!/usr/bin/env python3
"""Test Qdrant connection"""

import os
from pathlib import Path
from dotenv import load_dotenv
from qdrant_client import QdrantClient

# Load environment variables
load_dotenv(Path(__file__).parent.parent / '.env')

QDRANT_URL = os.getenv('QDRANT_URL')
QDRANT_API_KEY = os.getenv('QDRANT_API_KEY')

print(f"Testing connection to: {QDRANT_URL}")
print(f"API Key: {QDRANT_API_KEY[:10]}..." if QDRANT_API_KEY else "No API key")

try:
    print("\n1. Creating Qdrant client...")
    client = QdrantClient(
        url=QDRANT_URL,
        api_key=QDRANT_API_KEY,
        timeout=30,
    )
    print("   ✓ Client created")

    print("\n2. Getting collections...")
    collections = client.get_collections()
    print(f"   ✓ Success! Collections: {collections}")

except Exception as e:
    print(f"   ✗ Error: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
