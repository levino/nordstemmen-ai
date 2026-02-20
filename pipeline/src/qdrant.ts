import { QdrantClient } from '@qdrant/js-client-rest';
import { v5 as uuidv5 } from 'uuid';
import { UUID_NAMESPACE_DNS } from './config.ts';
import type { QdrantPayload } from './types.ts';

export interface QdrantConfig {
  url: string;
  apiKey: string;
  port: number;
  collection: string;
}

export function createQdrantService(config: QdrantConfig) {
  const client = new QdrantClient({
    url: config.url,
    apiKey: config.apiKey,
    port: config.port,
    timeout: 30_000,
    checkCompatibility: false,
  });

  async function ensureCollection(): Promise<void> {
    const collections = await client.getCollections();
    const exists = collections.collections.some((c) => c.name === config.collection);
    if (!exists) {
      await client.createCollection(config.collection, {
        vectors: { size: 1024, distance: 'Cosine' },
      });
    }
  }

  async function loadProcessedFiles(): Promise<Set<string>> {
    const processed = new Set<string>();
    let offset: string | number | undefined;

    while (true) {
      const result = await client.scroll(config.collection, {
        limit: 1000,
        offset,
        with_payload: ['filename', 'file_hash'],
        with_vector: false,
      });

      for (const point of result.points) {
        const p = point.payload as {
          filename?: string;
          file_hash?: string;
        };
        if (p.filename && p.file_hash) {
          processed.add(`${p.filename}::${p.file_hash}`);
        }
      }

      if (!result.next_page_offset) break;
      offset = result.next_page_offset as string | number | undefined;
    }

    return processed;
  }

  async function deleteFileChunks(filename: string): Promise<void> {
    await client.delete(config.collection, {
      filter: {
        must: [{ key: 'filename', match: { value: filename } }],
      },
    });
  }

  async function upsertChunks(
    chunks: Array<{
      page: number;
      chunkIndex: number;
      text: string;
      vector: number[];
    }>,
    payload: Omit<QdrantPayload, 'page' | 'chunk_index' | 'text'>,
  ): Promise<void> {
    const points = chunks.map((chunk) => {
      const idString = `${payload.file_hash}_${chunk.page}_${chunk.chunkIndex}`;
      const id = uuidv5(idString, UUID_NAMESPACE_DNS);
      return {
        id,
        vector: chunk.vector,
        payload: {
          ...payload,
          page: chunk.page,
          chunk_index: chunk.chunkIndex,
          text: chunk.text,
        },
      };
    });

    await client.upsert(config.collection, { points });
  }

  return { ensureCollection, loadProcessedFiles, deleteFileChunks, upsertChunks };
}
