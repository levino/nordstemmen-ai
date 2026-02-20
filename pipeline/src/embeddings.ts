import { JINA_API_URL, JINA_BATCH_SIZE, JINA_MODEL } from './config.ts';
import { withRetry } from './retry.ts';

export async function generateEmbeddings(texts: string[], apiKey: string): Promise<number[][]> {
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += JINA_BATCH_SIZE) {
    const batch = texts.slice(i, i + JINA_BATCH_SIZE);

    const response = await withRetry(
      async () => {
        const resp = await fetch(JINA_API_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: JINA_MODEL,
            input: batch,
            task: 'retrieval.passage',
          }),
        });

        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(`Jina ${resp.status}: ${body}`);
        }

        return resp.json() as Promise<{
          data: Array<{ embedding: number[] }>;
        }>;
      },
      {
        retries: 3,
        baseDelay: 1000,
        shouldRetry: (error) => {
          const msg = String(error);
          return msg.includes('429') || msg.includes('500') || msg.includes('503');
        },
      },
    );

    for (const item of response.data) {
      allEmbeddings.push(item.embedding);
    }
  }

  return allEmbeddings;
}
