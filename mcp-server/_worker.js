import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { QdrantClient } from '@qdrant/js-client-rest';

const app = new Hono();

// CORS middleware
app.use('/*', cors());

// ============================================================================
// Embedding Service
// ============================================================================

async function generateEmbedding(env, text) {
  return fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.JINA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'jina-embeddings-v3',
      input: [text],
      task: 'retrieval.query',
    }),
  })
    .then(response => {
      if (!response.ok) {
        return response.text().then(errorBody => {
          throw new Error(`Jina API error: ${response.status} ${response.statusText} - ${errorBody}`);
        });
      }
      return response.json();
    })
    .then(data => {
      if (data.data && data.data[0] && data.data[0].embedding) {
        return data.data[0].embedding;
      }
      throw new Error(`Unexpected Jina API response format: ${JSON.stringify(data)}`);
    });
}

// ============================================================================
// MCP Tools
// ============================================================================

async function searchDocuments(env, args) {
  const { query, limit = 5 } = args;

  try {
    const client = new QdrantClient({
      url: env.QDRANT_URL,
      apiKey: env.QDRANT_API_KEY,
      port: env.QDRANT_PORT ? parseInt(env.QDRANT_PORT) : undefined,
    });

    return generateEmbedding(env, query)
      .then(queryEmbedding => {
        return client.search(env.QDRANT_COLLECTION, {
          vector: queryEmbedding,
          limit: Math.min(limit, 10),
          with_payload: true
        });
      })
      .then(results => {
        if (!results || results.length === 0) {
          return 'No relevant documents found.';
        }

        return results.map((result, index) => {
          const payload = result.payload;
          const filename = payload.filename || 'Unknown';
          const page = payload.page || '?';
          const score = result.score?.toFixed(3) || '?';

          return `${index + 1}. [Score: ${score}] ${filename} (Page ${page})\n${payload.text || ''}`;
        }).join('\n\n');
      });
  } catch (error) {
    throw new Error(`Search error: ${error.message}`);
  }
}

// ============================================================================
// Error Handling
// ============================================================================

function sanitizeError(error, env) {
  // In production, hide sensitive details
  const isProduction = env.ENVIRONMENT === 'production' || !env.ENVIRONMENT;

  if (!isProduction) {
    // Development: return full error
    return error.message;
  }

  // Production: sanitize errors
  const message = error.message.toLowerCase();

  // Map specific errors to user-friendly messages
  if (message.includes('api') || message.includes('jina') || message.includes('huggingface')) {
    return 'Service temporarily unavailable';
  }
  if (message.includes('auth') || message.includes('401') || message.includes('403')) {
    return 'Authentication failed';
  }
  if (message.includes('not found') || message.includes('404')) {
    return 'Resource not found';
  }
  if (message.includes('timeout')) {
    return 'Request timeout';
  }

  // Default generic message
  return 'Operation failed';
}

// ============================================================================
// MCP Protocol Handler
// ============================================================================

async function handleMCPRequest(request, env) {
  const { method, params, id } = request;

  try {
    let result;

    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          serverInfo: {
            name: 'nordstemmen-mcp-server',
            version: '1.0.0'
          },
          capabilities: {
            tools: {}
          }
        };
        break;

      case 'tools/list':
        result = {
          tools: [
            {
              name: 'search_documents',
              description: 'Semantically searches the Nordstemmen document collection',
              inputSchema: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description: 'Search query'
                  },
                  limit: {
                    type: 'number',
                    description: 'Maximum number of results (Default: 5, Max: 10)',
                    default: 5
                  }
                },
                required: ['query']
              }
            }
          ]
        };
        break;

      case 'tools/call':
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};

        if (toolName === 'search_documents') {
          result = await searchDocuments(env, toolArgs)
            .then(searchResult => ({
              content: [
                {
                  type: 'text',
                  text: searchResult
                }
              ]
            }));
        } else {
          throw new Error(`Unknown tool: ${toolName}`);
        }
        break;

      default:
        throw new Error(`Method not found: ${method}`);
    }

    return {
      jsonrpc: '2.0',
      id,
      result
    };
  } catch (error) {
    // Log full error for debugging
    console.error('MCP Request error:', error.message);

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: sanitizeError(error, env)
      }
    };
  }
}

// ============================================================================
// Routes
// ============================================================================

// GET / - Server info
app.get('/', (c) => {
  return c.json({
    name: 'nordstemmen-mcp-server',
    version: '1.0.0',
    protocol: 'mcp/2024-11-05',
    description: 'MCP Server for Nordstemmen documents via Qdrant'
  });
});

// POST /mcp - MCP endpoint
app.post('/mcp', async (c) => {
  try {
    return c.req.json().then(mcpRequest => {
      const env = c.env;

      // Handle batch requests (array of JSON-RPC messages)
      if (Array.isArray(mcpRequest)) {
        return Promise.all(
          mcpRequest.map(req => handleMCPRequest(req, env))
        ).then(responses => c.json(responses));
      }

      // Handle single request
      return handleMCPRequest(mcpRequest, env)
        .then(mcpResponse => c.json(mcpResponse));
    });
  } catch (error) {
    return c.json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: 'Parse error'
      }
    }, 400);
  }
});

// ============================================================================
// Export
// ============================================================================

export default app;
