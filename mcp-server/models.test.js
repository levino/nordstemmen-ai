import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { InferenceClient } from '@huggingface/inference';

const workingModels = [
  { name: "intfloat/multilingual-e5-base", expectedDim: 768 },
  { name: "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2", expectedDim: 384 },
  { name: "BAAI/bge-small-en-v1.5", expectedDim: 384 },
];

const unavailableModels = [
  { name: "jinaai/jina-embeddings-v3", expectedDim: 1024 },
  { name: "jinaai/jina-embeddings-v2-base-de", expectedDim: 768 },
];

describe('HuggingFace Model Availability', () => {
  describe('Available Models', () => {
    workingModels.forEach(({ name, expectedDim }) => {
      it(`should work with ${name}`, async () => {
        const client = new InferenceClient(env.HUGGINGFACE_API_KEY);

        const embedding = await client.featureExtraction({
          model: name,
          inputs: "Schwimmbad Kosten",
          provider: "hf-inference",
        });

        const embeddingArray = Array.isArray(embedding) ? embedding : Array.from(embedding);

        expect(embeddingArray).toBeInstanceOf(Array);
        expect(embeddingArray.length).toBe(expectedDim);
        expect(embeddingArray[0]).toBeTypeOf('number');
      }, 30000); // 30s timeout for API calls
    });
  });

  describe('Unavailable Models (should fail)', () => {
    unavailableModels.forEach(({ name }) => {
      it(`should NOT work with ${name}`, async () => {
        const client = new InferenceClient(env.HUGGINGFACE_API_KEY);

        await expect(async () => {
          await client.featureExtraction({
            model: name,
            inputs: "Schwimmbad Kosten",
            provider: "hf-inference",
          });
        }).rejects.toThrow();
      }, 30000);
    });
  });
});
