import { Effect, pipe } from 'effect';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fetchAllFiles, downloadFile } from './client.ts';
import type { OParlFile } from './schema.ts';
import type { DocumentMetadata } from './schema.ts';

export interface ScraperConfig {
  documentsDir: string;
  metadataFile?: string;
}

/**
 * Load existing metadata
 */
const loadMetadata = (metadataFile: string): Effect.Effect<Record<string, DocumentMetadata>, never> =>
  existsSync(metadataFile)
    ? pipe(
        Effect.tryPromise({
          try: async () => JSON.parse(await readFile(metadataFile, 'utf-8')),
          catch: () => ({}),
        })
      )
    : Effect.succeed({});

/**
 * Save metadata
 */
const saveMetadata = (
  metadataFile: string,
  metadata: Record<string, DocumentMetadata>
): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(metadataFile), { recursive: true });
      await writeFile(metadataFile, JSON.stringify(metadata, null, 2), 'utf-8');
    },
    catch: (error) => new Error(`Failed to save metadata: ${error}`),
  });

/**
 * Truncate filename to fit filesystem limits (200 chars to be safe)
 */
const truncateFilename = (filename: string, maxLength: number = 200): string => {
  if (filename.length <= maxLength) return filename;

  const extension = '.pdf';
  const maxBaseLength = maxLength - extension.length;
  return filename.slice(0, maxBaseLength) + extension;
};

/**
 * Generate filename and year folder from file metadata
 */
const generateFilePath = (file: OParlFile): { year: string; filename: string } => {
  const datePart = file.date
    ? (() => {
        try {
          const date = new Date(file.date);
          return {
            year: date.getFullYear().toString(),
            part: date.toISOString().split('T')[0],
          };
        } catch {
          return null;
        }
      })()
    : null;

  const namePart = file.name
    ?.replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_');

  const parts = [datePart?.part, namePart].filter(Boolean);

  const filename = parts.length > 0
    ? `${parts.join('_')}.pdf`
    : `file_${file.id.split('/').pop() || 'unknown'}.pdf`;

  return {
    year: datePart?.year || 'unknown',
    filename: truncateFilename(filename),
  };
};

/**
 * Find unique filename by checking for collisions
 */
const findUniqueFilename = (yearDir: string, baseFilename: string): string => {
  const tryFilename = (name: string, counter: number): string =>
    existsSync(join(yearDir, name))
      ? tryFilename(`${baseFilename.replace('.pdf', '')}_${counter}.pdf`, counter + 1)
      : name;

  return tryFilename(baseFilename, 1);
};

/**
 * Process a single file
 */
const processFile = (
  file: OParlFile,
  config: ScraperConfig,
  metadata: Record<string, DocumentMetadata>
): Effect.Effect<{ downloaded: boolean; skipped: boolean; error: boolean }, never> => {
  // Already processed?
  if (metadata[file.id]) {
    console.log(`⊘ Skipping: ${file.name || file.id}`);
    return Effect.succeed({ downloaded: false, skipped: true, error: false });
  }

  // Only PDFs
  if (!file.mimeType?.toLowerCase().includes('pdf')) {
    return Effect.succeed({ downloaded: false, skipped: true, error: false });
  }

  // Need URL
  const url = file.accessUrl || file.downloadUrl;
  if (!url) {
    return Effect.succeed({ downloaded: false, skipped: true, error: false });
  }

  const { year, filename: baseFilename } = generateFilePath(file);
  const yearDir = join(config.documentsDir, year);
  const filename = findUniqueFilename(yearDir, baseFilename);
  const relativePath = join(year, filename);
  const filepath = join(config.documentsDir, relativePath);

  return pipe(
    downloadFile(url),
    Effect.either,
    Effect.flatMap((downloadResult) =>
      downloadResult._tag === 'Left'
        ? pipe(
            Effect.sync(() => {
              console.error(`✗ Error downloading ${file.name || file.id}: ${downloadResult.left.message}`);
            }),
            Effect.map(() => ({ downloaded: false, skipped: false, error: true }))
          )
        : pipe(
            Effect.tryPromise({
              try: async () => {
                await mkdir(yearDir, { recursive: true });
                await writeFile(filepath, Buffer.from(downloadResult.right));
              },
              catch: (error) => new Error(`Failed to save file: ${error}`),
            }),
            Effect.either,
            Effect.flatMap((saveResult) =>
              saveResult._tag === 'Left'
                ? pipe(
                    Effect.sync(() => {
                      console.error(`✗ Error saving ${relativePath}: ${saveResult.left.message}`);
                    }),
                    Effect.map(() => ({ downloaded: false, skipped: false, error: true }))
                  )
                : pipe(
                    Effect.sync(() => {
                      console.log(`✓ Downloaded: ${relativePath}`);
                      metadata[file.id] = {
                        oparl_id: file.id,
                        filename: relativePath,
                        access_url: url,
                        mime_type: file.mimeType,
                        name: file.name,
                        date: file.date,
                        downloaded_at: new Date().toISOString(),
                      };
                    }),
                    Effect.map(() => ({ downloaded: true, skipped: false, error: false }))
                  )
            )
          )
    )
  );
};

/**
 * Count results
 */
const countResults = (results: Array<{ downloaded: boolean; skipped: boolean; error: boolean }>) =>
  results.reduce(
    (acc, result) => ({
      downloaded: acc.downloaded + (result.downloaded ? 1 : 0),
      skipped: acc.skipped + (result.skipped ? 1 : 0),
      errors: acc.errors + (result.error ? 1 : 0),
    }),
    { downloaded: 0, skipped: 0, errors: 0 }
  );

/**
 * Run the scraper with parallel downloads
 */
export const runScraper = (config: ScraperConfig): Effect.Effect<void, Error> =>
  pipe(
    Effect.sync(() => config.metadataFile || join(config.documentsDir, 'metadata.json')),
    Effect.tap(() => Effect.sync(() => console.log('🚀 Starting scraper...\n'))),
    Effect.flatMap((metadataFile) =>
      pipe(
        loadMetadata(metadataFile),
        Effect.tap((metadata) =>
          Effect.sync(() =>
            console.log(`📋 Loaded metadata for ${Object.keys(metadata).length} existing files\n`)
          )
        ),
        Effect.tap(() => Effect.sync(() => console.log('📡 Fetching file list from OParl API...'))),
        Effect.flatMap((metadata) =>
          pipe(
            fetchAllFiles(),
            Effect.tap((files) =>
              Effect.sync(() => console.log(`📚 Found ${files.length} files\n`))
            ),
            Effect.tap(() =>
              Effect.sync(() => console.log('⚡ Processing with 64 parallel downloads...\n'))
            ),
            Effect.flatMap((files) =>
              pipe(
                Effect.all(
                  files.map((file) => processFile(file, config, metadata)),
                  { concurrency: 64 }
                ),
                Effect.map(countResults),
                Effect.tap((counts) =>
                  counts.downloaded > 0
                    ? saveMetadata(metadataFile, metadata)
                    : Effect.void
                ),
                Effect.tap((counts) =>
                  Effect.sync(() => {
                    console.log('\n✅ Scraping completed!');
                    console.log(`   Downloaded: ${counts.downloaded}`);
                    console.log(`   Skipped: ${counts.skipped}`);
                    console.log(`   Errors: ${counts.errors}`);
                  })
                )
              )
            )
          )
        ),
        Effect.asVoid
      )
    )
  );
