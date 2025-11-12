import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { rm, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runScraper } from '../scraper.js';

const TEST_DIR = join(process.cwd(), '.test-downloads');

describe('Scraper Integration Tests', () => {
  beforeEach(async () => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true });
    }
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Clean up after tests
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true });
    }
  });

  it('should download PDFs and create metadata', async () => {
    const program = runScraper({
      documentsDir: TEST_DIR,
    });

    // Run scraper (will download all files - takes a while!)
    await Effect.runPromise(program);

    // Check that files were downloaded
    const files = readdirSync(TEST_DIR);
    const pdfs = files.filter((f) => f.endsWith('.pdf'));

    expect(pdfs.length).toBeGreaterThan(0);

    // Check metadata.json exists
    expect(files).toContain('metadata.json');
  }, 300000); // 5 minute timeout - downloads many files

  it('should skip already downloaded files on second run', async () => {
    // First run
    const program1 = runScraper({
      documentsDir: TEST_DIR,
    });
    await Effect.runPromise(program1);

    const filesAfterFirst = readdirSync(TEST_DIR);
    const pdfsAfterFirst = filesAfterFirst.filter((f) => f.endsWith('.pdf'));

    // Second run
    const program2 = runScraper({
      documentsDir: TEST_DIR,
    });
    await Effect.runPromise(program2);

    const filesAfterSecond = readdirSync(TEST_DIR);
    const pdfsAfterSecond = filesAfterSecond.filter((f) => f.endsWith('.pdf'));

    // Should have same number of files (nothing new downloaded)
    expect(pdfsAfterSecond.length).toBe(pdfsAfterFirst.length);
  }, 600000); // 10 minute timeout
});
