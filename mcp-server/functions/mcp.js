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
// Sparse Vector (BM25-TF) — must match pipeline/src/sparse.ts exactly
// ============================================================================

const STOPWORDS = new Set([
  'aber',
  'alle',
  'allem',
  'allen',
  'aller',
  'allerdings',
  'alles',
  'also',
  'am',
  'an',
  'ander',
  'andere',
  'anderem',
  'anderen',
  'anderer',
  'anderes',
  'anderm',
  'andern',
  'anders',
  'auch',
  'auf',
  'aus',
  'bei',
  'beim',
  'bereits',
  'besonders',
  'bin',
  'bis',
  'bisher',
  'bist',
  'da',
  'dabei',
  'dadurch',
  'dafür',
  'dagegen',
  'daher',
  'dahin',
  'damals',
  'damit',
  'danach',
  'daneben',
  'dann',
  'daran',
  'darauf',
  'daraus',
  'darf',
  'darfst',
  'darin',
  'darum',
  'darunter',
  'darüber',
  'das',
  'dass',
  'davon',
  'davor',
  'dazu',
  'dein',
  'deine',
  'deinem',
  'deinen',
  'deiner',
  'dem',
  'den',
  'denn',
  'dennoch',
  'der',
  'deren',
  'des',
  'deshalb',
  'dessen',
  'die',
  'dies',
  'diese',
  'dieselbe',
  'dieselben',
  'diesem',
  'diesen',
  'dieser',
  'dieses',
  'doch',
  'dort',
  'du',
  'durch',
  'dürfen',
  'ein',
  'eine',
  'einem',
  'einen',
  'einer',
  'einige',
  'einigem',
  'einigen',
  'einiger',
  'einiges',
  'einmal',
  'er',
  'erst',
  'es',
  'etwa',
  'etwas',
  'euch',
  'euer',
  'eure',
  'eurem',
  'euren',
  'eurer',
  'für',
  'ganz',
  'gar',
  'gegen',
  'gehen',
  'geht',
  'gemacht',
  'genug',
  'gern',
  'gerne',
  'gibt',
  'ging',
  'hab',
  'habe',
  'haben',
  'hat',
  'hatte',
  'hätte',
  'her',
  'herr',
  'hier',
  'hin',
  'hinter',
  'ich',
  'ihm',
  'ihn',
  'ihnen',
  'ihr',
  'ihre',
  'ihrem',
  'ihren',
  'ihrer',
  'immer',
  'in',
  'indem',
  'infolge',
  'innen',
  'ins',
  'irgend',
  'ist',
  'ja',
  'jede',
  'jedem',
  'jeden',
  'jeder',
  'jedes',
  'jedoch',
  'jemals',
  'jene',
  'jenem',
  'jenen',
  'jener',
  'jenes',
  'jetzt',
  'kann',
  'kannst',
  'kein',
  'keine',
  'keinem',
  'keinen',
  'keiner',
  'kommen',
  'konnte',
  'können',
  'könnte',
  'lassen',
  'machen',
  'macht',
  'man',
  'manch',
  'manche',
  'manchem',
  'manchen',
  'mancher',
  'manchmal',
  'mehr',
  'mein',
  'meine',
  'meinem',
  'meinen',
  'meiner',
  'mit',
  'möchte',
  'muss',
  'musste',
  'müssen',
  'nach',
  'nachdem',
  'nachher',
  'nein',
  'nicht',
  'nichts',
  'noch',
  'nun',
  'nur',
  'ob',
  'oder',
  'ohne',
  'sehr',
  'seid',
  'sein',
  'seine',
  'seinem',
  'seinen',
  'seiner',
  'seit',
  'seitdem',
  'sich',
  'sie',
  'sind',
  'so',
  'sogar',
  'solch',
  'solche',
  'solchem',
  'solchen',
  'solcher',
  'soll',
  'sollen',
  'sollte',
  'sollten',
  'solltest',
  'sondern',
  'sonst',
  'sowie',
  'über',
  'um',
  'und',
  'uns',
  'unser',
  'unsere',
  'unserem',
  'unseren',
  'unserer',
  'unter',
  'viel',
  'viele',
  'vielen',
  'vielleicht',
  'vom',
  'von',
  'vor',
  'vorbei',
  'vorher',
  'warum',
  'was',
  'weder',
  'weil',
  'welch',
  'welche',
  'welchem',
  'welchen',
  'welcher',
  'welches',
  'wenn',
  'wer',
  'werde',
  'werden',
  'werdet',
  'wessen',
  'wie',
  'wieder',
  'will',
  'wir',
  'wird',
  'wirst',
  'wo',
  'wohl',
  'wollen',
  'worden',
  'wurde',
  'würde',
  'während',
  'würden',
  'zu',
  'zum',
  'zur',
  'zwar',
  'zwischen',
]);

