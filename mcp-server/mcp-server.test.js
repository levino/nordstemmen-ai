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

    const context = { request, env };
    const response = await onRequestPost(context);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.jsonrpc).toBe('2.0');
    expect(data.error).toBeUndefined();
    expect(data.result.content[0].type).toBe('text');

    // Verify search results contain expected fields
    const results = JSON.parse(data.result.content[0].text);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('title');
    expect(results[0]).toHaveProperty('score');
    expect(results[0]).toHaveProperty('page');
  });

  it('should handle batch request', async () => {
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
          method: 'tools/list',
        },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'search_documents',
            arguments: { query: 'Haushalt Nordstemmen', limit: 3 },
          },
        },
      ]),
    });
    const ctx = createExecutionContext();

    const context = { request, env };
    const response = await onRequestPost(context);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);

    // tools/list should succeed
    expect(data[0].error).toBeUndefined();
    const tools = data[0].result.tools;
    expect(tools.length).toBe(4);
    expect(tools.map((t) => t.name)).toContain('get_document_text');

    // get_document_text tool should have page parameter
    const getTextTool = tools.find((t) => t.name === 'get_document_text');
    expect(getTextTool.inputSchema.properties).toHaveProperty('page');

    // search should succeed
    expect(data[1].error).toBeUndefined();
  });
});
