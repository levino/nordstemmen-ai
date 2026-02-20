import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { type EnvConfig, runPipeline } from './pipeline.ts';
import type { PipelineConfig } from './types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');
const DOCUMENTS_DIR = join(ROOT_DIR, 'documents');

loadEnv({ path: join(ROOT_DIR, '.env') });

const { values } = parseArgs({
  options: {
    limit: { type: 'string', default: '0' },
    force: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'skip-qdrant': { type: 'boolean', default: false },
    only: { type: 'string' },
    concurrency: { type: 'string', default: '5' },
    'max-pdf-size': { type: 'string', default: '50' },
  },
  strict: false,
});

const config: PipelineConfig = {
  documentsDir: DOCUMENTS_DIR,
  limit: parseInt(String(values.limit ?? '0'), 10),
  force: values.force === true,
  dryRun: values['dry-run'] === true,
  skipQdrant: values['skip-qdrant'] === true,
  only: typeof values.only === 'string' ? values.only : undefined,
  concurrency: parseInt(String(values.concurrency ?? '5'), 10),
  maxPdfSize: parseInt(String(values['max-pdf-size'] ?? '50'), 10) * 1024 * 1024,
};

function required(name: string): string {
  const val = process.env[name];
  if (!val) {
    if (config.dryRun) return '';
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return val;
}

const env: EnvConfig = {
  geminiApiKey: required('GOOGLE_API_KEY'),
  jinaApiKey: required('JINA_API_KEY'),
  qdrant: {
    url: required('QDRANT_URL'),
    apiKey: required('QDRANT_API_KEY'),
    port: parseInt(process.env.QDRANT_PORT ?? '443', 10),
    collection: process.env.QDRANT_COLLECTION ?? 'nordstemmen',
  },
};

runPipeline(config, env).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
