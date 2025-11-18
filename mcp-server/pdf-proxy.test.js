import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getFileNameForHash, onRequestGet } from './functions/pdf/[[sha256]].js';

const IncomingRequest = Request;

describe('PDF Proxy', () => {
  const TEST_SHA256 = 'd734bbe51962e8b371ce1f90b7ae99963d62261ef305bb63a9644e1ea9064ce6';
  const TEST_FILENAME = 'test-document.pdf';

  describe('getFileNameForHash', () => {
    it('should generate correct LFS filename from SHA256 hash', () => {
      const result = getFileNameForHash(TEST_SHA256);
      const expected = 'lfs/objects/d7/34bbe51962e8b371ce1f90b7ae99963d62261ef305bb63a9644e1ea9064ce6';
      
      expect(result).toBe(expected);
    });

    it('should handle non-string input by converting to string', () => {
      const result = getFileNameForHash(123);
      expect(result).toBe('lfs/objects/12/3');
    });

    it('should handle empty string', () => {
      const result = getFileNameForHash('');
      expect(result).toBe('lfs/objects//');
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
      
      // Should either succeed (200) or file not found (404), or missing config (500)
      // but not fail due to parameter parsing issues
      expect([200, 404, 500]).toContain(response.status);
      
      if (response.status === 200) {
        expect(response.headers.get('Content-Type')).toBe('application/pdf');
        expect(response.headers.get('Content-Disposition')).toContain(TEST_FILENAME);
      }
    });

    it('should handle CORS headers correctly', async () => {
      const ctx = createExecutionContext();
      
      // Test importing OPTIONS handler - should be available
      const { onRequestOptions } = await import('./functions/pdf/[[sha256]].js');
      const response = await onRequestOptions();
      await waitOnExecutionContext(ctx);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });
});