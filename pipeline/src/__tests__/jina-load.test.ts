/**
 * Jina API load test — verifies concurrency limits and throughput.
 *
 * NOT part of the normal test suite. Run explicitly:
 *   JINA_API_KEY=... npx vitest run src/__tests__/jina-load.test.ts
 */
import { describe, expect, it } from 'vitest';
import { JINA_API_URL, JINA_MODEL } from '../config.ts';

const JINA_API_KEY = process.env.JINA_API_KEY ?? '';

// Small random texts for testing — minimal tokens
function randomText(): string {
  return `Testtext ${Math.random().toString(36).slice(2, 10)} Gemeinde Nordstemmen ${Date.now()}`;
}

async function embedRequest(texts: string[]): Promise<{ ok: boolean; status: number; ms: number; detail?: string }> {
  const start = Date.now();
  const resp = await fetch(JINA_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${JINA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: JINA_MODEL,
      input: texts,
      task: 'retrieval.passage',
      truncate: true,
    }),
  });

  const ms = Date.now() - start;

  if (!resp.ok) {
    const body = await resp.text();
    let detail: string | undefined;
    try {
      detail = JSON.parse(body).detail;
    } catch {
      detail = body.slice(0, 200);
    }
    return { ok: false, status: resp.status, ms, detail };
  }

  await resp.json(); // consume body
  return { ok: true, status: resp.status, ms };
}

describe.skipIf(!JINA_API_KEY)('Jina API load test', () => {
  it('single request works', async () => {
    const result = await embedRequest([randomText()]);
    console.log(`Single request: ${result.status} in ${result.ms}ms`);
    expect(result.ok).toBe(true);
  }, 30_000);

  it('find max concurrency', async () => {
    // Fire N requests simultaneously and see how many succeed
    for (const n of [2, 5, 10, 20, 50]) {
      const texts = Array.from({ length: n }, () => [randomText()]);
      const results = await Promise.all(texts.map((t) => embedRequest(t)));

      const succeeded = results.filter((r) => r.ok).length;
      const failed429 = results.filter((r) => r.status === 429).length;
      const avgMs = Math.round(results.filter((r) => r.ok).reduce((sum, r) => sum + r.ms, 0) / (succeeded || 1));

      console.log(
        `Concurrency ${n}: ${succeeded}/${n} OK, ${failed429} x 429, avg ${avgMs}ms` +
          (failed429 > 0 ? ` — detail: ${results.find((r) => r.status === 429)?.detail}` : ''),
      );

      if (failed429 > 0) {
        console.log(`\n>>> Max concurrency is between ${succeeded} and ${n}`);
        break;
      }

      // Small pause between rounds to not trip RPM limit
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }, 120_000);

  it('measure single-request latency (10 sequential)', async () => {
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      // Wait a bit between requests to avoid token rate limit
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, 1000));
      const result = await embedRequest([randomText()]);
      if (!result.ok) {
        console.log(`Request ${i + 1} failed: ${result.status} — ${result.detail}`);
        continue;
      }
      times.push(result.ms);
    }

    expect(times.length).toBeGreaterThan(0);
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    const min = Math.min(...times);
    const max = Math.max(...times);
    console.log(`Latency (${times.length}/10 succeeded): avg=${avg}ms, min=${min}ms, max=${max}ms`);
    console.log(`  → Theoretical max RPM at 1 concurrent: ${Math.round(60_000 / avg)}`);
    console.log(`  → Theoretical max RPM at 50 concurrent: ${Math.round((60_000 / avg) * 50)}`);
  }, 60_000);

  it('throughput test: 50 requests, max concurrency', async () => {
    const total = 50;
    const texts = Array.from({ length: total }, () => [randomText()]);

    const start = Date.now();
    const results = await Promise.all(texts.map((t) => embedRequest(t)));
    const elapsed = Date.now() - start;

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    const rpm = Math.round((succeeded / elapsed) * 60_000);

    console.log(`\nThroughput: ${succeeded}/${total} OK, ${failed} failed in ${elapsed}ms`);
    console.log(`  → Effective RPM: ${rpm}`);
    console.log(`  → Effective RPS: ${((succeeded / elapsed) * 1000).toFixed(1)}`);

    if (failed > 0) {
      const errors = results.filter((r) => !r.ok);
      const by429 = errors.filter((r) => r.status === 429).length;
      console.log(`  → 429 errors: ${by429}, other errors: ${failed - by429}`);
      if (errors[0]?.detail) console.log(`  → Detail: ${errors[0].detail}`);
    }
  }, 120_000);
});
