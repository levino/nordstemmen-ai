// ============================================================================
// PDF Proxy Worker
// ============================================================================
// Routes: /pdf/{sha256}
// Purpose: Proxy PDFs from Backblaze B2 (Git LFS) with edge caching
// ============================================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=31536000, immutable', // 1 year
};

// Git LFS base URL (from .git/config lfs.url)
const GIT_LFS_BASE_URL = 'https://git-lfs.nordstemmen-ai.levinkeller.de';

// ============================================================================
// Handlers
// ============================================================================

/**
 * Handle OPTIONS requests (CORS preflight)
 */
export async function onRequestOptions() {
  return new Response(null, {
    headers: CORS_HEADERS,
  });
}

/**
 * Handle GET requests - Proxy PDF from Git LFS / Backblaze B2
 */
export async function onRequestGet(context) {
  const { request, params } = context;

  try {
    // Extract SHA256 hash from URL path
    const sha256 = params.sha256;

    if (!sha256) {
      return new Response('Missing SHA256 hash', {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    // Validate SHA256 format (64 hex chars)
    if (!/^[a-f0-9]{64}$/i.test(sha256)) {
      return new Response('Invalid SHA256 format', {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    // Check Cloudflare cache first
    const cache = caches.default;
    const cacheKey = new Request(request.url, request);
    let response = await cache.match(cacheKey);

    if (response) {
      // Cache HIT
      return new Response(response.body, {
        headers: {
          ...CORS_HEADERS,
          ...CACHE_HEADERS,
          'Content-Type': 'application/pdf',
          'X-Cache': 'HIT',
        },
      });
    }

    // Cache MISS - Fetch from Git LFS (Backblaze B2)
    const lfsUrl = `${GIT_LFS_BASE_URL}/objects/${sha256}`;

    const lfsResponse = await fetch(lfsUrl, {
      headers: {
        'User-Agent': 'Nordstemmen-PDF-Proxy/1.0',
      },
    });

    if (!lfsResponse.ok) {
      // PDF not found in LFS
      return new Response(`PDF not found: ${sha256}`, {
        status: 404,
        headers: CORS_HEADERS,
      });
    }

    // Stream the PDF
    const pdfResponse = new Response(lfsResponse.body, {
      headers: {
        ...CORS_HEADERS,
        ...CACHE_HEADERS,
        'Content-Type': 'application/pdf',
        'X-Cache': 'MISS',
      },
    });

    // Store in Cloudflare cache
    context.waitUntil(cache.put(cacheKey, pdfResponse.clone()));

    return pdfResponse;
  } catch (error) {
    console.error('PDF Proxy error:', error);
    return new Response(`Internal Server Error: ${error.message}`, {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}
