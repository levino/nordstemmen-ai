import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from './_worker.js';

const IncomingRequest = Request;

describe('MCP Worker', () => {
  it('should respond to GET /', async () => {
    const request = new IncomingRequest('https://example.com/')
    const ctx = createExecutionContext()
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.name).toBe('nordstemmen-mcp-server');
  });

  it('should handle test_embedding tool call', async () => {
    const request = new IncomingRequest('https://example.com/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'test_embedding',
          arguments: { query: 'Schwimmbad Kosten' }
        }
      })
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.jsonrpc).toBe('2.0');
    expect(data.result.content[0].type).toBe('text');
    const embeddingData = JSON.parse(data.result.content[0].text);
    expect(embeddingData.isArray).toBe(true);
    expect(embeddingData.length).toBe(384);
  });

  it('should handle batch request with multiple search queries about Schwimmbad', async () => {
    const request = new IncomingRequest('https://example.com/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify([
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'search_documents',
            arguments: { query: 'Schwimmbad Nordstemmen', limit: 3 }
          }
        },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'search_documents',
            arguments: { query: 'Schwimmbad Kosten', limit: 3 }
          }
        },
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'search_documents',
            arguments: { query: 'Schwimmbad Öffnungszeiten', limit: 3 }
          }
        }
      ])
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
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
});