function hashToken(token) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[^a-zäöüß0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function computeSparseVector(text) {
  const tokens = tokenize(text);
  if (tokens.length === 0) return { indices: [], values: [] };

  const tf = new Map();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }

  const indices = [];
  const values = [];
  for (const [token, count] of tf) {
    indices.push(hashToken(token));
    values.push(count / (count + 1.2));
  }

  return { indices, values };
}

// ============================================================================
// Embedding Service
// ============================================================================

async function generateEmbedding(env, text) {
  const maxRetries = 3;
  const backoffMs = [1000, 2000, 4000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch('https://api.jina.ai/v1/embeddings', {
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
    });

    if (response.status === 429 && attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt]));
      continue;
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Jina API error: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    const data = await response.json();
    if (data.data && data.data[0] && data.data[0].embedding) {
      return data.data[0].embedding;
    }
    throw new Error(`Unexpected Jina API response format: ${JSON.stringify(data)}`);
  }
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

    const queryEmbedding = await generateEmbedding(env, query);
    const sparseQuery = computeSparseVector(query);

    const filter =
      date_from || date_to
        ? {
            must: [
              {
                key: 'date',
                range: {
                  ...(date_from ? { gte: date_from } : {}),
                  ...(date_to ? { lte: date_to } : {}),
                },
              },
            ],
          }
        : undefined;

    const effectiveLimit = Math.min(limit, 10);

    const result = await client.query(env.QDRANT_COLLECTION, {
      prefetch: [
        { query: queryEmbedding, using: 'dense', limit: 20, filter },
        { query: { indices: sparseQuery.indices, values: sparseQuery.values }, using: 'sparse', limit: 20, filter },
      ],
      query: { fusion: 'rrf' },
      limit: effectiveLimit,
      with_payload: true,
    });

    const points = result.points || [];
    if (points.length === 0) return [];

    return points.map((point, index) => {
      const payload = point.payload;
      const pdfUrl = payload.pdf_access_url || null;

      return {
        rank: index + 1,
        title: payload.entity_name || payload.filename || 'Unknown',
        url: pdfUrl || payload.entity_id || null,
        oparl_id: payload.entity_id || null,
        pdf_url: pdfUrl,
        file_hash: payload.file_hash || null,
        date: payload.date || null,
        page: payload.page || null,
        score: point.score || 0,
        excerpt: payload.text || '',
        filename: payload.filename || null,
        reference: payload.paper_reference || null,
        entity_type: payload.entity_type || null,
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
      return null;
    }

    const payload = scrollResult.points[0].payload;

    return {
      reference: payload.paper_reference || null,
      name: payload.entity_name || null,
      paperType: payload.paper_type || null,
      date: payload.date || null,
      oparl_id: payload.entity_id || null,
      pdf_url: payload.pdf_access_url || null,
      file_hash: payload.file_hash || null,
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
      with_payload: [
        'entity_name',
        'paper_reference',
        'paper_type',
        'date',
        'entity_id',
        'pdf_access_url',
        'file_hash',
      ],
    });

    if (!scrollResult.points || scrollResult.points.length === 0) {
      return [];
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
          file_hash: p.file_hash || null,
        });
      }
    });

    return Array.from(papersMap.values());
  } catch (error) {
    throw new Error(`Search papers error: ${error.message}`);
  }
}

