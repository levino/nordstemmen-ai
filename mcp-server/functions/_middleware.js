// Middleware for routing GET /mcp to Inspector container
// POST /mcp continues to functions/mcp.js

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  // Only intercept GET /mcp (and /mcp/*)
  if (url.pathname.startsWith('/mcp') && request.method === 'GET') {
    // Proxy to Inspector container
    // Configure this URL in Cloudflare Pages environment variables:
    // INSPECTOR_URL = https://inspector.nordstemmen-mcp.levinkeller.de
    const inspectorUrl = env.INSPECTOR_URL || 'https://inspector.nordstemmen-mcp.levinkeller.de';

    // Build target URL: keep the path and query string
    const targetUrl = new URL(url.pathname + url.search, inspectorUrl);

    try {
      // Forward the request to the Inspector container
      const response = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: request.headers,
        // Don't forward body for GET requests
      });

      // Return the response from the Inspector
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      console.error('Inspector proxy error:', error);

      // Fallback: return error page
      return new Response(
        `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Inspector Unavailable</title>
  <link href="https://cdn.jsdelivr.net/npm/daisyui@4.12.14/dist/full.min.css" rel="stylesheet" />
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-base-200">
  <div class="hero min-h-screen">
    <div class="hero-content text-center">
      <div class="max-w-md">
        <h1 class="text-5xl font-bold">⚠️ Inspector Unavailable</h1>
        <p class="py-6">
          The MCP Inspector is currently unavailable. Please try again later.
        </p>
        <div class="alert alert-error">
          <span>Error: ${error.message}</span>
        </div>
        <a href="/" class="btn btn-primary mt-4">← Back to Homepage</a>
      </div>
    </div>
  </div>
</body>
</html>`,
        {
          status: 503,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
          },
        },
      );
    }
  }

  // For all other requests (including POST /mcp), continue to next handler
  return next();
}
