import { QdrantClient } from '@qdrant/js-client-rest';

// ============================================================================
// CORS Headers
// ============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ============================================================================
// Embedding Service
// ============================================================================

async function generateEmbedding(env, text) {
  return fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.JINA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'jina-embeddings-v3',
      input: [text],
      task: 'retrieval.query',
    }),
  })
    .then((response) => {
      if (!response.ok) {
        return response.text().then((errorBody) => {
          throw new Error(`Jina API error: ${response.status} ${response.statusText} - ${errorBody}`);
        });
      }
      return response.json();
    })
    .then((data) => {
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
      .then((queryEmbedding) => {
        return client.search(env.QDRANT_COLLECTION, {
          vector: queryEmbedding,
          limit: Math.min(limit, 10),
          with_payload: true,
        });
      })
      .then((results) => {
        if (!results || results.length === 0) {
          return {
            text: 'No relevant documents found.',
            structured: [],
          };
        }

        // Build both text and structured versions
        const textResults = results
          .map((result, index) => {
            const payload = result.payload;
            const title = payload.entity_name || payload.filename || 'Unknown';
            const url = payload.entity_id || '';
            const date = payload.date || '';
            const score = result.score?.toFixed(3) || '?';
            const ref = payload.paper_reference ? ` (${payload.paper_reference})` : '';

            // Markdown with clickable link
            const titleLink = url ? `[${title}](${url})` : title;
            const metadata = [date, `Score: ${score}`].filter(Boolean).join(' • ');

            return `${index + 1}. ${titleLink}${ref}\n${metadata}\n\n${payload.text || ''}`;
          })
          .join('\n\n---\n\n');

        const structuredResults = results.map((result, index) => {
          const payload = result.payload;
          return {
            rank: index + 1,
            title: payload.entity_name || payload.filename || 'Unknown',
            url: payload.entity_id || null,
            date: payload.date || null,
            page: payload.page || null,
            score: result.score || 0,
            excerpt: payload.text || '',
            filename: payload.filename || null,
            reference: payload.paper_reference || null,
            entity_type: payload.entity_type || null,
          };
        });

        return {
          text: textResults,
          structured: structuredResults,
        };
      });
  } catch (error) {
    throw new Error(`Search error: ${error.message}`);
  }
}

async function getPaperByReference(env, args) {
  const { reference } = args;

  try {
    const client = new QdrantClient({
      url: env.QDRANT_URL,
      apiKey: env.QDRANT_API_KEY,
      port: env.QDRANT_PORT ? parseInt(env.QDRANT_PORT) : undefined,
    });

    // Normalize reference: remove "DS " prefix if present, convert / or - to standard format
    let normalizedRef = reference.trim();
    normalizedRef = normalizedRef.replace(/^DS\s+/i, '');
    normalizedRef = normalizedRef.replace(/[-\/]/g, '/');

    // Search for exact match
    const scrollResult = await client.scroll(env.QDRANT_COLLECTION, {
      filter: {
        must: [
          {
            key: 'paper_reference',
            match: { value: `DS ${normalizedRef}` },
          },
        ],
      },
      limit: 1,
      with_payload: true,
    });

    if (!scrollResult.points || scrollResult.points.length === 0) {
      return {
        text: `Paper with reference "${reference}" not found.`,
        structured: null,
      };
    }

    const payload = scrollResult.points[0].payload;

    const paperInfo = `# ${payload.entity_name || 'Unknown Paper'}

**Reference:** ${payload.paper_reference || 'N/A'}
**Type:** ${payload.paper_type || 'N/A'}
**Date:** ${payload.date || 'N/A'}
**OParl ID:** ${payload.entity_id || 'N/A'}

[View in Ratsinformationssystem](${payload.entity_id || '#'})`;

    return {
      text: paperInfo,
      structured: {
        reference: payload.paper_reference || null,
        name: payload.entity_name || null,
        paperType: payload.paper_type || null,
        date: payload.date || null,
        oparl_id: payload.entity_id || null,
      },
    };
  } catch (error) {
    throw new Error(`Get paper error: ${error.message}`);
  }
}

