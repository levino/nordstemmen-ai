/**
 * Rebuilds Qdrant collection from existing .embeddings.json files.
 * No API calls to Gemini or Jina — just reads cached data and uploads.
 *
 * Usage: node --experimental-strip-types pipeline/src/rebuild-qdrant.ts
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { discoverDocuments } from './discovery.ts';
import { createQdrantService } from './qdrant.ts';
import { withConcurrency } from './retry.ts';
import { readFile } from 'node:fs/promises';
import { parse } from 'node:path';
import type { EmbeddingsData, MeetingMetadata, PaperMetadata, QdrantPayload } from './types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');
loadEnv({ path: join(ROOT_DIR, '.env') });

function required(name: string): string {
  const val = process.env[name];
  if (!val) { console.error(`Missing: ${name}`); process.exit(1); }
  return val;
}

async function loadEmbeddings(pdfPath: string): Promise<EmbeddingsData | null> {
  try {
    const { dir, name } = parse(pdfPath);
    const raw = await readFile(join(dir, `${name}.embeddings.json`), 'utf-8');
    if (raw.startsWith('version https://git-lfs')) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function main() {
  const qdrant = createQdrantService({
    url: required('QDRANT_URL'),
    apiKey: required('QDRANT_API_KEY'),
    port: parseInt(process.env.QDRANT_PORT ?? '443', 10),
    collection: process.env.QDRANT_COLLECTION ?? 'nordstemmen',
  });

  // Drop and recreate
  console.log('Dropping collection...');
  await qdrant.dropCollection();
  await qdrant.ensureCollection();
  console.log('Collection recreated.\n');

  // Discover all documents
  const documents = await discoverDocuments({
    documentsDir: join(ROOT_DIR, 'documents'),
    limit: 0, force: false, dryRun: false, skipQdrant: false,
    concurrency: 1, maxPdfSize: 100 * 1024 * 1024,
  });

  const allFiles = documents.flatMap((doc) => doc.files.map((file) => ({ document: doc, file })));
  console.log(`Found ${allFiles.length} files. Uploading to Qdrant...\n`);

  let uploaded = 0;
  let skipped = 0;

  const tasks = allFiles.map(({ document, file }) => async () => {
    const embeddings = await loadEmbeddings(file.pdfPath);
    if (!embeddings || embeddings.chunks.length === 0) {
      skipped++;
      return;
    }

    const meta = document.metadata;
    const basePayload: Omit<QdrantPayload, 'page' | 'chunk_index' | 'text'> = {
      filename: file.relativePath,
      file_hash: file.fileHash,
      source: 'oparl',
      entity_type: document.entityType,
      entity_id: meta.id,
      entity_name: meta.name ?? '',
      date: (meta as PaperMetadata).date ?? (meta as MeetingMetadata).start?.split('T')[0] ?? '',
      file_type: file.fileType,
      file_id: file.fileId,
      pdf_access_url: file.accessUrl,
      pdf_download_url: file.downloadUrl,
      ...(document.entityType === 'paper'
        ? {
            paper_reference: (meta as PaperMetadata).reference ?? '',
            paper_type: (meta as PaperMetadata).paperType ?? '',
          }
        : {}),
    };

    await qdrant.upsertChunks(
      embeddings.chunks.map((c) => ({
        page: c.page,
        chunkIndex: c.chunk_index,
        text: c.text,
        vector: c.vector,
      })),
      basePayload,
    );

    uploaded++;
    if (uploaded % 100 === 0) console.log(`  ${uploaded} uploaded...`);
  });

  await withConcurrency(tasks, 20);

  console.log(`\nDone! Uploaded: ${uploaded}, Skipped: ${skipped}`);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
