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
// Routes
// ============================================================================

// GET / - Homepage
app.get('/', (c) => {
  const html = `<!DOCTYPE html>
<html lang="de" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nordstemmen MCP Server</title>
  <link href="https://cdn.jsdelivr.net/npm/daisyui@4.12.14/dist/full.min.css" rel="stylesheet" type="text/css" />
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-base-200">
  <div class="container mx-auto px-4 py-12 max-w-6xl">
    <!-- Header -->
    <div class="hero bg-gradient-to-r from-primary to-secondary rounded-box mb-8 text-primary-content">
      <div class="hero-content text-center py-12">
        <div class="max-w-3xl">
          <h1 class="text-6xl font-bold mb-4">🏛️ Nordstemmen MCP Server</h1>
          <p class="text-xl">
            Zugriff auf das Ratsinformationssystem der Gemeinde Nordstemmen via Model Context Protocol
          </p>
        </div>
      </div>
    </div>

    <!-- Video Section -->
    <div class="card bg-base-100 shadow-xl mb-6">
      <div class="card-body">
        <h2 class="card-title text-3xl mb-4">📹 So funktioniert's</h2>
        <div class="aspect-video bg-gradient-to-br from-base-300 to-base-200 rounded-lg flex items-center justify-center mb-4">
          <div class="text-center">
            <svg class="w-24 h-24 mx-auto opacity-50 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <p class="text-base-content opacity-60 text-lg">Video/GIF kommt bald</p>
          </div>
        </div>
        <p class="text-base-content">
          Im Video siehst du, wie du Claude im Webinterface eine Frage zu Nordstemmen stellst und der MCP Server dir direkt mit relevanten Protokollen und Dokumenten aus dem Ratsinformationssystem antwortet.
        </p>
      </div>
    </div>

    <!-- What is this? -->
    <div class="card bg-base-100 shadow-xl mb-6">
      <div class="card-body">
        <h2 class="card-title text-3xl mb-4">🤔 Was ist dieser MCP Server?</h2>
        <p class="mb-4">
          Dieser Server ermöglicht es KI-Assistenten wie <strong>Claude</strong>, direkt auf die öffentlichen Dokumente
          des Ratsinformationssystems der Gemeinde Nordstemmen zuzugreifen. Du kannst ganz natürlich Fragen stellen wie:
        </p>
        <ul class="list-disc list-inside mb-4 space-y-2 ml-4">
          <li><em>"Was wurde in der letzten Ratssitzung beschlossen?"</em></li>
          <li><em>"Welche Bauvorhaben sind in Adensen geplant?"</em></li>
          <li><em>"Wie hoch ist der Haushalt für 2024?"</em></li>
          <li><em>"Gibt es Beschlüsse zur Verkehrsplanung?"</em></li>
        </ul>
        <div class="alert alert-info">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          <span>Der Server durchsucht <strong>semantisch</strong> über <strong>18 Jahre</strong> an öffentlichen Dokumenten (seit 2007) und findet relevante Informationen – selbst wenn die exakten Suchbegriffe nicht im Text vorkommen.</span>
        </div>
      </div>
    </div>

    <!-- Data Source -->
    <div class="card bg-base-100 shadow-xl mb-6">
      <div class="card-body">
        <h2 class="card-title text-3xl mb-4">📊 Woher kommen die Daten?</h2>
        <p class="mb-4">
          Alle Daten stammen direkt aus dem <span class="badge badge-primary">OParl-konformen</span> Ratsinformationssystem der Gemeinde Nordstemmen:
        </p>
        <div class="alert alert-info">
          <span class="font-mono text-sm">
            🔗 <a href="https://nordstemmen.ratsinfomanagement.net" target="_blank" class="link link-primary">
              nordstemmen.ratsinfomanagement.net
            </a>
          </span>
        </div>
        <p class="mt-4 mb-2 font-semibold">Die Datenbank enthält:</p>
        <div class="grid md:grid-cols-2 gap-2 mb-4">
          <div class="badge badge-outline badge-lg">📝 Sitzungsprotokolle</div>
          <div class="badge badge-outline badge-lg">📋 Beschlussvorlagen</div>
          <div class="badge badge-outline badge-lg">📢 Bekanntmachungen</div>
          <div class="badge badge-outline badge-lg">💰 Haushaltspläne</div>
          <div class="badge badge-outline badge-lg">🏗️ Bebauungspläne</div>
          <div class="badge badge-outline badge-lg">📄 Verwaltungsvorlagen</div>
          <div class="badge badge-outline badge-lg">✋ Anträge und Anfragen</div>
          <div class="badge badge-outline badge-lg">📊 Finanzberichte</div>
        </div>
        <div class="alert alert-success">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          <div>
            <div class="font-bold">💡 Was ist OParl?</div>
            <div class="text-sm">
              <a href="https://oparl.org" target="_blank" class="link">OParl</a>
              ist ein offener Standard für parlamentarische Informationssysteme in Deutschland.
              Alle Dokumente sind über standardisierte, klickbare Links direkt abrufbar.
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Open Source -->
    <div class="card bg-base-100 shadow-xl mb-6">
      <div class="card-body">
        <h2 class="card-title text-3xl mb-4">🔓 100% Open Source</h2>
        <p class="mb-4">
          Dieser MCP Server ist <strong>vollständig Open Source</strong>. Du kannst den gesamten Code,
          die Datenverarbeitung und die Infrastruktur auf GitHub einsehen und nachvollziehen:
        </p>
        <div class="alert">
          <span class="font-mono text-sm">
            🐙 <a href="https://github.com/levino/nordstemmen-ai" target="_blank" class="link link-primary font-semibold">
              github.com/levino/nordstemmen-ai
            </a>
          </span>
        </div>
        <p class="mt-4 mb-2 font-semibold">Das Projekt umfasst:</p>
        <div class="flex flex-col gap-2">
          <div class="collapse collapse-arrow bg-base-200">
            <input type="radio" name="project-accordion" checked />
            <div class="collapse-title font-medium">
              <strong>Scraper</strong> - Automatisches Herunterladen der Dokumente
            </div>
            <div class="collapse-content">
              <p>Automatisches Herunterladen der Dokumente vom Ratsinformationssystem über die OParl-API</p>
            </div>
          </div>
          <div class="collapse collapse-arrow bg-base-200">
            <input type="radio" name="project-accordion" />
            <div class="collapse-title font-medium">
              <strong>Embeddings</strong> - Verarbeitung der PDFs
            </div>
            <div class="collapse-content">
              <p>Verarbeitung der PDFs und Erstellung semantischer Suchindizes mit Jina AI Embeddings</p>
            </div>
          </div>
          <div class="collapse collapse-arrow bg-base-200">
            <input type="radio" name="project-accordion" />
            <div class="collapse-title font-medium">
              <strong>MCP Server</strong> - Der Server selbst
            </div>
            <div class="collapse-content">
              <p>Der MCP Server (dieser hier!) läuft auf Cloudflare Pages und bietet die API für KI-Assistenten</p>
            </div>
          </div>
        </div>
        <div class="badge badge-outline mt-4">Lizenz: MIT</div>
      </div>
    </div>

    <!-- Try it out -->
    <div class="card bg-gradient-to-r from-primary to-secondary text-primary-content shadow-xl mb-6">
      <div class="card-body items-center text-center">
        <h2 class="card-title text-3xl mb-4">🛠️ Probiere es selbst aus!</h2>
        <p class="text-lg mb-6">
          Mit dem <strong>MCP Inspector</strong> kannst du direkt mit der API experimentieren und die verfügbaren Tools testen:
        </p>
        <div class="card-actions">
          <a href="/mcp" class="btn btn-lg btn-neutral">
            🔍 MCP Inspector öffnen
          </a>
        </div>
        <p class="text-sm mt-4 opacity-90">
          Der Inspector ist bereits mit der Server-URL vorkonfiguriert. Klick einfach auf "Connect" und probiere die Tools aus!
        </p>
      </div>
    </div>

    <!-- Usage Guide -->
    <div class="card bg-base-100 shadow-xl mb-6">
      <div class="card-body">
        <h2 class="card-title text-3xl mb-4">📱 Wie benutze ich den Server mit Claude?</h2>
        <div class="tabs tabs-boxed mb-4">
          <a class="tab tab-active">Desktop App</a>
          <a class="tab">Web Interface</a>
        </div>

        <div class="space-y-6">
          <div>
            <h3 class="text-xl font-semibold mb-2">Option 1: Claude Desktop App</h3>
            <p class="mb-2">Füge diese Konfiguration in deine Claude Desktop Settings ein:</p>
            <div class="mockup-code">
              <pre data-prefix="1"><code>{</code></pre>
              <pre data-prefix="2"><code>  "mcpServers": {</code></pre>
              <pre data-prefix="3"><code>    "nordstemmen": {</code></pre>
              <pre data-prefix="4"><code>      "url": "https://nordstemmen-mcp.levinkeller.de/mcp"</code></pre>
              <pre data-prefix="5"><code>    }</code></pre>
              <pre data-prefix="6"><code>  }</code></pre>
              <pre data-prefix="7"><code>}</code></pre>
            </div>
          </div>

          <div class="divider">ODER</div>

          <div>
            <h3 class="text-xl font-semibold mb-2">Option 2: Claude Web (claude.ai)</h3>
            <p class="mb-2">
              In der Claude Web-Oberfläche kannst du MCP-Server direkt in den Einstellungen verbinden.
              Nutze diese URL:
            </p>
            <div class="alert">
              <span class="font-mono text-sm">https://nordstemmen-mcp.levinkeller.de/mcp</span>
            </div>
          </div>

          <div class="alert alert-warning">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            <span><strong>💡 Tipp:</strong> Nach der Verbindung kannst du Claude einfach Fragen zu Nordstemmen stellen. Claude wird automatisch die richtigen Tools verwenden, um dir zu antworten.</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Available Tools -->
    <div class="card bg-base-100 shadow-xl mb-6">
      <div class="card-body">
        <h2 class="card-title text-3xl mb-4">🧰 Verfügbare Tools</h2>
        <div class="join join-vertical w-full">
          <div class="collapse collapse-plus join-item border border-base-300">
            <input type="radio" name="tools-accordion" checked />
            <div class="collapse-title text-xl font-medium">
              🔍 search_documents
            </div>
            <div class="collapse-content">
              <p>Semantische Suche durch alle Dokumentinhalte. Findet relevante Informationen auch bei ungenauen Suchbegriffen.</p>
              <div class="badge badge-primary mt-2">Semantische Suche</div>
            </div>
          </div>

          <div class="collapse collapse-plus join-item border border-base-300">
            <input type="radio" name="tools-accordion" />
            <div class="collapse-title text-xl font-medium">
              📄 get_paper_by_reference
            </div>
            <div class="collapse-content">
              <p>Ruft eine spezifische Drucksache direkt über ihre Nummer ab (z.B. "DS 101/2024").</p>
              <div class="badge badge-success mt-2">Direkter Zugriff</div>
            </div>
          </div>

          <div class="collapse collapse-plus join-item border border-base-300">
            <input type="radio" name="tools-accordion" />
            <div class="collapse-title text-xl font-medium">
              📋 search_papers
            </div>
            <div class="collapse-content">
              <p>Strukturierte Suche mit Filtern nach Typ, Zeitraum, Nummer oder Stichwörtern im Titel.</p>
              <div class="badge badge-secondary mt-2">Erweiterte Filter</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <footer class="footer footer-center p-10 bg-base-200 text-base-content rounded-box">
      <aside>
        <p class="font-semibold">
          Erstellt von <a href="https://levinkeller.de" target="_blank" class="link link-primary">Levin Keller</a>
        </p>
        <p>Powered by</p>
        <div class="grid grid-flow-col gap-4">
          <a href="https://modelcontextprotocol.io" target="_blank" class="link link-hover">Model Context Protocol</a>
          <a href="https://qdrant.tech" target="_blank" class="link link-hover">Qdrant</a>
          <a href="https://jina.ai" target="_blank" class="link link-hover">Jina AI</a>
          <a href="https://pages.cloudflare.com" target="_blank" class="link link-hover">Cloudflare Pages</a>
        </div>
      </aside>
    </footer>
  </div>
</body>
</html>`;

  return c.html(html);
});

