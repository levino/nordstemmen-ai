#!/usr/bin/env python3
"""Test httpx connection directly"""

import httpx
import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv(Path(__file__).parent.parent / '.env')

QDRANT_URL = os.getenv('QDRANT_URL')
QDRANT_API_KEY = os.getenv('QDRANT_API_KEY')

print(f"Testing httpx connection to: {QDRANT_URL}")
print(f"API Key: {QDRANT_API_KEY[:10]}..." if QDRANT_API_KEY else "No API key")

# Test 1: Simple GET request
print("\n1. Testing simple GET to /")
try:
    response = httpx.get(QDRANT_URL, timeout=30.0)
    print(f"   ✓ Status: {response.status_code}")
    print(f"   ✓ Response: {response.text[:100]}")
except Exception as e:
    print(f"   ✗ Error: {type(e).__name__}: {e}")

# Test 2: GET with API key header
print("\n2. Testing GET to /collections with API key")
try:
    response = httpx.get(
        f"{QDRANT_URL}/collections",
        headers={"api-key": QDRANT_API_KEY},
        timeout=30.0
    )
    print(f"   ✓ Status: {response.status_code}")
    print(f"   ✓ Response: {response.text}")
except Exception as e:
    print(f"   ✗ Error: {type(e).__name__}: {e}")

# Test 3: Using httpx.Client (persistent connection)
print("\n3. Testing with httpx.Client")
try:
    with httpx.Client(timeout=30.0) as client:
        response = client.get(
            f"{QDRANT_URL}/collections",
            headers={"api-key": QDRANT_API_KEY}
        )
        print(f"   ✓ Status: {response.status_code}")
        print(f"   ✓ Response: {response.text}")
except Exception as e:
    print(f"   ✗ Error: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