async function getDocumentText(env, args) {
  const { file_hash, page } = args;

  // Validate SHA256 format
  if (!file_hash || !/^[a-f0-9]{64}$/i.test(file_hash)) {
    throw new Error('Invalid file_hash: must be a 64-character hex SHA256 hash');
  }

  try {
    // Read from bundled static assets
    const response = await env.ASSETS.fetch(new Request(`http://dummy/text/${file_hash}.txt`));

    if (!response.ok) {
      return `No fulltext available for file hash ${file_hash}. The document may not have been processed yet.`;
    }

    const fullText = await response.text();

    // Split into pages (pages are separated by \n\n in the fulltext)
    // The fulltext.json stores pages separately, and the .txt concatenates them with \n\n
    // We use a page marker format: "--- Page X ---" to split reliably
    const pageMarkerRegex = /^--- Page (\d+) ---$/gm;
    const pages = [];
    let lastIndex = 0;
    let match;

    while ((match = pageMarkerRegex.exec(fullText)) !== null) {
      if (pages.length > 0) {
        pages[pages.length - 1].text = fullText.slice(lastIndex, match.index).trim();
      }
      pages.push({ page: parseInt(match[1]), text: '' });
      lastIndex = match.index + match[0].length;
    }
    if (pages.length > 0) {
      pages[pages.length - 1].text = fullText.slice(lastIndex).trim();
    }

    // If no page markers found, treat entire text as page 1
    if (pages.length === 0) {
      pages.push({ page: 1, text: fullText.trim() });
    }

    const totalPages = pages.length;

    // No page requested: return page 1 + overview
    if (page === undefined || page === null) {
      const firstPage = pages[0];
      if (totalPages === 1) {
        return firstPage.text;
      }
      return `Seite 1 von ${totalPages}:\n\n${firstPage.text}\n\n---\nDieses Dokument hat ${totalPages} Seiten. Nutze den Parameter "page" um weitere Seiten abzurufen (z.B. page=2 oder page="1-5").`;
    }

    // Parse page parameter
    const pageStr = String(page);
    const rangeMatch = pageStr.match(/^(\d+)-(\d+)$/);

    if (rangeMatch) {
      // Page range: "1-5"
      const from = parseInt(rangeMatch[1]);
      const to = parseInt(rangeMatch[2]);
      const selected = pages.filter((p) => p.page >= from && p.page <= to);
      if (selected.length === 0) {
        return `Keine Seiten im Bereich ${from}-${to} gefunden. Das Dokument hat ${totalPages} Seiten.`;
      }
      return selected.map((p) => `--- Seite ${p.page} von ${totalPages} ---\n\n${p.text}`).join('\n\n');
    }

    // Single page number
    const pageNum = parseInt(pageStr);
    const found = pages.find((p) => p.page === pageNum);
    if (!found) {
      return `Seite ${pageNum} nicht gefunden. Das Dokument hat ${totalPages} Seiten (1-${pages[pages.length - 1].page}).`;
    }
    return `Seite ${found.page} von ${totalPages}:\n\n${found.text}`;
  } catch (error) {
    throw new Error(`Get document text error: ${error.message}`);
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

**Links:**

Für jedes Dokument werden zurückgegeben:
- **pdf_url**: Direkter Link zum PDF auf dem Ratsinformationssystem (nordstemmen.ratsinfomanagement.net). Zeige diesen Link dem Nutzer als Quellenangabe.
- **oparl_id**: Link zum OParl-API-Objekt. Nutze ihn um verwandte Dokumente zu finden (weitere Anhänge, zugehörige Meetings).
- **file_hash**: SHA256-Hash des PDFs. Nutze \`get_document_text\` mit diesem Hash um den Volltext abzurufen.`,
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

**Links:** pdf_url zeigt direkt auf das Ratsinformationssystem. Nutze \`get_document_text\` mit dem file_hash für den Volltext.`,
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

**Links:** pdf_url zeigt direkt auf das Ratsinformationssystem. Nutze \`get_document_text\` mit dem file_hash für den Volltext.`,
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
              name: 'get_document_text',
              description: `Ruft den extrahierten Volltext eines Dokuments anhand seines SHA256-Hashes ab.

Nutze dieses Tool, wenn du den kompletten Text eines Dokuments benötigst, z.B. um:
- Den Inhalt eines gefundenen Dokuments vollständig zu lesen
- Detaillierte Fragen zu einem spezifischen Dokument zu beantworten
- Den vollen Kontext eines Suchergebnisses zu erhalten

Der file_hash wird von den anderen Tools (search_documents, get_paper_by_reference, search_papers) im Feld "file_hash" zurückgegeben.

**Hinweis:** Der Volltext ist nur verfügbar, wenn das Dokument bereits verarbeitet wurde. Für sehr alte oder gescannte Dokumente kann der Text unvollständig oder nicht verfügbar sein.`,
              inputSchema: {
                type: 'object',
                properties: {
                  file_hash: {
                    type: 'string',
                    description:
                      'Der SHA256-Hash des Dokuments (64 Zeichen, hexadezimal). Wird von den Such-Tools im Feld "file_hash" zurückgegeben.',
                  },
                  page: {
                    description:
                      'Optionale Seitennummer oder Seitenbereich. Beispiele: 1 (einzelne Seite), "1-5" (Seiten 1 bis 5). Ohne Angabe wird nur Seite 1 zurückgegeben mit Hinweis auf die Gesamtseitenzahl.',
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

        const toolHandlers = {
          search_documents: searchDocuments,
          get_paper_by_reference: getPaperByReference,
          search_papers: searchPapers,
          get_document_text: getDocumentText,
        };

        const handler = toolHandlers[toolName];
        if (!handler) {
          throw new Error(`Unknown tool: ${toolName}`);
        }

        const toolResult = await handler(env, toolArgs);
        result = {
          content: [
            {
              type: 'text',
              text: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
            },
          ],
        };
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