// GET /mcp - MCP Inspector
app.get('/mcp', (c) => {
  const serverUrl = 'https://nordstemmen-mcp.levinkeller.de/mcp';
  const inspectorUrl = 'https://modelcontextprotocol.io/inspector?server=' + encodeURIComponent(serverUrl);

  const html = `<!DOCTYPE html>
<html lang="de" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MCP Inspector - Nordstemmen MCP Server</title>
  <link href="https://cdn.jsdelivr.net/npm/daisyui@4.12.14/dist/full.min.css" rel="stylesheet" type="text/css" />
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body, html {
      margin: 0;
      padding: 0;
      height: 100vh;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <!-- Navbar -->
  <div class="navbar bg-gradient-to-r from-primary to-secondary text-primary-content shadow-lg">
    <div class="flex-1">
      <a href="/" class="btn btn-ghost text-xl">
        🏛️ Nordstemmen MCP Server
      </a>
      <div class="badge badge-outline ml-2">Inspector</div>
    </div>
    <div class="flex-none">
      <a href="/" class="btn btn-neutral btn-sm">
        ← Zurück
      </a>
    </div>
  </div>

  <!-- Alert Info -->
  <div class="alert alert-info rounded-none">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
    <span>
      <strong>Anleitung:</strong> Der MCP Inspector ist bereits mit der Server-URL vorkonfiguriert.
      Klicke auf <strong>"Connect"</strong> um die Verbindung herzustellen, dann kannst du die verfügbaren Tools testen.
    </span>
  </div>

  <!-- Inspector iframe -->
  <iframe
    src="${inspectorUrl}"
    style="width: 100%; height: calc(100vh - 132px); border: none;"
    title="MCP Inspector"
  ></iframe>

</body>
</html>`;

  return c.html(html);
});

// POST /mcp - MCP endpoint
app.post('/mcp', async (c) => {
  try {
    return c.req.json().then((mcpRequest) => {
      const env = c.env;

      // Handle batch requests (array of JSON-RPC messages)
      if (Array.isArray(mcpRequest)) {
        return Promise.all(mcpRequest.map((req) => handleMCPRequest(req, env))).then((responses) => c.json(responses));
      }

      // Handle single request
      return handleMCPRequest(mcpRequest, env).then((mcpResponse) => c.json(mcpResponse));
    });
  } catch (error) {
    return c.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error',
        },
      },
      400,
    );
  }
});

// ============================================================================
// Export
// ============================================================================

export default app;
