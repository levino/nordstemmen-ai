import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { fetchAllFiles, downloadFile, FILE_LIST_URL } from '../client.js';

/**
 * Real integration tests - no mocks!
 * These tests actually call the Nordstemmen OParl API
 */

describe('OParl Client Integration Tests', () => {
  it('should fetch file list from real API', async () => {
    const program = fetchAllFiles();
    const files = await Effect.runPromise(program);

    // We should get some files
    expect(files.length).toBeGreaterThan(0);

    // Check first file has expected structure
    const firstFile = files[0];
    expect(firstFile).toBeDefined();
    expect(firstFile.id).toBeDefined();
    expect(typeof firstFile.id).toBe('string');
  });

  it('should fetch files with PDF mime type', async () => {
    const program = fetchAllFiles();
    const files = await Effect.runPromise(program);

    // Filter PDFs
    const pdfs = files.filter((f) => f.mimeType?.toLowerCase().includes('pdf'));

    // Should have many PDFs
    expect(pdfs.length).toBeGreaterThan(100);
  });

  it('should have accessUrl or downloadUrl on files', async () => {
    const program = fetchAllFiles();
    const files = await Effect.runPromise(program);

    // Take first 10 files
    const sample = files.slice(0, 10);

    for (const file of sample) {
      const hasUrl = Boolean(file.accessUrl || file.downloadUrl);
      expect(hasUrl).toBe(true);
    }
  });

  it('should download a PDF file', async () => {
    // First get a file
    const filesProgram = fetchAllFiles();
    const files = await Effect.runPromise(filesProgram);

    // Find first PDF with URL
    const pdfFile = files.find(
      (f) => f.mimeType?.toLowerCase().includes('pdf') && (f.accessUrl || f.downloadUrl)
    );

    expect(pdfFile).toBeDefined();

    const url = pdfFile!.accessUrl || pdfFile!.downloadUrl;
    const downloadProgram = downloadFile(url!);
    const buffer = await Effect.runPromise(downloadProgram);

    // Should get some data
    expect(buffer.byteLength).toBeGreaterThan(0);

    // PDF files start with %PDF
    const bytes = new Uint8Array(buffer.slice(0, 4));
    const header = String.fromCharCode(...bytes);
    expect(header).toBe('%PDF');
  }, 30000); // 30s timeout for download

  it('should handle pagination correctly', async () => {
    // Just verify we can fetch without errors
    const program = fetchAllFiles();
    const files = await Effect.runPromise(program);

    // We know there are many files, should handle multiple pages
    expect(files.length).toBeGreaterThan(25); // More than one page
  });
});
