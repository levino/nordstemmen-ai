// ============================================================================
// PDF Proxy Worker
// ============================================================================
// Routes: /pdf/{sha256}
// Purpose: Simple proxy to download PDFs from Backblaze B2 bucket
// ============================================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

// Backblaze B2 API endpoints
const B2_API_BASE_URL = 'https://api.backblazeb2.com';

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
 * Authenticate with Backblaze B2 and get auth token
 */
async function authenticateB2(env) {
  const authResponse = await fetch(`${B2_API_BASE_URL}/b2api/v3/b2_authorize_account`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${btoa(`${env.B2_KEY_ID}:${env.B2_APP_KEY}`)}`,
    },
  });

  if (!authResponse.ok) {
    throw new Error(`B2 auth failed: ${authResponse.status}`);
  }

  const authData = await authResponse.json();
  console.log('B2 auth response:', authData);
  return {
    authorizationToken: authData.authorizationToken,
    apiUrl: authData.apiUrl,
    downloadUrl: authData.downloadUrl,
  };
}

/**
 * Get download authorization for a file
 */
async function getDownloadAuth(env, authData, fileName) {
  const response = await fetch(`${authData.apiUrl}/b2api/v3/b2_get_download_authorization`, {
    method: 'POST',
    headers: {
      Authorization: authData.authorizationToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      bucketId: env.B2_BUCKET_ID,
      fileNamePrefix: fileName,
      validDurationInSeconds: 3600, // 1 hour
    }),
  });

  if (!response.ok) {
    throw new Error(`B2 download auth failed: ${response.status}`);
  }

  const authInfo = await response.json();
  return authInfo.authorizationToken;
}

/**
 * Get filename for a given SHA256 hash
 */
function getFileNameForHash(sha256) {
  // Ensure sha256 is a string
  const hashStr = String(sha256);
  // Git LFS stores files as: lfs/objects/{first2chars}/{remaining62chars}
  const first2 = hashStr.substring(0, 2);
  const remaining = hashStr.substring(2);
  return `lfs/objects/${first2}/${remaining}`;
}

/**
 * Handle GET requests - Simple proxy to download PDF from Backblaze B2
 * URL: /pdf/{sha256}?filename=DS_25_2005.pdf
 */
export async function onRequestGet(context) {
  const { request, params, env } = context;

  try {
    // Debug: Log the actual params to understand the issue
    console.log('Debug params:', typeof params.sha256, params.sha256, params);
    
    const sha256 = String(params.sha256 || '');
    
    // Get filename from query parameter
    const url = new URL(request.url);
    const originalFilename = url.searchParams.get('filename');

    // Validate SHA256 format (64 hex chars)
    if (!sha256 || !/^[a-f0-9]{64}$/i.test(sha256)) {
      return new Response('Invalid SHA256 hash', {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    // Check required environment variables
    if (!env.B2_KEY_ID || !env.B2_APP_KEY || !env.B2_BUCKET_NAME || !env.B2_BUCKET_ID) {
      console.log('Missing B2 env vars:', {
        B2_KEY_ID: !!env.B2_KEY_ID,
        B2_APP_KEY: !!env.B2_APP_KEY, 
        B2_BUCKET_NAME: !!env.B2_BUCKET_NAME,
        B2_BUCKET_ID: !!env.B2_BUCKET_ID
      });
      return new Response('Missing B2 configuration', {
        status: 500,
        headers: CORS_HEADERS,
      });
    }

    // Authenticate with B2 and download file
    const authData = await authenticateB2(env);
    const fileName = getFileNameForHash(sha256);
    const downloadAuth = await getDownloadAuth(env, authData, fileName);
    const downloadUrl = `${authData.downloadUrl}/file/${env.B2_BUCKET_NAME}/${fileName}`;

    const b2Response = await fetch(downloadUrl, {
      headers: {
        Authorization: downloadAuth,
      },
    });

    if (!b2Response.ok) {
      return new Response(`PDF not found: ${sha256}`, {
        status: b2Response.status,
        headers: CORS_HEADERS,
      });
    }

    // Use original filename if provided, otherwise fallback to hash
    const downloadFilename = originalFilename || `${sha256}.pdf`;

    // Return the PDF with proper headers
    return new Response(b2Response.body, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${downloadFilename}"`,
      },
    });
  } catch (error) {
    return new Response(`Error: ${error.message}`, {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}
