import { QdrantClient } from '@qdrant/js-client-rest';
import pdfParse from 'pdf-parse';

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
  const { query, limit = 5, date_from, date_to } = args;

  try {
    const client = new QdrantClient({
      url: env.QDRANT_URL,
      apiKey: env.QDRANT_API_KEY,
      port: env.QDRANT_PORT ? parseInt(env.QDRANT_PORT) : undefined,
    });

    return generateEmbedding(env, query)
      .then((queryEmbedding) => {
        // Build filter for date range if provided
        const searchParams = {
          vector: queryEmbedding,
          limit: Math.min(limit, 10),
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
            // Prefer pdf_access_url for direct PDF link, fallback to entity_id (OParl API)
            const url = payload.pdf_access_url || payload.entity_id || '';
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
            url: payload.pdf_access_url || payload.entity_id || null,
            oparl_id: payload.entity_id || null,
            pdf_url: payload.pdf_access_url || null,
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

    // Prefer direct PDF link over OParl API link
    const pdfUrl = payload.pdf_access_url || '';
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
      with_payload: ['entity_name', 'paper_reference', 'paper_type', 'date', 'entity_id', 'pdf_access_url'],
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
          pdf_url: p.pdf_access_url || null,
        });
      }
    });

    const papers = Array.from(papersMap.values());

    // Build text output
    const textResults = papers
      .map((paper, index) => {
        // Prefer PDF link over OParl API link
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

async function getPdfContent(env, args) {
  const { pdf_url } = args;

  // Validate URL
  if (!pdf_url || typeof pdf_url !== 'string') {
    throw new Error('pdf_url is required and must be a string');
  }

  try {
    // Parse URL to extract filename
    const url = new URL(pdf_url);
    const filename = url.pathname.split('/').pop() || 'document.pdf';

    // Download PDF with timeout and size limit
    const MAX_SIZE_MB = 30;
    const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
    const TIMEOUT_MS = 10000; // 10 seconds

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(pdf_url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Nordstemmen-MCP-Server/1.0',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`PDF download failed: ${response.status} ${response.statusText}`);
      }

      // Check content type
      const contentType = response.headers.get('content-type');
      if (contentType && !contentType.includes('pdf')) {
        throw new Error(`Invalid content type: ${contentType}. Expected PDF.`);
      }

      // Check content length if provided
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > MAX_SIZE_BYTES) {
        throw new Error(`PDF too large: ${(parseInt(contentLength) / 1024 / 1024).toFixed(2)} MB (max: ${MAX_SIZE_MB} MB)`);
      }

      // Get PDF as ArrayBuffer
      const arrayBuffer = await response.arrayBuffer();

      // Check actual size
      if (arrayBuffer.byteLength > MAX_SIZE_BYTES) {
        throw new Error(`PDF too large: ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB (max: ${MAX_SIZE_MB} MB)`);
      }

      // Convert to Buffer for pdf-parse
      const buffer = Buffer.from(arrayBuffer);

      // Extract text from PDF
      let pdfText = '';
      let pdfMetadata = {};
      let numPages = 0;

      try {
        const pdfData = await pdfParse(buffer);
        pdfText = pdfData.text || '';
        numPages = pdfData.numpages || 0;
        pdfMetadata = pdfData.info || {};
      } catch (parseError) {
        // PDF parsing failed - could be scanned PDF without text
        console.error('PDF parsing error:', parseError.message);
        pdfText = '[PDF parsing failed - possibly scanned document without embedded text]';
      }

      // Encode to Base64
      const contentBase64 = buffer.toString('base64');

      return {
        text: `# PDF Content Extracted

**Filename:** ${filename}
**URL:** ${pdf_url}
**Size:** ${(arrayBuffer.byteLength / 1024).toFixed(2)} KB
**Pages:** ${numPages}
${pdfMetadata.Title ? `**Title:** ${pdfMetadata.Title}` : ''}

**Text Preview:**
${pdfText.substring(0, 1000)}${pdfText.length > 1000 ? '...\n\n[Text truncated in preview. Full text available in structured response.]' : ''}

**Base64 Content:** Available in structured response (${contentBase64.length} characters)`,
        structured: {
          pdf_url,
          filename,
          size_bytes: arrayBuffer.byteLength,
          size_kb: Math.round(arrayBuffer.byteLength / 1024),
          num_pages: numPages,
          metadata: pdfMetadata,
          content_base64: contentBase64,
          content_text: pdfText,
        },
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);

      // Handle abort (timeout)
      if (fetchError.name === 'AbortError') {
        throw new Error(`PDF download timeout after ${TIMEOUT_MS / 1000} seconds`);
      }

      throw fetchError;
    }
  } catch (error) {
    throw new Error(`Failed to get PDF content: ${error.message}`);
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
Für jedes Dokument werden ZWEI Links zurückgegeben:

1. **PDF-Link (pdf_url)**: Direkter Link zum PDF-Dokument
   - Beispiel: https://nordstemmen.ratsinfomanagement.net/.../Beschlussvorlage_DS_12-2024.pdf
   - **Nutze diesen Link um das PDF selbst zu laden und zu lesen**
   - **Zeige diesen Link auch dem Nutzer als Quellenangabe**
   - Öffnet im Browser-PDF-Viewer (keine Download-Aufforderung)

2. **OParl-API-Link (oparl_id)**: Link zum Paper/Meeting-Objekt in der OParl-API
   - Beispiel: https://nordstemmen.ratsinfomanagement.net/webservice/oparl/v1.1/body/1/paper/5475
   - **Nutze ihn NUR um verwandte Dokumente zu finden**: weitere Anhänge bei Papers, weitere Dokumente bei Meetings
   - Liefert maschinenlesbares JSON mit Metadaten und Links zu anderen Dokumenten
   - Zeige diesen Link nur, wenn der Nutzer explizit nach API-Links fragt

**Workflow:** Für jedes relevante Suchergebnis: (1) Lade und lies das PDF über pdf_url, (2) Falls du weitere Anhänge/Dokumente brauchst, nutze oparl_id um diese zu finden, (3) Zeige dem Nutzer den pdf_url als Quellenangabe.

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

**WICHTIG - Zwei Arten von Links:**
Das Tool liefert ZWEI Links:

1. **PDF-Link (pdf_url)**: Direkter Link zum PDF-Hauptdokument
   - **Nutze diesen Link um das PDF selbst zu laden und zu lesen**
   - **Zeige diesen Link auch dem Nutzer als Quellenangabe**
   - Öffnet im Browser-PDF-Viewer (keine Download-Aufforderung)

2. **OParl-ID (oparl_id)**: Link zum Paper-Objekt in der OParl-API
   - **Nutze ihn NUR um verwandte Dokumente zu finden**: weitere Anhänge, Beratungsverläufe, zugehörige Meetings
   - Liefert maschinenlesbares JSON mit Metadaten und Links zu anderen Dokumenten
   - Zeige diesen Link nur, wenn der Nutzer explizit nach API-Links fragt

**Workflow:** (1) Lade und lies das PDF über pdf_url, (2) Falls du weitere Anhänge/Dokumente brauchst, nutze oparl_id um diese zu finden, (3) Zeige dem Nutzer den pdf_url als Quellenangabe.

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

**WICHTIG - Zwei Arten von Links:**
Für jede Drucksache werden ZWEI Links zurückgegeben:

1. **PDF-Link (pdf_url)**: Direkter Link zum PDF-Hauptdokument
   - **Nutze diesen Link um das PDF selbst zu laden und zu lesen**
   - **Zeige diesen Link auch dem Nutzer als Quellenangabe**
   - Öffnet im Browser-PDF-Viewer (keine Download-Aufforderung)

2. **OParl-ID (oparl_id)**: Link zum Paper-Objekt in der OParl-API
   - **Nutze ihn NUR um verwandte Dokumente zu finden**: weitere Anhänge, Beratungsverläufe, zugehörige Meetings
   - Liefert maschinenlesbares JSON mit Metadaten und Links zu anderen Dokumenten
   - Zeige diesen Link nur, wenn der Nutzer explizit nach API-Links fragt

**Workflow:** (1) Lade und lies das PDF über pdf_url, (2) Falls du weitere Anhänge/Dokumente brauchst, nutze oparl_id um diese zu finden, (3) Zeige dem Nutzer den pdf_url als Quellenangabe.

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
                },
                required: [],
              },
            },
            {
              name: 'get_pdf_content',
              description: `Lädt ein PDF-Dokument herunter und extrahiert dessen Inhalt.

**WICHTIG:** Dieses Tool lädt die vollständige PDF-Datei herunter und extrahiert sowohl den Text als auch den Base64-kodierten Inhalt.

**Verwendung:**
1. Nutze zuerst search_documents, get_paper_by_reference oder search_papers um relevante Dokumente zu finden
2. Diese Tools liefern pdf_url für jedes Dokument
3. Übergebe die pdf_url an get_pdf_content um den vollständigen Inhalt zu laden

**Rückgabe:**
- **content_base64**: Vollständige PDF-Datei Base64-kodiert (UTF-8 String)
  - Ideal für komplexe PDFs mit Bildern, Grafiken, Tabellen, Diagrammen
  - Kann direkt an andere APIs/Tools weitergegeben werden

- **content_text**: Extrahierter Volltext aus dem PDF
  - Für reine Textanalyse und Informationsextraktion
  - Bei gescannten PDFs ohne eingebetteten Text steht hier ein Hinweis

- **metadata**: PDF-Metadaten (Titel, Autor, Erstellungsdatum, etc.)
- **num_pages**: Anzahl der Seiten
- **size_bytes / size_kb**: Dateigröße

**Limits:**
- Maximale Dateigröße: 30 MB
- Timeout: 10 Sekunden
- Fehler bei ungültigen URLs, nicht erreichbaren Dokumenten oder zu großen Dateien

**Typische Use Cases:**
- Analyse von Haushaltsplänen und Finanzberichten (Tabellen, Zahlen)
- Auswertung von Bebauungsplänen (Karten, Grafiken)
- Detaillierte Textanalyse von Beschlussvorlagen
- Extraktion von Strukturdaten aus komplexen Dokumenten

**Performance-Hinweis:**
Bei großen PDFs (>10 MB) kann die Verarbeitung mehrere Sekunden dauern.`,
              inputSchema: {
                type: 'object',
                properties: {
                  pdf_url: {
                    type: 'string',
                    description:
                      'Die vollständige URL zum PDF-Dokument. Diese URL wird typischerweise von search_documents, get_paper_by_reference oder search_papers zurückgegeben. Beispiel: "https://nordstemmen.ratsinfomanagement.net/.../Dokument.pdf"',
                  },
                },
                required: ['pdf_url'],
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
        } else if (toolName === 'get_pdf_content') {
          result = await getPdfContent(env, toolArgs).then((pdfResult) => ({
            content: [
              {
                type: 'text',
                text: pdfResult.text,
              },
            ],
            structuredContent: pdfResult.structured,
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
