import { stat as fsStat } from 'node:fs/promises';
import { markCompleted, saveEmbeddings, saveFulltext } from './cache.ts';
import { GEMINI_MODEL } from './config.ts';
import { discoverDocuments, needsProcessing } from './discovery.ts';
import { createJinaClient, type JinaClient } from './jina.ts';
import { ocrPdf } from './ocr.ts';
import { createQdrantService, type QdrantConfig } from './qdrant.ts';
import { withConcurrency } from './retry.ts';
import { computeSparseVector } from './sparse.ts';
import type {
  DocumentInfo,
  EmbeddingsData,
  FileInfo,
  FulltextData,
  MeetingMetadata,
  PaperMetadata,
  PipelineConfig,
  ProcessingResult,
  QdrantPayload,
} from './types.ts';

export interface EnvConfig {
  geminiApiKey: string;
  jinaApiKey: string;
  qdrant: QdrantConfig;
}

async function processFile(
  document: DocumentInfo,
  file: FileInfo,
  config: PipelineConfig,
  geminiApiKey: string,
  jina: JinaClient,
  qdrant: ReturnType<typeof createQdrantService>,
): Promise<ProcessingResult> {
  try {
    // Step 1: OCR via Gemini — always fresh, no cache reuse
    const ocrResult = await ocrPdf(file.pdfPath, geminiApiKey);

    const fulltext: FulltextData = {
      file_hash: file.fileHash,
      filename: file.fileName,
      pages: ocrResult.pages,
      full_text: ocrResult.fullText,
      extraction: {
        model: GEMINI_MODEL,
        prompt: 'page-level OCR',
        extracted_at: new Date().toISOString(),
        total_input_tokens: ocrResult.inputTokens,
        total_output_tokens: ocrResult.outputTokens,
      },
    };

    await saveFulltext(file.pdfPath, fulltext);

    if (!fulltext.pages.length) {
      return { file, status: 'failed', error: 'No text extracted' };
    }

    // Step 2: Generate embeddings via Jina — always fresh
    const pageTexts = fulltext.pages.filter((p) => p.text.trim().length > 0).map((p) => p.text);
    const pageNums = fulltext.pages.filter((p) => p.text.trim().length > 0).map((p) => p.page);

    if (pageTexts.length === 0) {
      return { file, status: 'failed', error: 'No non-empty pages' };
    }

    const vectors = await jina.embed(pageTexts);

    const embeddings: EmbeddingsData = {
      file_hash: file.fileHash,
      filename: file.fileName,
      chunks: pageTexts.map((text, i) => ({
        page: pageNums[i],
        chunk_index: 0,
        text,
        vector: vectors[i],
        sparseVector: computeSparseVector(text),
      })),
    };

    await saveEmbeddings(file.pdfPath, embeddings);

    // Step 3: Upload to Qdrant
    if (!config.skipQdrant) {
      await qdrant.deleteFileChunks(file.relativePath);

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
          sparseVector: c.sparseVector ?? computeSparseVector(c.text),
        })),
        basePayload,
      );
    }

    // Step 4: Mark as completed — ONLY after all steps succeeded
    await markCompleted(file.pdfPath, file.fileHash);

    return { file, status: 'processed', pages: fulltext.pages.length };
  } catch (error) {
    return {
      file,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runPipeline(config: PipelineConfig, env: EnvConfig): Promise<void> {
  console.log('Pipeline starting...\n');

  const qdrant = createQdrantService(env.qdrant);
  const jina = createJinaClient(env.jinaApiKey);

  if (!config.dryRun) {
    if (!config.skipQdrant) {
      await qdrant.ensureCollection();
      console.log('Qdrant collection verified.');
    }
  }

  // Discover documents
  console.log('Discovering documents...');
  const documents = await discoverDocuments(config);
  console.log(`Found ${documents.length} document folders.`);

  // Flatten to file list, filtering PDFs exceeding max size
  const allFilesUnfiltered = documents.flatMap((doc) => doc.files.map((file) => ({ document: doc, file })));

  const allFiles: typeof allFilesUnfiltered = [];
  for (const entry of allFilesUnfiltered) {
    try {
      const stats = await fsStat(entry.file.pdfPath);
      if (stats.size <= config.maxPdfSize) {
        allFiles.push(entry);
      }
    } catch {
      allFiles.push(entry);
    }
  }
  console.log(`Total files: ${allFiles.length}`);

  // Determine which files need processing
  const toProcess: typeof allFiles = [];
  for (const { document, file } of allFiles) {
    if (await needsProcessing(file, config)) {
      toProcess.push({ document, file });
    }
  }

  // Apply limit
  const limited = config.limit > 0 ? toProcess.slice(0, config.limit) : toProcess;
  console.log(`Files to process: ${limited.length} (${allFiles.length - toProcess.length} skipped)\n`);

  if (config.dryRun) {
    for (const { file } of limited) {
      console.log(`  ${file.relativePath}`);
    }
    return;
  }

  if (limited.length === 0) {
    console.log('Nothing to process.');
    return;
  }

  // Process files with concurrency control
  const tasks = limited.map(({ document, file }) => async () => {
    const result = await processFile(document, file, config, env.geminiApiKey, jina, qdrant);

    const icon = result.status === 'processed' ? '+' : result.status === 'skipped' ? '-' : 'X';
    const suffix = result.error ? ` (${result.error})` : result.pages ? ` (${result.pages} pages)` : '';
    console.log(`[${icon}] ${result.file.relativePath}${suffix}`);

    return result;
  });

  const results = await withConcurrency(tasks, config.concurrency);

  // Summary
  const processed = results.filter((r) => r.status === 'processed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;

  console.log('\nDone!');
  console.log(`  Processed: ${processed}`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Failed:    ${failed}`);
}
