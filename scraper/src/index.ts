import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { runScraper } from './scraper.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DOCUMENTS_DIR = join(__dirname, '..', '..', 'documents');

const program = runScraper({ documentsDir: DOCUMENTS_DIR });

Effect.runPromise(program).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
