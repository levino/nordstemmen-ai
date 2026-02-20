/**
 * One-time migration: rebuild Qdrant collection with named vectors (dense + sparse).
 *
 * Reads existing .embeddings.json and .fulltext.json caches — no Gemini or Jina API calls.
 * Only computes sparse vectors locally and re-uploads everything to Qdrant.
 *
 * Usage: node --experimental-strip-types src/migrate-sparse.ts
 * Delete this file after migration is complete.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { embeddingsPath } from './cache.ts';
import { discoverDocuments } from './discovery.ts';
import { createQdrantService } from './qdrant.ts';
import { withConcurrency } from './retry.ts';
import { computeSparseVector } from './sparse.ts';
import type { DocumentInfo, EmbeddingsData, FileInfo, MeetingMetadata, PaperMetadata, QdrantPayload } from './types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');
const DOCUMENTS_DIR = join(ROOT_DIR, 'documents');

loadEnv({ path: join(ROOT_DIR, '.env') });

function required(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return val;
}

async function loadEmbeddings(pdfPath: string, expectedHash: string): Promise<EmbeddingsData | null> {
  try {
    const raw = await readFile(embeddingsPath(pdfPath), 'utf-8');
    const data: EmbeddingsData = JSON.parse(raw);
    if (data.file_hash === expectedHash && data.chunks?.length > 0) return data;
  } catch {}
  return null;
}

async function migrateFile(
  document: DocumentInfo,
  file: FileInfo,
  qdrant: ReturnType<typeof createQdrantService>,
): Promise<'ok' | 'skipped' | 'failed'> {
  const embeddings = await loadEmbeddings(file.pdfPath, file.fileHash);
  if (!embeddings) return 'skipped';

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
      sparseVector: computeSparseVector(c.text),
    })),
    basePayload,
  );

  return 'ok';
}

async function main() {
  const qdrant = createQdrantService({
    url: required('QDRANT_URL'),
    apiKey: required('QDRANT_API_KEY'),
    port: parseInt(process.env.QDRANT_PORT ?? '443', 10),
    collection: process.env.QDRANT_COLLECTION ?? 'nordstemmen',
  });

  // Drop old collection and create new one with named vectors
  console.log('Dropping old collection...');
  await qdrant.dropCollection();
  console.log('Creating new collection with named vectors (dense + sparse)...');
  await qdrant.ensureCollection();

  // Discover all documents
  console.log('Discovering documents...');
  const documents = await discoverDocuments({
    documentsDir: DOCUMENTS_DIR,
    limit: 0,
    force: false,
    dryRun: false,
    skipQdrant: false,
    concurrency: 10,
    maxPdfSize: Number.MAX_SAFE_INTEGER,
  });

  const allFiles = documents.flatMap((doc) => doc.files.map((file) => ({ document: doc, file })));
  console.log(`Found ${allFiles.length} files to migrate.\n`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  const tasks = allFiles.map(({ document, file }) => async () => {
    try {
      const result = await migrateFile(document, file, qdrant);
      if (result === 'ok') {
        ok++;
        if (ok % 100 === 0) console.log(`  ... ${ok} uploaded`);
      } else {
        skipped++;
      }
    } catch (error) {
      failed++;
      console.error(`[X] ${file.relativePath}: ${error instanceof Error ? error.message : error}`);
    }
  });

  await withConcurrency(tasks, 10);

  console.log(`\nMigration done!`);
  console.log(`  Uploaded: ${ok}`);
  console.log(`  Skipped (no cache): ${skipped}`);
  console.log(`  Failed: ${failed}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
