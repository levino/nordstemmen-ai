import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { onRequestPost } from './functions/mcp.js';

const IncomingRequest = Request;

// Tests that hit Qdrant + Jina need real credentials (e.g. via .dev.vars)
const hasSearchBackend = Boolean(env.JINA_API_KEY && env.QDRANT_URL);

// ---------------------------------------------------------------------------
// Meeting fixtures (same format as build-meetings.js output)
// ---------------------------------------------------------------------------

const HASH_INVITATION = 'a'.repeat(64);
const HASH_PAPER = 'b'.repeat(64);

const meetingIndex = [
  {
    id: '5424',
    name: 'Ortsrat Mahlerten (8. Sitzung)',
    start: '2024-02-06T18:00:00+01:00',
    location: 'Dorfgemeinschaftshaus Mahlerten',
    agenda_items: 2,
    has_invitation: true,
    has_protocol: true,
  },
  {
    id: '5786',
    name: 'Rat (33. Sitzung)',
    start: '2026-09-29T18:30:00+02:00',
    location: 'Rathaus, Rathausstraße 3, 31171 Nordstemmen, Sitzungszimmer',
    agenda_items: 3,
    has_invitation: true,
    has_protocol: false,
  },
  {
    id: '5790',
    name: 'Ortsrat Rössing (20. Sitzung)',
    start: '2026-09-29T19:00:00+02:00',
    location: 'Dorfgemeinschaftshaus Rössing',
    agenda_items: 0,
    has_invitation: false,
    has_protocol: false,
  },
];

const meetingDetails = {
  5786: {
    id: '5786',
    oparl_id: 'https://nordstemmen.ratsinfomanagement.net/webservice/oparl/v1.1/body/1/meeting/5786',
    name: 'Rat (33. Sitzung)',
    start: '2026-09-29T18:30:00+02:00',
    end: null,
    cancelled: false,
    location: 'Rathaus, Rathausstraße 3, 31171 Nordstemmen, Sitzungszimmer',
    agenda: [
      { number: '1', name: 'Eröffnung der Sitzung', public: true },
      {
        number: '2',
        name: 'Haushaltssatzung 2027',
        public: true,
        result: 'Einstimmig lt. Beschlussvorschlag',
        paper: {
          reference: 'DS 42/2026',
          name: 'Haushaltssatzung 2027',
          paper_type: 'Beschlussvorlage',
          oparl_id: 'https://nordstemmen.ratsinfomanagement.net/webservice/oparl/v1.1/body/1/paper/9999',
          pdf_url: 'https://example.com/ds42.pdf',
          file_hash: HASH_PAPER,
        },
      },
      { number: '3', name: 'Grundstücksangelegenheiten', public: false },
    ],
    files: [
      {
        role: 'invitation',
        name: 'Bekanntmachung (Rat)',
        pdf_url: 'https://example.com/einladung.pdf',
        file_hash: HASH_INVITATION,
        text_available: true,
      },
    ],
    alternative_versions: [{ name: 'Rat (26. Sitzung)', start: '2026-09-29T18:30:00+02:00' }],
  },
};

const fakeAssets = {
  async fetch(request) {
    const match = new URL(request.url).pathname.match(/^\/meetings\/(\w+)\.json$/);
    if (!match) return new Response('Not found', { status: 404 });
    const body = match[1] === 'index' ? meetingIndex : meetingDetails[match[1]];
    if (!body) return new Response('Not found', { status: 404 });
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  },
};

const meetingEnv = { ...env, ASSETS: fakeAssets };

