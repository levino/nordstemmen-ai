#!/usr/bin/env python3
"""
B2 Upload Script for Nordstemmen Transparent

Uploads PDFs and fulltext files to Backblaze B2.
- PDFs are stored as {sha256_hash} (same convention as mcp-server/functions/pdf/[[sha256]].js)
- Fulltext is stored as {sha256_hash}.txt

Env vars: B2_KEY_ID, B2_APP_KEY, B2_BUCKET_ID, B2_BUCKET_NAME
"""

import os
import sys
import json
import hashlib
import logging
from pathlib import Path

import requests

logging.basicConfig(level=logging.INFO, format='%(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Add parent to path so we can import from embeddings
sys.path.insert(0, str(Path(__file__).parent.parent / 'embeddings'))
from generate_embeddings import _is_lfs_pointer

DOCUMENTS_DIR = Path(__file__).parent.parent / 'documents'
B2_API_BASE = 'https://api.backblazeb2.com'


def b2_authorize():
    """Authenticate with Backblaze B2 and return auth data."""
    key_id = os.environ['B2_KEY_ID']
    app_key = os.environ['B2_APP_KEY']

    resp = requests.get(
        f'{B2_API_BASE}/b2api/v3/b2_authorize_account',
        auth=(key_id, app_key),
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    return {
        'auth_token': data['authorizationToken'],
        'api_url': data['apiInfo']['storageApi']['apiUrl'],
        'download_url': data['apiInfo']['storageApi']['downloadUrl'],
    }


def b2_get_upload_url(auth, bucket_id):
    """Get an upload URL from B2."""
    resp = requests.post(
        f"{auth['api_url']}/b2api/v3/b2_get_upload_url",
        headers={'Authorization': auth['auth_token']},
        json={'bucketId': bucket_id},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    return {
        'upload_url': data['uploadUrl'],
        'upload_token': data['authorizationToken'],
    }


def b2_file_exists(auth, bucket_name, file_name):
    """Check if a file already exists in B2."""
    resp = requests.get(
        f"{auth['download_url']}/file/{bucket_name}/{file_name}",
        headers={'Authorization': auth['auth_token']},
        timeout=30,
        stream=True,  # Don't download the body
    )
    # Close without reading body
    resp.close()
    return resp.status_code == 200


def b2_upload_file(upload_info, file_name, data, content_type='application/octet-stream'):
    """Upload a file to B2."""
    sha1 = hashlib.sha1(data).hexdigest()

    resp = requests.post(
        upload_info['upload_url'],
        headers={
            'Authorization': upload_info['upload_token'],
            'X-Bz-File-Name': file_name,
            'Content-Type': content_type,
            'Content-Length': str(len(data)),
            'X-Bz-Content-Sha1': sha1,
        },
        data=data,
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def compute_sha256(filepath):
    """Compute SHA256 hash of a file."""
    sha256 = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            sha256.update(chunk)
    return sha256.hexdigest()


def main():
    bucket_id = os.environ['B2_BUCKET_ID']
    bucket_name = os.environ['B2_BUCKET_NAME']

    print("🔐 Authenticating with Backblaze B2...")
    auth = b2_authorize()
    print("✓ Authenticated\n")

    # Find all real (non-LFS-pointer) PDFs
    pdf_files = [p for p in sorted(DOCUMENTS_DIR.rglob('*.pdf')) if not _is_lfs_pointer(p)]
    print(f"📁 Found {len(pdf_files)} PDF files to check\n")

    uploaded_pdfs = 0
    skipped_pdfs = 0
    uploaded_texts = 0
    skipped_texts = 0

    for pdf_file in pdf_files:
        file_hash = compute_sha256(pdf_file)

        # Upload PDF as {hash}
        if b2_file_exists(auth, bucket_name, file_hash):
            skipped_pdfs += 1
        else:
            print(f"  📤 Uploading PDF: {pdf_file.name} ({file_hash[:12]}...)")
            upload_info = b2_get_upload_url(auth, bucket_id)
            with open(pdf_file, 'rb') as f:
                pdf_data = f.read()
            b2_upload_file(upload_info, file_hash, pdf_data, 'application/pdf')
            uploaded_pdfs += 1

        # Upload fulltext as {hash}.txt
        fulltext_file = pdf_file.parent / (pdf_file.stem + '.fulltext.json')
        if fulltext_file.exists():
            text_name = f"{file_hash}.txt"

            if b2_file_exists(auth, bucket_name, text_name):
                skipped_texts += 1
            else:
                try:
                    with open(fulltext_file, 'r', encoding='utf-8') as f:
                        fulltext_data = json.load(f)
                    full_text = fulltext_data.get('full_text', '')
                    if full_text:
                        print(f"  📤 Uploading text: {text_name[:12]}...")
                        upload_info = b2_get_upload_url(auth, bucket_id)
                        b2_upload_file(upload_info, text_name, full_text.encode('utf-8'), 'text/plain; charset=utf-8')
                        uploaded_texts += 1
                except Exception as e:
                    logger.warning(f"Error uploading fulltext for {pdf_file.name}: {e}")

    print(f"\n✅ B2 upload complete!")
    print(f"   PDFs:     {uploaded_pdfs} uploaded, {skipped_pdfs} already exist")
    print(f"   Fulltext: {uploaded_texts} uploaded, {skipped_texts} already exist")


if __name__ == '__main__':
    main()
