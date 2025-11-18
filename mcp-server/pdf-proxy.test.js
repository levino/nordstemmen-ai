import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getFileNameForHash, onRequestGet, onRequestOptions, authenticateB2 } from './functions/pdf/[[sha256]].js';

const IncomingRequest = Request;

describe('PDF Proxy', () => {
  const TEST_SHA256 = 'd734bbe51962e8b371ce1f90b7ae99963d62261ef305bb63a9644e1ea9064ce6';
  const TEST_FILENAME = 'test-document.pdf';

  describe('getFileNameForHash', () => {
    it('should generate correct filename from SHA256 hash', () => {
      const result = getFileNameForHash(TEST_SHA256);
      const expected = 'd734bbe51962e8b371ce1f90b7ae99963d62261ef305bb63a9644e1ea9064ce6';
      
      expect(result).toBe(expected);
    });

    it('should handle non-string input by converting to string', () => {
      const result = getFileNameForHash(123);
      expect(result).toBe('123');
    });

    it('should handle empty string', () => {
      const result = getFileNameForHash('');
      expect(result).toBe('');
    });
  });

  describe('PDF proxy endpoint', () => {
    it('should reject invalid SHA256 hash', async () => {
      const invalidSha = 'invalid-hash';
      const request = new IncomingRequest(`https://example.com/pdf/${invalidSha}`);
      const ctx = createExecutionContext();
      
      // Mock the context that Cloudflare Pages provides
      const mockContext = {
        request,
        params: { sha256: invalidSha },
        env
      };

      const response = await onRequestGet(mockContext);
      await waitOnExecutionContext(ctx);
      
      expect(response.status).toBe(400);
      const errorText = await response.text();
      expect(errorText).toBe('Invalid SHA256 hash');
    });

    it('should handle missing environment variables gracefully', async () => {
      const request = new IncomingRequest(`https://example.com/pdf/${TEST_SHA256}`);
      const ctx = createExecutionContext();
      
      // Mock context with empty env
      const mockContext = {
        request,
        params: { sha256: TEST_SHA256 },
        env: {} // Missing env vars
      };

      const response = await onRequestGet(mockContext);
      await waitOnExecutionContext(ctx);
      
      expect(response.status).toBe(500);
      const errorText = await response.text();
      expect(errorText).toBe('Missing B2 configuration');
    });

    it('should process valid SHA256 hash correctly', async () => {
      const request = new IncomingRequest(`https://example.com/pdf/${TEST_SHA256}?filename=${TEST_FILENAME}`);
      const ctx = createExecutionContext();
      
      // Mock context with proper env (will use actual env from cloudflare:test)
      const mockContext = {
        request,
        params: { sha256: TEST_SHA256 },
        env
      };

      const response = await onRequestGet(mockContext);
      await waitOnExecutionContext(ctx);
      
      // Must succeed and return a PDF
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/pdf');
      expect(response.headers.get('Content-Disposition')).toContain(TEST_FILENAME);
      
      // Verify cache headers are set
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
      expect(response.headers.get('ETag')).toBe(`"${TEST_SHA256}"`);
      expect(response.headers.get('Last-Modified')).toBeTruthy();
      
      // Verify we actually got PDF content
      const pdfContent = await response.arrayBuffer();
      expect(pdfContent.byteLength).toBeGreaterThan(0);
      
      // Check PDF magic number (PDF files start with %PDF)
      const pdfHeader = new Uint8Array(pdfContent.slice(0, 4));
      const headerString = String.fromCharCode(...pdfHeader);
      expect(headerString).toBe('%PDF');
    });

    it('should handle CORS headers correctly', async () => {
      const ctx = createExecutionContext();
      
      const response = await onRequestOptions();
      await waitOnExecutionContext(ctx);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should add CF-Cache-Status header for debugging', async () => {
      const request = new IncomingRequest(`https://example.com/pdf/${TEST_SHA256}?filename=${TEST_FILENAME}`);
      const ctx = createExecutionContext();
      
      const mockContext = {
        request,
        params: { sha256: TEST_SHA256 },
        env
      };

      const response = await onRequestGet(mockContext);
      await waitOnExecutionContext(ctx);
      
      if (response.status === 200) {
        // Should have cache status header (MISS for first request)
        expect(response.headers.get('CF-Cache-Status')).toBeTruthy();
      }
    });

    it('should NOT have "Invalid URL: undefined" error - this test should FAIL until bug is fixed', async () => {
      const problemSha = 'da0f67eb2b8f35fa809718a147b16d4ef50765e600344b3bd8de5a91bef9cbf6';
      const problemFilename = '2._Finanzbericht_2019.pdf';
      
      const request = new IncomingRequest(
        `https://example.com/pdf/${problemSha}?filename=${encodeURIComponent(problemFilename)}`
      );
      const ctx = createExecutionContext();
      
      const mockContext = {
        request,
        params: { sha256: problemSha },
        env
      };

      const response = await onRequestGet(mockContext);
      await waitOnExecutionContext(ctx);
      
      const responseText = await response.text();
      
      // This test should FAIL if we reproduce the bug
      // The bug is "Invalid URL: undefined/b2api/..."
      expect(responseText).not.toContain('Invalid URL: undefined');
      
      // Also ensure we don't get a 500 error due to undefined apiUrl
      if (response.status === 500) {
        console.log('Got 500 error:', responseText);
        // If it's a 500, it should be for a good reason, not undefined URL
        expect(responseText).not.toMatch(/Invalid URL:.*undefined/);
      }
    });

    it('should test B2 authentication works correctly', async () => {
      const authData = await authenticateB2(env);
      
      // Verify all required fields are present and valid
      expect(authData).toHaveProperty('authorizationToken');
      expect(authData).toHaveProperty('apiUrl');
      expect(authData).toHaveProperty('downloadUrl');
      
      expect(typeof authData.authorizationToken).toBe('string');
      expect(typeof authData.apiUrl).toBe('string');
      expect(typeof authData.downloadUrl).toBe('string');
      
      expect(authData.authorizationToken.length).toBeGreaterThan(0);
      expect(authData.apiUrl).toMatch(/^https:\/\//);
      expect(authData.downloadUrl).toMatch(/^https:\/\//);
    });
  });
});