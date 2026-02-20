import pRetry, { AbortError } from 'p-retry';
import { JINA_API_URL, JINA_BATCH_SIZE, JINA_MODEL } from './config.ts';

interface JinaResponse {
  data: Array<{ embedding: number[] }>;
}

/**
 * Simple semaphore — limits concurrent async operations.
 */
function createSemaphore(max: number) {
  let running = 0;
  const queue: Array<() => void> = [];

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (running >= max) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    running++;
    try {
      return await fn();
    } finally {
      running--;
      queue.shift()?.();
    }
  };
}

/**
 * Creates a Jina embedding client.
 *
 * Internal semaphore limits to 2 concurrent API calls (Jina's concurrency limit).
 * On 429: exponential backoff via p-retry.
 */
export function createJinaClient(apiKey: string) {
  const withSlot = createSemaphore(50);

  async function embedBatch(texts: string[]): Promise<number[][]> {
    const response = await withSlot(() =>
      pRetry(
        async () => {
          const resp = await fetch(JINA_API_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: JINA_MODEL,
              input: texts,
              task: 'retrieval.passage',
              truncate: true,
            }),
          });

          if (resp.status === 429) {
            const body = await resp.text();
            throw new Error(`Jina 429: ${body}`);
          }

          if (!resp.ok) {
            const body = await resp.text();
            throw new AbortError(`Jina ${resp.status}: ${body}`);
          }

          const json = (await resp.json()) as JinaResponse;
          if (!json.data) {
            throw new Error(`Jina: unexpected response: ${JSON.stringify(json).slice(0, 300)}`);
          }
          return json;
        },
        {
          retries: 8,
          minTimeout: 5_000,
          maxTimeout: 120_000,
          onFailedAttempt: (ctx) => {
            const msg = String(ctx.error.message ?? ctx.error);
            console.log(
              `  [jina] ${msg.slice(0, 200)} — retry ${ctx.attemptNumber}/${ctx.retriesLeft + ctx.attemptNumber}`,
            );
          },
        },
      ),
    );

    return response.data.map((item) => item.embedding);
  }

  return {
    async embed(texts: string[]): Promise<number[][]> {
      const allEmbeddings: number[][] = [];

      for (let i = 0; i < texts.length; i += JINA_BATCH_SIZE) {
        const batch = texts.slice(i, i + JINA_BATCH_SIZE);
        const vectors = await embedBatch(batch);
        allEmbeddings.push(...vectors);
      }

      return allEmbeddings;
    },
  };
}

export type JinaClient = ReturnType<typeof createJinaClient>;
