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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'test_embedding',
          arguments: { query: 'test' }
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
});
