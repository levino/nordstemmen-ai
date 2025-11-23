import { QdrantClient } from '@qdrant/js-client-rest';

// ============================================================================
// CORS Headers
// ============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
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
  const { query, limit = 5, offset = 0, date_from, date_to } = args;

  try {
    const client = new QdrantClient({
      url: env.QDRANT_URL,
      apiKey: env.QDRANT_API_KEY,
      port: env.QDRANT_PORT ? parseInt(env.QDRANT_PORT) : undefined,
    });

    return generateEmbedding(env, query)
      .then((queryEmbedding) => {
        // Build filter for date range if provided
        // For pagination: fetch limit + offset results, then slice
        const effectiveLimit = Math.min(limit, 10);
        const fetchLimit = effectiveLimit + offset;
        const searchParams = {
          vector: queryEmbedding,
          limit: fetchLimit,
          with_payload: true,
        };

        if (date_from || date_to) {
          const range = {};
          if (date_from) range.gte = date_from;
          if (date_to) range.lte = date_to;

          searchParams.filter = {
            must: [
              {
                key: 'date',
                range,
              },
            ],
          };
        }

        return client.search(env.QDRANT_COLLECTION, searchParams);
      })
      .then((results) => {
        // Apply pagination: skip first 'offset' results
        const paginatedResults = results.slice(offset);

        if (!paginatedResults || paginatedResults.length === 0) {
          return {
            text: 'No relevant documents found.',
            structured: [],
          };
        }

        // Build both text and structured versions
        const textResults = paginatedResults
          .map((result, index) => {
            const payload = result.payload;
            const title = payload.entity_name || payload.filename || 'Unknown';
            
            // Generate proxy URL from file_hash if available, fallback to entity_id (OParl API)
            let url = payload.entity_id || '';
            if (payload.file_hash) {
              const proxyBaseUrl = env.PDF_PROXY_URL || 'https://nordstemmen-mcp.levinkeller.de';
              url = `${proxyBaseUrl}/pdf/${payload.file_hash}`;
              
              // Add filename if available
              if (payload.filename) {
                const filename = payload.filename.split('/').pop(); // Get just the filename part
                url += `?filename=${encodeURIComponent(filename)}`;
              }
            }
            
            const date = payload.date || '';
            const score = result.score?.toFixed(3) || '?';
            const ref = payload.paper_reference ? ` (${payload.paper_reference})` : '';

            // Markdown with clickable link
            const titleLink = url ? `[${title}](${url})` : title;
            const metadata = [date, `Score: ${score}`].filter(Boolean).join(' • ');

            return `${index + 1}. ${titleLink}${ref}\n${metadata}\n\n${payload.text || ''}`;
          })
          .join('\n\n---\n\n');

        const structuredResults = paginatedResults.map((result, index) => {
          const payload = result.payload;
          
          // Generate proxy URL from file_hash if available
          let proxyUrl = null;
          if (payload.file_hash) {
            const proxyBaseUrl = env.PDF_PROXY_URL || 'https://nordstemmen-mcp.levinkeller.de';
            proxyUrl = `${proxyBaseUrl}/pdf/${payload.file_hash}`;
            
            // Add filename if available
            if (payload.filename) {
              const filename = payload.filename.split('/').pop(); // Get just the filename part
              proxyUrl += `?filename=${encodeURIComponent(filename)}`;
            }
          }
          
          return {
            rank: index + 1,
            title: payload.entity_name || payload.filename || 'Unknown',
            url: proxyUrl || payload.entity_id || null,
            oparl_id: payload.entity_id || null,
            pdf_url: proxyUrl || null,
            file_hash: payload.file_hash || null,
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
    normalizedRef = normalizedRef.replace(/[-/]/g, '/');

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

    // Generate proxy URL from file_hash if available
    let pdfUrl = '';
    if (payload.file_hash) {
      const proxyBaseUrl = env.PDF_PROXY_URL || 'https://nordstemmen-mcp.levinkeller.de';
      pdfUrl = `${proxyBaseUrl}/pdf/${payload.file_hash}`;
      
      // Add filename if available
      if (payload.filename) {
        const filename = payload.filename.split('/').pop(); // Get just the filename part
        pdfUrl += `?filename=${encodeURIComponent(filename)}`;
      }
    }
    
    const oparlUrl = payload.entity_id || '';
    const primaryLink = pdfUrl || oparlUrl;

    const paperInfo = `# ${payload.entity_name || 'Unknown Paper'}

**Reference:** ${payload.paper_reference || 'N/A'}
**Type:** ${payload.paper_type || 'N/A'}
**Date:** ${payload.date || 'N/A'}
${pdfUrl ? `**PDF:** ${pdfUrl}` : ''}
**OParl ID:** ${oparlUrl || 'N/A'}

[${pdfUrl ? 'View PDF' : 'View in Ratsinformationssystem'}](${primaryLink || '#'})`;

    return {
      text: paperInfo,
      structured: {
        reference: payload.paper_reference || null,
        name: payload.entity_name || null,
        paperType: payload.paper_type || null,
        date: payload.date || null,
        oparl_id: payload.entity_id || null,
        pdf_url: payload.pdf_access_url || null,
        file_hash: payload.file_hash || null,
      },
    };
  } catch (error) {
    throw new Error(`Get paper error: ${error.message}`);
  }
}

async function getDocumentText(env, args) {
  const { file_hash } = args;

  try {
    const client = new QdrantClient({
      url: env.QDRANT_URL,
      apiKey: env.QDRANT_API_KEY,
      port: env.QDRANT_PORT ? parseInt(env.QDRANT_PORT) : undefined,
    });

    // Search for the first chunk of the document (page 1, chunk_index 0) which contains full_text
    const scrollResult = await client.scroll(env.QDRANT_COLLECTION, {
      filter: {
        must: [
          {
            key: 'file_hash',
            match: { value: file_hash },
          },
          {
            key: 'page',
            match: { value: 1 },
          },
          {
            key: 'chunk_index',
            match: { value: 0 },
          },
        ],
      },
      limit: 1,
      with_payload: ['full_text', 'filename', 'entity_name', 'paper_reference', 'date', 'entity_type'],
    });

    if (!scrollResult.points || scrollResult.points.length === 0) {
      return {
        text: `Document with file_hash "${file_hash}" not found.`,
        structured: null,
      };
    }

    const payload = scrollResult.points[0].payload;
    const fullText = payload.full_text;

    if (!fullText) {
      return {
        text: `Full text not available for this document. The document may have been indexed before full text storage was enabled.`,
        structured: {
          file_hash,
          filename: payload.filename || null,
          entity_name: payload.entity_name || null,
          full_text: null,
          error: 'Full text not available - document needs re-indexing',
        },
      };
    }

    const title = payload.entity_name || payload.filename || 'Unknown';
    const ref = payload.paper_reference ? ` (${payload.paper_reference})` : '';
    const date = payload.date ? ` - ${payload.date}` : '';

    const textResponse = `# ${title}${ref}${date}\n\n${fullText}`;

    return {
      text: textResponse,
      structured: {
        file_hash,
        filename: payload.filename || null,
        entity_name: payload.entity_name || null,
        paper_reference: payload.paper_reference || null,
        date: payload.date || null,
        entity_type: payload.entity_type || null,
        full_text: fullText,
      },
    };
  } catch (error) {
    throw new Error(`Get document text error: ${error.message}`);
  }
}

async function searchPapers(env, args) {
  const { reference_pattern, name_contains, paper_type, date_from, date_to, limit = 10, offset = 0 } = args;

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
    // For pagination: fetch more results to account for offset and deduplication
    const effectiveLimit = Math.min(limit, 50);
    const fetchLimit = (effectiveLimit + offset) * 3; // Fetch extra to account for deduplication
    const scrollResult = await client.scroll(env.QDRANT_COLLECTION, {
      filter: { must },
      limit: fetchLimit,
      with_payload: ['entity_name', 'paper_reference', 'paper_type', 'date', 'entity_id', 'pdf_access_url', 'file_hash', 'filename'],
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
        // Generate proxy URL from file_hash if available
        let proxyUrl = null;
        if (p.file_hash) {
          const proxyBaseUrl = env.PDF_PROXY_URL || 'https://nordstemmen-mcp.levinkeller.de';
          proxyUrl = `${proxyBaseUrl}/pdf/${p.file_hash}`;
          
          // Add filename if available
          if (p.filename) {
            const filename = p.filename.split('/').pop(); // Get just the filename part
            proxyUrl += `?filename=${encodeURIComponent(filename)}`;
          }
        }
        
        papersMap.set(p.paper_reference, {
          reference: p.paper_reference || null,
          name: p.entity_name || null,
          paperType: p.paper_type || null,
          date: p.date || null,
          oparl_id: p.entity_id || null,
          pdf_url: proxyUrl || null,
          file_hash: p.file_hash || null,
        });
      }
    });

    // Apply pagination after deduplication
    const allPapers = Array.from(papersMap.values());
    const papers = allPapers.slice(offset, offset + effectiveLimit);

    if (papers.length === 0) {
      return {
        text: 'No papers found matching the criteria.',
        structured: [],
      };
    }

    // Build text output
    const textResults = papers
      .map((paper, index) => {
        // Prefer proxy PDF link over OParl API link
        const url = paper.pdf_url || paper.oparl_id;
        const titleLink = url ? `[${paper.name}](${url})` : paper.name;
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

**WICHTIG - Zwei Arten von Links:**

Für jedes Dokument werden ZWEI Informationen zurückgegeben:

1. **PDF-Link (pdf_url)**: Direkter Link zum PDF-Dokument
   - Beispiel: https://nordstemmen-mcp.levinkeller.de/pdf/abc123...
   - **Lade das PDF direkt über diesen Link**
   - Funktioniert für alle PDFs, schnell und effizient durch Edge-Caching
   - **Zeige diesen Link auch dem Nutzer als Quellenangabe**

2. **OParl-API-Link (oparl_id)**: Link zum Paper/Meeting-Objekt in der OParl-API
   - Beispiel: https://nordstemmen.ratsinfomanagement.net/webservice/oparl/v1.1/body/1/paper/5475
   - **Nutze ihn NUR um verwandte Dokumente zu finden**: weitere Anhänge bei Papers, weitere Dokumente bei Meetings
   - Liefert maschinenlesbares JSON mit Metadaten und Links zu anderen Dokumenten

**WORKFLOW:**

1. **PDF-Download**: Lade das PDF direkt über pdf_url
   \`\`\`
   response = fetch(pdf_url)
   pdf_content = response.body
   \`\`\`

2. **Weitere Dokumente**: Nutze oparl_id um verwandte Dokumente zu finden

3. **Quellenangabe**: Zeige dem Nutzer den pdf_url als Quellenangabe

**Über OParl:**
OParl ist ein offener Standard für parlamentarische Informationssysteme (https://oparl.org).

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
                  offset: {
                    type: 'number',
                    description:
                      'Anzahl der Ergebnisse, die übersprungen werden sollen (für Pagination). Standard ist 0. Beispiel: offset=5 überspringt die ersten 5 Ergebnisse.',
                    default: 0,
                  },
                  date_from: {
                    type: 'string',
                    description:
                      'Optionales Startdatum für die Filterung im Format YYYY-MM-DD. Beispiel: "2024-01-01". Begrenzt die Suche auf Dokumente ab diesem Datum.',
                  },
                  date_to: {
                    type: 'string',
                    description:
                      'Optionales Enddatum für die Filterung im Format YYYY-MM-DD. Beispiel: "2024-12-31". Begrenzt die Suche auf Dokumente bis zu diesem Datum.',
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

**WICHTIG - PDF-Zugriff:**

Das Tool liefert zwei Informationen für den PDF-Zugriff:

1. **PDF-Link (pdf_url)**: Direkter Link zum PDF-Hauptdokument
   - **Lade das PDF direkt über diesen Link**
   - Schnell und effizient, funktioniert für alle PDFs
   - **Zeige diesen Link auch dem Nutzer als Quellenangabe**

2. **OParl-ID (oparl_id)**: Link zum Paper-Objekt in der OParl-API
   - **Nutze ihn NUR um verwandte Dokumente zu finden**: weitere Anhänge, Beratungsverläufe, zugehörige Meetings
   - Liefert maschinenlesbares JSON mit Metadaten und Links zu anderen Dokumenten

**Workflow:** (1) Lade das PDF direkt über pdf_url, (2) Falls du weitere Anhänge brauchst, nutze oparl_id, (3) Zeige dem Nutzer den pdf_url als Quellenangabe.

**Über OParl:**
OParl ist ein offener Standard für parlamentarische Informationssysteme (https://oparl.org).`,
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

**WICHTIG - PDF-Zugriff:**

Für jede Drucksache werden zwei Informationen für den PDF-Zugriff zurückgegeben:

1. **PDF-Link (pdf_url)**: Direkter Link zum PDF-Hauptdokument
   - **Lade das PDF direkt über diesen Link**
   - Schnell und effizient, funktioniert für alle PDFs
   - **Zeige diesen Link auch dem Nutzer als Quellenangabe**

2. **OParl-ID (oparl_id)**: Link zum Paper-Objekt in der OParl-API
   - **Nutze ihn NUR um verwandte Dokumente zu finden**: weitere Anhänge, Beratungsverläufe, zugehörige Meetings
   - Liefert maschinenlesbares JSON mit Metadaten und Links zu anderen Dokumenten

**Workflow:** (1) Lade das PDF direkt über pdf_url, (2) Falls du weitere Anhänge brauchst, nutze oparl_id, (3) Zeige dem Nutzer den pdf_url als Quellenangabe.

**Über OParl:**
OParl ist ein offener Standard für parlamentarische Informationssysteme (https://oparl.org).`,
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
                  offset: {
                    type: 'number',
                    description: 'Anzahl der Ergebnisse, die übersprungen werden sollen (für Pagination). Standard ist 0.',
                    default: 0,
                  },
                },
                required: [],
              },
            },
            {
              name: 'get_document_text',
              description: `Ruft den vollständigen extrahierten Text eines Dokuments anhand seines file_hash ab.

Der file_hash ist der SHA256-Hash der PDF-Datei und wird in den Suchergebnissen von search_documents und search_papers zurückgegeben.

Dieses Tool ist nützlich, wenn du den kompletten Inhalt eines Dokuments lesen möchtest, anstatt nur die Textausschnitte (excerpts) aus den Suchergebnissen.

**Anwendungsfälle:**
- Vollständige Analyse eines gefundenen Dokuments
- Extraktion aller Details aus einer Drucksache
- Lesen des gesamten Protokolls einer Sitzung

**Rückgabe:**
- Der vollständige extrahierte Text des PDFs mit Seitenmarkierungen
- Metadaten wie Titel, Datum und Referenz

**Hinweis:** Dokumente, die vor der Einführung dieser Funktion indiziert wurden, haben möglicherweise keinen vollständigen Text gespeichert und müssen neu indiziert werden.`,
              inputSchema: {
                type: 'object',
                properties: {
                  file_hash: {
                    type: 'string',
                    description:
                      'Der SHA256-Hash der PDF-Datei. Dieser wird in den Suchergebnissen als "file_hash" zurückgegeben.',
                  },
                },
                required: ['file_hash'],
              },
            },
          ],
        };
        break;

      case 'tools/call': {
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
        } else if (toolName === 'get_document_text') {
          result = await getDocumentText(env, toolArgs).then((docResult) => ({
            content: [
              {
                type: 'text',
                text: docResult.text,
              },
            ],
            structuredContent: docResult.structured,
          }));
        } else {
          throw new Error(`Unknown tool: ${toolName}`);
        }
        break;
      }

      case 'notifications/initialized':
        // Simply acknowledge the notification without logging
        result = {};
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
