#!/usr/bin/env node
/**
 * Copies fulltext from documents/*.fulltext.json → public/text/{hash}.txt
 * Runs as part of the MCP server build step.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DOCUMENTS_DIR = resolve(import.meta.dirname, '..', 'documents');
const OUTPUT_DIR = resolve(import.meta.dirname, 'public', 'text');

function findFulltextFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...findFulltextFiles(full));
    } else if (entry.endsWith('.fulltext.json')) {
      results.push(full);
    }
  }
  return results;
}

const files = findFulltextFiles(DOCUMENTS_DIR);
mkdirSync(OUTPUT_DIR, { recursive: true });

let count = 0;
for (const file of files) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    if (data.file_hash && data.full_text) {
      writeFileSync(join(OUTPUT_DIR, `${data.file_hash}.txt`), data.full_text, 'utf-8');
      count++;
    }
  } catch {
    // skip broken files
  }
}

console.log(`Copied ${count} fulltext files to public/text/`);
