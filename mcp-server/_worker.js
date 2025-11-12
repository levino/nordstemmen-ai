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
  return fetch(
    'https://router.huggingface.co/hf-inference/models/BAAI/bge-small-en-v1.5',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: text }),
    }
  ).then(response => {
    if (!response.ok) {
      return response.text().then(errorBody => {
        throw new Error(`HuggingFace API error: ${response.status} ${response.statusText} - ${errorBody}`);
      });
    }
    return response.json();
  }).then(data => {
    if (Array.isArray(data)) {
      return data;
    }
    throw new Error(`Unexpected HuggingFace response format: ${JSON.stringify(data)}`);
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

async function testEmbedding(env, args) {
  const { query } = args;

  return generateEmbedding(env, query)
    .then(embedding => JSON.stringify({
      query,
      embedding: embedding.slice(0, 5),
      isArray: Array.isArray(embedding),
      length: embedding.length
    }, null, 2));
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
            },
            {
              name: 'test_embedding',
              description: 'Tests embedding generation',
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'Text for embedding' }
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
        } else if (toolName === 'test_embedding') {
          result = await testEmbedding(env, toolArgs)
            .then(embeddingResult => ({
              content: [
                {
                  type: 'text',
                  text: embeddingResult
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
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: error.message
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
