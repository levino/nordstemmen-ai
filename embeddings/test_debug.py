#!/usr/bin/env python3
"""Debug Qdrant client requests"""

import os
from pathlib import Path
from dotenv import load_dotenv
from qdrant_client import QdrantClient
import logging

# Enable debug logging
logging.basicConfig(level=logging.DEBUG)

# Load environment variables
load_dotenv(Path(__file__).parent.parent / '.env')

QDRANT_URL = os.getenv('QDRANT_URL')
QDRANT_API_KEY = os.getenv('QDRANT_API_KEY')

print(f"Testing connection to: {QDRANT_URL}")
print(f"Creating client...")

try:
    client = QdrantClient(
        url=QDRANT_URL,
        api_key=QDRANT_API_KEY,
        timeout=10,  # Shorter timeout for faster feedback
        prefer_grpc=False,
    )
    print("Client created")

    # Try to inspect the client
    print(f"\nClient type: {type(client._client)}")
    print(f"Client attributes: {dir(client._client)}")

    if hasattr(client._client, 'http'):
        print(f"\nHTTP client: {client._client.http}")
        if hasattr(client._client.http, 'client_impl'):
            print(f"HTTP impl: {client._client.http.client_impl}")

    print("\nAttempting to get collections...")
    collections = client.get_collections()
    print(f"✓ Success! Collections: {collections}")

except Exception as e:
    print(f"✗ Error: {type(e).__name__}: {e}")
