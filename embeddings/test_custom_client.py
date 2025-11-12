#!/usr/bin/env python3
"""Test Qdrant with custom httpx client"""

import httpx
import os
from pathlib import Path
from dotenv import load_dotenv
from qdrant_client import QdrantClient

# Load environment variables
load_dotenv(Path(__file__).parent.parent / '.env')

QDRANT_URL = os.getenv('QDRANT_URL')
QDRANT_API_KEY = os.getenv('QDRANT_API_KEY')

print(f"Testing connection to: {QDRANT_URL}")

# Test 1: Try with prefer_grpc=False to force HTTP
print("\n1. Testing with prefer_grpc=False")
try:
    client = QdrantClient(
        url=QDRANT_URL,
        api_key=QDRANT_API_KEY,
        timeout=30,
        prefer_grpc=False,  # Force HTTP instead of gRPC
    )
    print("   ✓ Client created")

    collections = client.get_collections()
    print(f"   ✓ Collections: {collections}")
except Exception as e:
    print(f"   ✗ Error: {type(e).__name__}: {e}")

# Test 2: Try with http11 transport
print("\n2. Testing with HTTP/1.1 transport")
try:
    # Create custom httpx client with HTTP/1.1
    http_client = httpx.Client(
        timeout=30.0,
        http2=False,  # Disable HTTP/2
    )

    client = QdrantClient(
        url=QDRANT_URL,
        api_key=QDRANT_API_KEY,
        timeout=30,
        prefer_grpc=False,
        # Note: qdrant_client doesn't support passing custom http client in constructor
    )
    print("   ✓ Client created")

    collections = client.get_collections()
    print(f"   ✓ Collections: {collections}")
except Exception as e:
    print(f"   ✗ Error: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
