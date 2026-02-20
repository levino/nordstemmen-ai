import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

export async function computeFileHash(filepath: string): Promise<string> {
  const data = await readFile(filepath);
  return createHash('sha256').update(data).digest('hex');
}

export async function isLfsPointer(filepath: string): Promise<boolean> {
  try {
    const stats = await stat(filepath);
    if (stats.size > 200) return false;
    const content = await readFile(filepath, 'utf-8');
    return content.startsWith('version https://git-lfs');
  } catch {
    return false;
  }
}
