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
          return {
            text: 'No relevant documents found.',
            structured: []
          };
        }

        // Build both text and structured versions
        const textResults = results.map((result, index) => {
          const payload = result.payload;
          const title = payload.name || payload.filename || 'Unknown';
          const url = payload.access_url || '';
          const date = payload.date || '';
          const score = result.score?.toFixed(3) || '?';

          // Markdown with clickable link
          const titleLink = url ? `[${title}](${url})` : title;
          const metadata = [date, `Score: ${score}`].filter(Boolean).join(' • ');

          return `${index + 1}. ${titleLink}\n${metadata}\n\n${payload.text || ''}`;
        }).join('\n\n---\n\n');

        const structuredResults = results.map((result, index) => {
          const payload = result.payload;
          return {
            rank: index + 1,
            title: payload.name || payload.filename || 'Unknown',
            url: payload.access_url || null,
            date: payload.date || null,
            page: payload.page || null,
            score: result.score || 0,
            excerpt: payload.text || '',
            filename: payload.filename || null
          };
        });

        return {
          text: textResults,
          structured: structuredResults
        };
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
              description: `Durchsucht semantisch die komplette Dokumentensammlung des Ratsinformationssystems der Gemeinde Nordstemmen.

Die Datenbank enthält öffentliche Dokumente wie:
- Sitzungsprotokolle und Niederschriften von Gemeinderat, Ortsräten und Fachausschüssen
- Beschlussvorlagen und gefasste Beschlüsse
- Bekanntmachungen und öffentliche Ausschreibungen
- Haushaltspläne und Finanzberichte
- Bebauungspläne und Planungsunterlagen
- Verwaltungsvorlagen und Anträge

Zeitraum: Dokumente ab 2007 bis heute

Die semantische Suche findet relevante Informationen auch wenn die exakten Suchbegriffe nicht im Text vorkommen.
Ideal für Fragen zu kommunalen Themen wie Bauprojekte, Haushalt, Beschlüsse, Verkehr, Bildung, Soziales, etc.

Jedes Ergebnis enthält einen direkten Link zum Originaldokument im Ratsinformationssystem.`,
              inputSchema: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description: 'Die Suchanfrage in natürlicher Sprache. Kann eine Frage sein ("Was kostet das neue Schwimmbad?") oder Stichwörter ("Haushalt 2023", "Baugebiet Escherder Straße"). Die semantische Suche versteht den Kontext und findet relevante Dokumente auch bei unterschiedlichen Formulierungen.'
                  },
                  limit: {
                    type: 'number',
                    description: 'Maximale Anzahl der zurückgegebenen Suchergebnisse. Standard ist 5, Maximum ist 10. Bei spezifischen Fragen reichen oft 3-5 Ergebnisse, bei breiten Themen können 10 Ergebnisse sinnvoll sein.',
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
                  text: searchResult.text
                }
              ],
              structuredContent: {
                results: searchResult.structured
              }
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
