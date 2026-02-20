import { readFile, writeFile } from 'node:fs/promises';
import { join, parse } from 'node:path';
import type { EmbeddingsData, FulltextData } from './types.ts';

export function fulltextPath(pdfPath: string): string {
  const { dir, name } = parse(pdfPath);
  return join(dir, `${name}.fulltext.json`);
}

export function embeddingsPath(pdfPath: string): string {
  const { dir, name } = parse(pdfPath);
  return join(dir, `${name}.embeddings.json`);
}

function completedPath(pdfPath: string): string {
  const { dir, name } = parse(pdfPath);
  return join(dir, `${name}.completed`);
}

export async function isCompleted(pdfPath: string, expectedHash: string): Promise<boolean> {
  try {
    const raw = await readFile(completedPath(pdfPath), 'utf-8');
    const data = JSON.parse(raw);
    return data.file_hash === expectedHash;
  } catch {
    return false;
  }
}

export async function markCompleted(pdfPath: string, fileHash: string): Promise<void> {
  const data = { file_hash: fileHash, completed_at: new Date().toISOString() };
  await writeFile(completedPath(pdfPath), JSON.stringify(data, null, 2), 'utf-8');
}

export async function saveFulltext(pdfPath: string, data: FulltextData): Promise<void> {
  await writeFile(fulltextPath(pdfPath), JSON.stringify(data, null, 2), 'utf-8');
}

export async function saveEmbeddings(pdfPath: string, data: EmbeddingsData): Promise<void> {
  await writeFile(embeddingsPath(pdfPath), JSON.stringify(data, null, 2), 'utf-8');
}
