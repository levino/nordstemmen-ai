import { stat as fsStat, readFile } from 'node:fs/promises';
import { type B2Config, createB2Service } from './b2.ts';
import { loadEmbeddings, loadFulltext, markCompleted, saveEmbeddings, saveFulltext } from './cache.ts';
import { GEMINI_MODEL } from './config.ts';
import { discoverDocuments, needsProcessing } from './discovery.ts';
import { createJinaClient, type JinaClient } from './jina.ts';
import { ocrPdf } from './ocr.ts';
import { createQdrantService, type QdrantConfig } from './qdrant.ts';
import { withConcurrency } from './retry.ts';
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
  b2: B2Config;
}

async function processFile(
  document: DocumentInfo,
  file: FileInfo,
  config: PipelineConfig,
  geminiApiKey: string,
  jina: JinaClient,
  qdrant: ReturnType<typeof createQdrantService>,
  b2: ReturnType<typeof createB2Service>,
): Promise<ProcessingResult> {
  try {
    // Step 1: OCR via Gemini (or reuse existing fulltext cache)
    let fulltext = await loadFulltext(file.pdfPath, file.fileHash);

    if (!fulltext) {
      const ocrResult = await ocrPdf(file.pdfPath, geminiApiKey);

      const fulltextData: FulltextData = {
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

      await saveFulltext(file.pdfPath, fulltextData);
      fulltext = fulltextData;
    }

    if (!fulltext.pages.length) {
      return { file, status: 'failed', error: 'No text extracted' };
    }

    // Step 2: Generate embeddings via Jina (or reuse existing cache)
    let embeddings = await loadEmbeddings(file.pdfPath, file.fileHash);

    if (!embeddings) {
      const pageTexts = fulltext.pages.filter((p) => p.text.trim().length > 0).map((p) => p.text);
      const pageNums = fulltext.pages.filter((p) => p.text.trim().length > 0).map((p) => p.page);

      if (pageTexts.length === 0) {
        return { file, status: 'failed', error: 'No non-empty pages' };
      }

      const vectors = await jina.embed(pageTexts);

      const embeddingsData: EmbeddingsData = {
        file_hash: file.fileHash,
        filename: file.fileName,
        chunks: pageTexts.map((text, i) => ({
          page: pageNums[i],
          chunk_index: 0,
          text,
          vector: vectors[i],
        })),
      };

      await saveEmbeddings(file.pdfPath, embeddingsData);
      embeddings = embeddingsData;
    }

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
        })),
        basePayload,
      );
    }

    // Step 4: Upload to B2
    if (!config.skipB2) {
      const pdfExists = await b2.fileExists(file.fileHash);
      if (!pdfExists) {
        const pdfData = await readFile(file.pdfPath);
        await b2.uploadFile(file.fileHash, pdfData, 'application/pdf');
      }

      const textName = `${file.fileHash}.txt`;
      const textExists = await b2.fileExists(textName);
      if (!textExists && fulltext.pages.length > 0) {
        const textContent = fulltext.pages.map((p) => `--- Page ${p.page} ---\n${p.text}`).join('\n\n');
        await b2.uploadFile(textName, Buffer.from(textContent, 'utf-8'), 'text/plain; charset=utf-8');
      }
    }

    // Step 5: Mark as completed — ONLY after all steps succeeded
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
  const b2 = createB2Service(env.b2);
  const jina = createJinaClient(env.jinaApiKey);

  if (!config.dryRun) {
    if (!config.skipQdrant) {
      await qdrant.ensureCollection();
      console.log('Qdrant collection verified.');
    }

    if (!config.skipB2) {
      await b2.authorize();
      console.log('B2 authorized.');
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
    const result = await processFile(document, file, config, env.geminiApiKey, jina, qdrant, b2);

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
