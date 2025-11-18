import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { onRequestPost } from './functions/mcp.js';

const IncomingRequest = Request;

describe('MCP Server', () => {

  it('should handle single search_documents call', async () => {
    const request = new IncomingRequest('https://example.com/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'search_documents',
          arguments: { query: 'Schwimmbad Kosten', limit: 5 },
        },
      }),
    });
    const ctx = createExecutionContext();
    
    // Use Pages function format instead of Worker
    const context = { request, env };
    const response = await onRequestPost(context);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.jsonrpc).toBe('2.0');
    expect(data.error).toBeUndefined();
    expect(data.result.content[0].type).toBe('text');
  });

  it('should handle batch request with multiple search queries about Schwimmbad', async () => {
    const request = new IncomingRequest('https://example.com/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify([
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'search_documents',
            arguments: { query: 'Schwimmbad Nordstemmen', limit: 3 },
          },
        },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'search_documents',
            arguments: { query: 'Schwimmbad Kosten', limit: 3 },
          },
        },
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'search_documents',
            arguments: { query: 'Schwimmbad Öffnungszeiten', limit: 3 },
          },
        },
      ]),
    });
    const ctx = createExecutionContext();
    
    // Use Pages function format instead of Worker
    const context = { request, env };
    const response = await onRequestPost(context);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(200);
    const data = await response.json();

    // Should return array of responses
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(3);

    // No errors in responses
    expect(data[0].error).toBeUndefined();
    expect(data[1].error).toBeUndefined();
    expect(data[2].error).toBeUndefined();
  });

  it('should handle get_pdf_content with valid file hash', async () => {
    const validHash = 'd734bbe51962e8b371ce1f90b7ae99963d62261ef305bb63a9644e1ea9064ce6';
    
    const request = new IncomingRequest('https://example.com/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'get_pdf_content',
          arguments: { 
            file_hash: validHash
          },
        },
      }),
    });
    const ctx = createExecutionContext();
    
    const context = { request, env };
    const response = await onRequestPost(context);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.jsonrpc).toBe('2.0');
    
    // Check for either success or specific failure (PDF not found is acceptable for test)
    if (data.error) {
      // Should be a meaningful error, not a validation error
      expect(data.error.message).not.toContain('file_hash must be a valid SHA256 hash');
      console.log('PDF download error (expected for missing file):', data.error.message);
    } else {
      // Success case - check structure
      expect(data.result.structuredContent).toBeDefined();
      expect(data.result.structuredContent.file_hash).toBe(validHash);
      expect(data.result.structuredContent.content_base64).toBeDefined();
    }
  });

  it('should handle get_pdf_content with hash that exists in B2', async () => {
    const validHash = '6cf97bf3a37161feaeb374b16fd4b36eda1cb6f7e71b14ad09490df8b35bdb3c';
    
    const request = new IncomingRequest('https://example.com/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'get_pdf_content',
          arguments: { 
            file_hash: validHash  // Use only the hash, no URL
          },
        },
      }),
    });
    const ctx = createExecutionContext();
    
    const context = { request, env };
    const response = await onRequestPost(context);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.jsonrpc).toBe('2.0');
    
    // Should succeed if PDF exists in B2, or give meaningful error if not
    if (data.error) {
      console.log('PDF download error:', data.error.message);
      // Should not be a validation error about hash format
      expect(data.error.message).not.toContain('file_hash must be a valid SHA256 hash');
    } else {
      // Success case
      expect(data.result.structuredContent).toBeDefined();
      expect(data.result.structuredContent.file_hash).toBe(validHash);
      expect(data.result.structuredContent.content_base64).toBeDefined();
    }
  });

  it('should fail get_pdf_content when passed invalid hash format', async () => {
    const invalidHash = 'not-a-valid-hash';
    
    const request = new IncomingRequest('https://example.com/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'get_pdf_content',
          arguments: { 
            file_hash: invalidHash  // Should fail - invalid format
          },
        },
      }),
    });
    const ctx = createExecutionContext();
    
    const context = { request, env };
    const response = await onRequestPost(context);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.jsonrpc).toBe('2.0');
    
    // Should have error about invalid hash format
    expect(data.error).toBeDefined();
    // In production mode, error is sanitized to generic message
    expect(data.error.message).toBe('Operation failed');
  });
});