async function searchPapers(env, args) {
  const { reference_pattern, name_contains, paper_type, date_from, date_to, limit = 10 } = args;

  try {
    const client = new QdrantClient({
      url: env.QDRANT_URL,
      apiKey: env.QDRANT_API_KEY,
      port: env.QDRANT_PORT ? parseInt(env.QDRANT_PORT) : undefined,
    });

    // Build filter
    const must = [
      {
        key: 'entity_type',
        match: { value: 'paper' },
      },
    ];

    if (paper_type) {
      must.push({
        key: 'paper_type',
        match: { value: paper_type },
      });
    }

    if (reference_pattern) {
      // Pattern matching for reference (e.g., "*/2024" matches all from 2024)
      const pattern = reference_pattern.replace('*', '');
      must.push({
        key: 'paper_reference',
        match: { text: pattern },
      });
    }

    if (name_contains) {
      must.push({
        key: 'entity_name',
        match: { text: name_contains },
      });
    }

    if (date_from || date_to) {
      const range = {};
      if (date_from) range.gte = date_from;
      if (date_to) range.lte = date_to;

      must.push({
        key: 'date',
        range,
      });
    }

    // Scroll through results (no vector search, just filtering)
    const scrollResult = await client.scroll(env.QDRANT_COLLECTION, {
      filter: { must },
      limit: Math.min(limit, 50),
      with_payload: ['entity_name', 'paper_reference', 'paper_type', 'date', 'entity_id'],
    });

    if (!scrollResult.points || scrollResult.points.length === 0) {
      return {
        text: 'No papers found matching the criteria.',
        structured: [],
      };
    }

    // Group by paper_reference to deduplicate (since each chunk has same metadata)
    const papersMap = new Map();
    scrollResult.points.forEach((point) => {
      const p = point.payload;
      if (!papersMap.has(p.paper_reference)) {
        papersMap.set(p.paper_reference, {
          reference: p.paper_reference || null,
          name: p.entity_name || null,
          paperType: p.paper_type || null,
          date: p.date || null,
          oparl_id: p.entity_id || null,
        });
      }
    });

    const papers = Array.from(papersMap.values());

    // Build text output
    const textResults = papers
      .map((paper, index) => {
        const titleLink = paper.oparl_id ? `[${paper.name}](${paper.oparl_id})` : paper.name;
        const metadata = [paper.reference, paper.paperType, paper.date].filter(Boolean).join(' • ');

        return `${index + 1}. ${titleLink}\n${metadata}`;
      })
      .join('\n\n');

    return {
      text: textResults,
      structured: papers,
    };
  } catch (error) {
    throw new Error(`Search papers error: ${error.message}`);
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
            version: '1.0.0',
          },
          capabilities: {
            tools: {},
          },
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

**Über OParl:**
OParl ist ein offener Standard für parlamentarische Informationssysteme (https://oparl.org).
Alle zurückgegebenen IDs sind direkte, klickbare Links zu den Originaldokumenten im OParl-konformen
Ratsinformationssystem der Gemeinde Nordstemmen.

Datenstruktur:
- Paper (Drucksache): Beschlussvorlagen, Anträge, Mitteilungen
- Meeting (Sitzung): Rats- und Ausschusssitzungen
- Files: PDF-Dokumente der Vorlagen und Protokolle`,
              inputSchema: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description:
                      'Die Suchanfrage in natürlicher Sprache. Kann eine Frage sein ("Was kostet das neue Schwimmbad?") oder Stichwörter ("Haushalt 2023", "Baugebiet Escherder Straße"). Die semantische Suche versteht den Kontext und findet relevante Dokumente auch bei unterschiedlichen Formulierungen.',
                  },
                  limit: {
                    type: 'number',
                    description:
                      'Maximale Anzahl der zurückgegebenen Suchergebnisse. Standard ist 5, Maximum ist 10. Bei spezifischen Fragen reichen oft 3-5 Ergebnisse, bei breiten Themen können 10 Ergebnisse sinnvoll sein.',
                    default: 5,
                  },
                },
                required: ['query'],
              },
            },
            {
              name: 'get_paper_by_reference',
              description: `Ruft eine Drucksache direkt anhand ihrer Drucksachennummer ab.

Unterstützte Formate:
- "DS 101/2012"
- "101/2012"
- "101-2012"

Das Tool normalisiert automatisch die verschiedenen Formate und findet die passende Drucksache.

Die Drucksachennummer muss das Jahr enthalten (z.B. "101/2012"). Reine Nummern ohne Jahr (z.B. "101") sind mehrdeutig und werden nicht akzeptiert.

**Über OParl:**
OParl ist ein offener Standard für parlamentarische Informationssysteme (https://oparl.org).
Die zurückgegebene OParl-ID ist ein direkter, klickbarer Link zur Drucksache im Ratsinformationssystem
der Gemeinde Nordstemmen, wo alle Details, Dateien und Beratungsverläufe einsehbar sind.`,
              inputSchema: {
                type: 'object',
                properties: {
                  reference: {
                    type: 'string',
                    description:
                      'Die Drucksachennummer in einem der unterstützten Formate. Beispiele: "DS 101/2012", "101/2012", "101-2012". Muss das Jahr enthalten.',
                  },
                },
                required: ['reference'],
              },
            },
            {
              name: 'search_papers',
              description: `Durchsucht Drucksachen mit strukturierten Filtern.

Ermöglicht präzise Suche nach:
- Drucksachennummer-Pattern (z.B. "*/2024" für alle aus 2024)
- Begriffen im Titel
- Dokumenttyp (Beschlussvorlage, Mitteilungsvorlage, Antrag, etc.)
- Zeitraum

Ideal für:
- "Alle Beschlussvorlagen aus 2024"
- "Bebauungspläne aus den letzten 2 Jahren"
- "Drucksachen zum Thema Haushalt"

**Über OParl:**
OParl ist ein offener Standard für parlamentarische Informationssysteme (https://oparl.org).
Jede Drucksache hat eine OParl-ID, die ein direkter, klickbarer Link zum Originaldokument
im Ratsinformationssystem ist. Dort sind alle zugehörigen PDF-Dateien, Beratungsverläufe
und Beschlüsse einsehbar.`,
              inputSchema: {
                type: 'object',
                properties: {
                  reference_pattern: {
                    type: 'string',
                    description:
                      'Pattern für Drucksachennummer. Beispiele: "*/2024" findet alle aus 2024, "101/*" findet alle mit Nummer 101. Der Stern (*) ist ein Platzhalter.',
                  },
                  name_contains: {
                    type: 'string',
                    description:
                      'Text der im Drucksachentitel vorkommen muss. Beispiel: "Bebauungsplan", "Haushalt", "Straße".',
                  },
                  paper_type: {
                    type: 'string',
                    description:
                      'Dokumenttyp. Häufige Werte: "Beschlussvorlage", "Mitteilungsvorlage", "Antrag", "Anfrage". Muss exakt übereinstimmen.',
                  },
                  date_from: {
                    type: 'string',
                    description: 'Startdatum im Format YYYY-MM-DD. Beispiel: "2024-01-01".',
                  },
                  date_to: {
                    type: 'string',
                    description: 'Enddatum im Format YYYY-MM-DD. Beispiel: "2024-12-31".',
                  },
                  limit: {
                    type: 'number',
                    description: 'Maximale Anzahl Ergebnisse. Standard: 10, Maximum: 50.',
                    default: 10,
                  },
                },
                required: [],
              },
            },
          ],
        };
        break;

      case 'tools/call':
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};

        if (toolName === 'search_documents') {
          result = await searchDocuments(env, toolArgs).then((searchResult) => ({
            content: [
              {
                type: 'text',
                text: searchResult.text,
              },
            ],
            structuredContent: {
              results: searchResult.structured,
            },
          }));
        } else if (toolName === 'get_paper_by_reference') {
          result = await getPaperByReference(env, toolArgs).then((paperResult) => ({
            content: [
              {
                type: 'text',
                text: paperResult.text,
              },
            ],
            structuredContent: paperResult.structured,
          }));
        } else if (toolName === 'search_papers') {
          result = await searchPapers(env, toolArgs).then((searchResult) => ({
            content: [
              {
                type: 'text',
                text: searchResult.text,
              },
            ],
            structuredContent: {
              papers: searchResult.structured,
            },
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
      result,
    };
  } catch (error) {
    // Log full error for debugging
    console.error('MCP Request error:', error.message);

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: sanitizeError(error, env),
      },
    };
  }
}

// ============================================================================
// Cloudflare Pages Functions Handlers
// ============================================================================

// Handle OPTIONS for CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    headers: corsHeaders,
  });
}

// Handle POST /mcp
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const mcpRequest = await request.json();

    // Handle batch requests (array of JSON-RPC messages)
    if (Array.isArray(mcpRequest)) {
      const responses = await Promise.all(mcpRequest.map((req) => handleMCPRequest(req, env)));
      return new Response(JSON.stringify(responses), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    // Handle single request
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
      },
    );
  }
}
