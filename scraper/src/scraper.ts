import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, flow, pipe, Schema as S } from 'effect';
import { downloadFile, effectFetchJson, fetchAllMeetings, fetchAllPapers } from './client.ts';
import type { OParlMeeting, OParlPaper } from './schema.ts';
import { OParlPaperSchema } from './schema.ts';
import {
  buildMeetingIndex,
  collectFiles,
  type EntityWithFiles,
  extractFilename,
  filesToDownload,
  fileUrl,
  isUpToDate,
  type MeetingFolderEntry,
} from './sync.ts';

export const fetchPaperMetadata = flow(effectFetchJson, Effect.flatMap(S.decodeUnknown(OParlPaperSchema)));

export interface ScraperConfig {
  documentsDir: string;
}

type Counter = { created: number; updated: number; skipped: number; errors: number };

interface Stats {
  papers: Counter;
  meetings: Counter;
}

const newCounter = (): Counter => ({ created: 0, updated: 0, skipped: 0, errors: 0 });

const sanitize = (name: string): string =>
  name
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 100);

const generatePaperFolderName = (paper: OParlPaper): string => {
  if (!paper.reference) return 'DS_unknown';
  const ref = paper.reference.replace(/\s+/g, '_').replace(/\//g, '-');
  return ref.startsWith('DS_') ? ref : `DS_${ref}`;
};

const generateMeetingFolderName = (meeting: OParlMeeting): string => {
  const date = meeting.start ? meeting.start.split('T')[0] : 'unknown';
  const name = meeting.name ? sanitize(meeting.name) : 'unknown';
  return `${date}_${name}`;
};

const readMetadata = async (folderPath: string): Promise<EntityWithFiles | undefined> => {
  try {
    return JSON.parse(await readFile(join(folderPath, 'metadata.json'), 'utf-8'));
  } catch {
    return undefined;
  }
};

const loadMeetingIndex = async (meetingsDir: string): Promise<Map<string, string>> => {
  const folders = await readdir(meetingsDir).catch(() => [] as string[]);
  const entries: MeetingFolderEntry[] = [];
  for (const folder of folders) {
    const metadata = await readMetadata(join(meetingsDir, folder));
    if (!metadata?.id) continue;
    const fileCount = (await readdir(join(meetingsDir, folder))).length - 1;
    entries.push({ folder, id: metadata.id, fileCount });
  }
  return buildMeetingIndex(entries);
};

const download = (url: string, target: string): Effect.Effect<boolean, never> =>
  pipe(
    downloadFile(url),
    Effect.flatMap((buf) =>
      Effect.tryPromise(async () => {
        await mkdir(join(target, '..'), { recursive: true });
        await writeFile(target, Buffer.from(buf));
      }),
    ),
    Effect.map(() => true),
    Effect.catchAll(() => Effect.succeed(false)),
  );

/**
 * Bring one paper/meeting folder up to date: download new or changed files and rewrite
 * metadata.json whenever the entity changed upstream (e.g. invitation/agenda published later).
 */
const syncEntity = (
  entity: OParlPaper | OParlMeeting,
  path: string,
  label: string,
  counter: Counter,
): Effect.Effect<void, never> =>
  pipe(
    Effect.promise(() => readMetadata(path)),
    Effect.flatMap((stored) => {
      const pending = filesToDownload(collectFiles(entity), stored, (filename) => existsSync(join(path, filename)));
      if (isUpToDate(entity, stored, pending.length)) {
        counter.skipped++;
        return Effect.void;
      }
      return pipe(
        Effect.all(
          pending.map((file) => download(fileUrl(file), join(path, extractFilename(fileUrl(file))))),
          { concurrency: 5 },
        ),
        Effect.flatMap((results) =>
          Effect.tryPromise(async () => {
            await mkdir(path, { recursive: true });
            await writeFile(join(path, 'metadata.json'), JSON.stringify(entity, null, 2));
            return results.filter((ok) => !ok).length;
          }),
        ),
        Effect.tap((failed) =>
          Effect.sync(() => {
            if (stored) counter.updated++;
            else counter.created++;
            if (failed > 0) counter.errors++;
            const failedNote = failed > 0 ? ` (${failed} downloads failed, retry next run)` : '';
            console.log(`${stored ? '↻' : '✓'} ${label}${failedNote}`);
          }),
        ),
        Effect.asVoid,
      );
    }),
    Effect.catchAll(() => {
      counter.errors++;
      return Effect.void;
    }),
  );

const processPaper = (paper: OParlPaper, config: ScraperConfig, stats: Stats): Effect.Effect<void, never> => {
  const folder = generatePaperFolderName(paper);
  return syncEntity(paper, join(config.documentsDir, 'papers', folder), folder, stats.papers);
};

const processMeeting = (
  meeting: OParlMeeting,
  config: ScraperConfig,
  stats: Stats,
  meetingIndex: Map<string, string>,
): Effect.Effect<void, never> => {
  // Reuse the existing folder for this OParl id, even if the meeting was renamed or rescheduled
  const folder = meetingIndex.get(meeting.id) ?? generateMeetingFolderName(meeting);
  return syncEntity(meeting, join(config.documentsDir, 'meetings', folder), folder, stats.meetings);
};

export const syncPapers = (config: ScraperConfig, stats: Stats = { papers: newCounter(), meetings: newCounter() }) =>
  pipe(
    Effect.sync(() => console.log('📡 Fetching Papers...')),
    Effect.flatMap(() => fetchAllPapers()),
    Effect.tap((papers) => Effect.sync(() => console.log(`📚 Found ${papers.length} papers\n`))),
    Effect.flatMap((papers) =>
      Effect.all(
        papers.map((p) => processPaper(p, config, stats)),
        { concurrency: 5 },
      ),
    ),
    Effect.map(() => stats.papers),
  );

export const syncMeetings = (config: ScraperConfig, stats: Stats = { papers: newCounter(), meetings: newCounter() }) =>
  pipe(
    Effect.sync(() => console.log('📡 Fetching Meetings...')),
    Effect.flatMap(() =>
      Effect.all([fetchAllMeetings(), Effect.promise(() => loadMeetingIndex(join(config.documentsDir, 'meetings')))]),
    ),
    Effect.tap(([meetings]) => Effect.sync(() => console.log(`🏛️  Found ${meetings.length} meetings\n`))),
    Effect.flatMap(([meetings, meetingIndex]) =>
      Effect.all(
        meetings.map((m) => processMeeting(m, config, stats, meetingIndex)),
        { concurrency: 5 },
      ),
    ),
    Effect.map(() => stats.meetings),
  );

export const summary = (label: string, c: Counter): string =>
  `${label}: ${c.created} new, ${c.updated} updated, ${c.skipped} unchanged, ${c.errors} errors`;

export const runScraper = (config: ScraperConfig): Effect.Effect<void, Error> => {
  const stats: Stats = { papers: newCounter(), meetings: newCounter() };

  return pipe(
    Effect.sync(() => console.log('🚀 Starting scraper...\n')),
    Effect.flatMap(() => syncPapers(config, stats)),
    Effect.flatMap(() => Effect.sync(() => console.log(''))),
    Effect.flatMap(() => syncMeetings(config, stats)),
    Effect.tap(() =>
      Effect.sync(() => {
        console.log('\n✅ Complete!');
        console.log(`\n${summary('Papers', stats.papers)}`);
        console.log(summary('Meetings', stats.meetings));
      }),
    ),
  );
};
