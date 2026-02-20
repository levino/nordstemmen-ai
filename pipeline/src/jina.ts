import pRetry, { AbortError } from 'p-retry';
import { JINA_API_URL, JINA_BATCH_SIZE, JINA_MODEL } from './config.ts';

interface JinaResponse {
  data: Array<{ embedding: number[] }>;
}

/**
 * Creates a Jina embedding client.
 *
 * No rate-limit prediction — fires requests aggressively.
 * On 429: exponential backoff via p-retry until success.
 */
export function createJinaClient(apiKey: string) {
  async function embedBatch(texts: string[]): Promise<number[][]> {
    const response = await pRetry(
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
        onFailedAttempt: (error) => {
          const msg = String(error.message ?? error);
          console.log(`  [jina] ${msg.slice(0, 200)} — retry ${error.attemptNumber}/${error.retriesLeft + error.attemptNumber}`);
        },
      },
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