async function callMcp(body, testEnv = meetingEnv) {
  const request = new IncomingRequest('https://example.com/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const response = await onRequestPost({ request, env: testEnv });
  expect(response.status).toBe(200);
  return response.json();
}

async function callTool(name, args) {
  const data = await callMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  return data;
}

function parseToolText(data) {
  expect(data.error).toBeUndefined();
  const text = data.result.content[0].text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

describe('MCP Server – tools/list', () => {
  it('should list all six tools', async () => {
    const data = await callMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(data.error).toBeUndefined();
    const names = data.result.tools.map((t) => t.name);
    expect(names).toEqual([
      'search_documents',
      'get_paper_by_reference',
      'search_papers',
      'get_document_text',
      'list_meetings',
      'get_meeting',
    ]);

    const getTextTool = data.result.tools.find((t) => t.name === 'get_document_text');
    expect(getTextTool.inputSchema.properties).toHaveProperty('page');

    const listTool = data.result.tools.find((t) => t.name === 'list_meetings');
    expect(Object.keys(listTool.inputSchema.properties)).toEqual(
      expect.arrayContaining(['date_from', 'date_to', 'name_contains', 'limit']),
    );
    const getTool = data.result.tools.find((t) => t.name === 'get_meeting');
    expect(Object.keys(getTool.inputSchema.properties)).toEqual(
      expect.arrayContaining(['id', 'date', 'name_contains']),
    );
  });
});

describe('MCP Server – meeting tools', () => {
  it('list_meetings filters by date range and sorts chronologically', async () => {
    const result = parseToolText(await callTool('list_meetings', { date_from: '2026-09-01', date_to: '2026-09-30' }));
    expect(result.total).toBe(2);
    expect(result.meetings.map((m) => m.id)).toEqual(['5786', '5790']);
    expect(result.meetings[0]).toMatchObject({ agenda_items: 3, has_invitation: true, has_protocol: false });
  });

  it('list_meetings filters by name (case-insensitive) and defaults to newest first', async () => {
    const result = parseToolText(await callTool('list_meetings', { name_contains: 'ORTSRAT' }));
    expect(result.meetings.map((m) => m.id)).toEqual(['5790', '5424']);
  });

  it('list_meetings respects limit and reports total', async () => {
    const result = parseToolText(await callTool('list_meetings', { limit: 1, order: 'asc' }));
    expect(result.total).toBe(3);
    expect(result.returned).toBe(1);
    expect(result.meetings[0].id).toBe('5424');
  });

  it('list_meetings rejects invalid dates', async () => {
    const data = await callTool('list_meetings', { date_from: '29.09.2026' });
    expect(data.error).toBeDefined();
    expect(data.error.message).toMatch(/date_from/);
  });

  it('get_meeting returns full agenda by id', async () => {
    const meeting = parseToolText(await callTool('get_meeting', { id: '5786' }));
    expect(meeting.name).toBe('Rat (33. Sitzung)');
    expect(meeting.agenda).toHaveLength(3);
    expect(meeting.agenda[1].paper.reference).toBe('DS 42/2026');
    expect(meeting.agenda[1].paper.file_hash).toBe(HASH_PAPER);
    expect(meeting.agenda[2].public).toBe(false);
    expect(meeting.files[0]).toMatchObject({ role: 'invitation', file_hash: HASH_INVITATION });
  });

  it('get_meeting accepts an OParl meeting URL as id', async () => {
    const meeting = parseToolText(
      await callTool('get_meeting', {
        id: 'https://nordstemmen.ratsinfomanagement.net/webservice/oparl/v1.1/body/1/meeting/5786',
      }),
    );
    expect(meeting.id).toBe('5786');
  });

  it('get_meeting resolves date + name_contains', async () => {
    const meeting = parseToolText(await callTool('get_meeting', { date: '2026-09-29', name_contains: 'rat (' }));
    expect(meeting.id).toBe('5786');
    expect(meeting.agenda.length).toBe(3);
  });

  it('get_meeting returns candidates when a date is ambiguous', async () => {
    const result = parseToolText(await callTool('get_meeting', { date: '2026-09-29' }));
    expect(result.candidates.map((m) => m.id)).toEqual(['5786', '5790']);
  });

  it('get_meeting reports unknown meetings', async () => {
    const byDate = parseToolText(await callTool('get_meeting', { date: '2020-01-01' }));
    expect(byDate).toMatch(/Keine Sitzung/);
    const byId = parseToolText(await callTool('get_meeting', { id: '1' }));
    expect(byId).toMatch(/Keine Sitzung/);
  });

  it('get_meeting rejects invalid ids', async () => {
    const data = await callTool('get_meeting', { id: '../text/abc' });
    expect(data.error.message).toMatch(/Invalid id/);
  });
});

describe('MCP Server – search (requires Qdrant + Jina credentials)', () => {
  it.skipIf(!hasSearchBackend)('should handle single search_documents call', async () => {
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

  it.skipIf(!hasSearchBackend)('should handle batch request', async () => {
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
    expect(tools.length).toBe(6);
    expect(tools.map((t) => t.name)).toContain('get_document_text');

    // get_document_text tool should have page parameter
    const getTextTool = tools.find((t) => t.name === 'get_document_text');
    expect(getTextTool.inputSchema.properties).toHaveProperty('page');

    // search should succeed
    expect(data[1].error).toBeUndefined();
  });
});
