/**
 * Nordstemmen MCP Server - Cloudflare Worker
 *
 * MCP (Model Context Protocol) server providing semantic search over
 * Nordstemmen municipal documents stored in Qdrant.
 */

import { QdrantClient } from '@qdrant/js-client-rest';

interface Env {
  QDRANT_URL: string;
  QDRANT_API_KEY: string;
  QDRANT_COLLECTION: string;
  HUGGINGFACE_API_KEY?: string; // Optional: for better rate limits
}

interface SearchDocumentsArgs {
  query: string;
  limit?: number;
}

interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

async function generateEmbedding(env: Env, text: string): Promise<number[]> {
  // Use HuggingFace Inference API
  // Model: sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 (384 dimensions)
  // Same model as used in Qdrant collection
  const HF_API_URL = 'https://api-inference.huggingface.co/models/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Optional: Use API key for better rate limits
  if (env.HUGGINGFACE_API_KEY) {
    headers['Authorization'] = `Bearer ${env.HUGGINGFACE_API_KEY}`;
  }

  const response = await fetch(HF_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      inputs: text,
      options: { wait_for_model: true }
    }),
  });

  if (!response.ok) {
    throw new Error(`HuggingFace API error: ${response.status} ${response.statusText}`);
  }

  const embedding = await response.json() as number[];
  return embedding;
}

async function searchDocuments(
  env: Env,
  args: SearchDocumentsArgs
): Promise<string> {
  const { query, limit = 5 } = args;

  try {
    // Initialize Qdrant client
    const client = new QdrantClient({
      url: env.QDRANT_URL,
      apiKey: env.QDRANT_API_KEY,
    });

    // Generate embedding for query
    const queryEmbedding = await generateEmbedding(env, query);

    // Search in Qdrant
    const results = await client.search(env.QDRANT_COLLECTION, {
      vector: queryEmbedding,
      limit: Math.min(limit, 10),
      with_payload: true,
    });

    if (!results || results.length === 0) {
      return 'Keine relevanten Dokumente gefunden.';
    }

    // Format results
    const formattedResults = results
      .map((result: any, index: number) => {
        const payload = result.payload as any;
        const filename = payload.filename || 'Unbekannt';
        const page = payload.page || '?';
        const text = payload.text || '';
        const score = result.score || 0;
        const accessUrl = payload.access_url || '';

        let header = `[Ergebnis ${index + 1}] ${filename} (Seite ${page}, Relevanz: ${score.toFixed(3)})`;
        if (accessUrl) {
          header += `\nURL: ${accessUrl}`;
        }

        return `${header}:\n${text}`;
      })
      .join('\n\n---\n\n');

    return formattedResults;
  } catch (error) {
    console.error('Search error:', error);
    throw new Error(`Fehler bei der Suche: ${(error as Error).message}`);
  }
}

function createMCPResponse(id: string | number, result: any): MCPResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

function createMCPError(
  id: string | number,
  code: number,
  message: string
): MCPResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  };
}

async function handleMCPRequest(
  request: MCPRequest,
  env: Env
): Promise<MCPResponse> {
  const { method, params, id } = request;

  try {
    switch (method) {
      case 'initialize':
        return createMCPResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'nordstemmen-mcp-server',
            version: '1.0.0',
          },
        });

      case 'tools/list':
        return createMCPResponse(id, {
          tools: [
            {
              name: 'search_documents',
              description:
                'Durchsucht die Dokumenten-Datenbank der Gemeinde Nordstemmen nach relevanten Informationen. ' +
                'Verwende verschiedene Suchbegriffe und Formulierungen, um alle relevanten Dokumente zu finden. ' +
                'Du kannst diese Funktion mehrmals mit unterschiedlichen Suchbegriffen aufrufen.',
              inputSchema: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description:
                      'Der Suchbegriff oder die Suchanfrage. Sei spezifisch und verwende relevante Keywords.',
                  },
                  limit: {
                    type: 'number',
                    description:
                      'Anzahl der Ergebnisse (Standard: 5, Maximum: 10)',
                    default: 5,
                  },
                },
                required: ['query'],
              },
            },
          ],
        });

      case 'tools/call':
        const { name, arguments: args } = params;

        if (name === 'search_documents') {
          const result = await searchDocuments(env, args);
          return createMCPResponse(id, {
            content: [
              {
                type: 'text',
                text: result,
              },
            ],
          });
        }

        return createMCPError(id, -32601, `Unknown tool: ${name}`);

      case 'ping':
        return createMCPResponse(id, {});

      default:
        return createMCPError(id, -32601, `Method not found: ${method}`);
    }
  } catch (error) {
    console.error('MCP request error:', error);
    return createMCPError(
      id,
      -32603,
      `Internal error: ${(error as Error).message}`
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check / info endpoint
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(
        JSON.stringify({
          name: 'nordstemmen-mcp-server',
          version: '1.0.0',
          protocol: 'mcp/2024-11-05',
          description: 'MCP Server for Nordstemmen documents via Qdrant',
          endpoints: {
            mcp: 'POST /mcp (JSON-RPC 2.0)',
            sse: 'GET /sse (Server-Sent Events - coming soon)',
          },
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    // MCP JSON-RPC endpoint
    if (request.method === 'POST' && url.pathname === '/mcp') {
      try {
        const mcpRequest: MCPRequest = await request.json();
        const mcpResponse = await handleMCPRequest(mcpRequest, env);

        return new Response(JSON.stringify(mcpResponse), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        });
      } catch (error) {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32700,
              message: 'Parse error',
            },
          }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          }
        );
      }
    }

    // SSE endpoint for streaming MCP
    if (request.method === 'GET' && url.pathname === '/sse') {
      // TODO: Implement SSE transport
      return new Response('SSE endpoint - coming soon', {
        status: 501,
        headers: corsHeaders,
      });
    }

    return new Response('Not found', {
      status: 404,
      headers: corsHeaders,
    });
  },
};
