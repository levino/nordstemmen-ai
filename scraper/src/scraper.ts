import { Effect, Schema as S, pipe, flow } from 'effect';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fetchAllPapers, fetchAllMeetings, downloadFile, effectFetchJson } from './client.ts';
import { OParlPaperSchema } from './schema.ts';
import type { OParlPaper, OParlMeeting } from './schema.ts';

export const fetchPaperMetadata = flow(effectFetchJson, Effect.flatMap(S.decodeUnknown(OParlPaperSchema)));

export interface ScraperConfig {
  documentsDir: string;
}

interface Stats {
  papers: { processed: number; skipped: number; errors: number };
  meetings: { processed: number; skipped: number; errors: number };
}

const extractFilename = (url: string): string => {
  const parts = url.split('/');
  const last = parts[parts.length - 1];
  return decodeURIComponent(last).replace(/[\/\\:*?"<>|]/g, '_');
};

const sanitize = (name: string): string =>
  name
    .replace(/[\/\\:*?"<>|]/g, '_')
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

const download = (url: string, target: string): Effect.Effect<boolean, never> =>
  pipe(
    downloadFile(url),
    Effect.flatMap((buf) =>
      Effect.tryPromise({
        try: async () => {
          await mkdir(join(target, '..'), { recursive: true });
          await writeFile(target, Buffer.from(buf));
        },
        catch: () => {},
      }),
    ),
    Effect.map(() => true),
    Effect.catchAll(() => Effect.succeed(false)),
  );

const downloadFileIfUrl = (obj: any, path: string): Effect.Effect<void, never> => {
  if (!obj || typeof obj !== 'object') return Effect.void;
  const url = obj.accessUrl || obj.downloadUrl;
  if (!url) return Effect.void;
  const filename = extractFilename(url);
  return pipe(download(url, join(path, filename)), Effect.asVoid);
};

const processPaper = (paper: OParlPaper, config: ScraperConfig, stats: Stats): Effect.Effect<void, never> => {
  const folder = generatePaperFolderName(paper);
  const path = join(config.documentsDir, 'papers', folder);
  const metaPath = join(path, 'metadata.json');

  if (existsSync(metaPath)) {
    stats.papers.skipped++;
    return Effect.void;
  }

  const downloads: Effect.Effect<void, never>[] = [];

  // Download mainFile
  if (paper.mainFile) downloads.push(downloadFileIfUrl(paper.mainFile, path));

  // Download auxiliaryFiles
  if (Array.isArray(paper.auxiliaryFile)) {
    paper.auxiliaryFile.forEach((file) => downloads.push(downloadFileIfUrl(file, path)));
  }

  return pipe(
    Effect.all(downloads, { concurrency: 5 }),
    Effect.flatMap(() =>
      Effect.tryPromise({
        try: async () => {
          await mkdir(path, { recursive: true });
          await writeFile(metaPath, JSON.stringify(paper, null, 2));
        },
        catch: () => {},
      }),
    ),
    Effect.map(() => {
      stats.papers.processed++;
      console.log(`✓ ${folder}`);
    }),
    Effect.catchAll(() => {
      stats.papers.errors++;
      return Effect.void;
    }),
  );
};

const processMeeting = (meeting: OParlMeeting, config: ScraperConfig, stats: Stats): Effect.Effect<void, never> => {
  const folder = generateMeetingFolderName(meeting);
  const path = join(config.documentsDir, 'meetings', folder);
  const metaPath = join(path, 'metadata.json');

  if (existsSync(metaPath)) {
    stats.meetings.skipped++;
    return Effect.void;
  }

  const downloads: Effect.Effect<void, never>[] = [];

  // Download meeting files
  if (meeting.invitation) downloads.push(downloadFileIfUrl(meeting.invitation, path));
  if (meeting.resultsProtocol) downloads.push(downloadFileIfUrl(meeting.resultsProtocol, path));
  if (meeting.verbatimProtocol) downloads.push(downloadFileIfUrl(meeting.verbatimProtocol, path));

  // Download agenda item files
  if (Array.isArray(meeting.agendaItem)) {
    meeting.agendaItem.forEach((item: any) => {
      if (Array.isArray(item?.auxiliaryFile)) {
        item.auxiliaryFile.forEach((file: any) => downloads.push(downloadFileIfUrl(file, path)));
      }
    });
  }

  return pipe(
    Effect.all(downloads, { concurrency: 5 }),
    Effect.flatMap(() =>
      Effect.tryPromise({
        try: async () => {
          await mkdir(path, { recursive: true });
          await writeFile(metaPath, JSON.stringify(meeting, null, 2));
        },
        catch: () => {},
      }),
    ),
    Effect.map(() => {
      stats.meetings.processed++;
      console.log(`✓ ${folder}`);
    }),
    Effect.catchAll(() => {
      stats.meetings.errors++;
      return Effect.void;
    }),
  );
};

export const runScraper = (config: ScraperConfig): Effect.Effect<void, Error> => {
  const stats: Stats = {
    papers: { processed: 0, skipped: 0, errors: 0 },
    meetings: { processed: 0, skipped: 0, errors: 0 },
  };

  return pipe(
    Effect.sync(() => console.log('🚀 Starting scraper...\n')),
    Effect.flatMap(() => Effect.sync(() => console.log('📡 Fetching Papers...'))),
    Effect.flatMap(() => fetchAllPapers()),
    Effect.tap((papers) => Effect.sync(() => console.log(`📚 Found ${papers.length} papers\n`))),
    Effect.flatMap((papers) =>
      Effect.all(
        papers.map((p) => processPaper(p, config, stats)),
        { concurrency: 5 },
      ),
    ),
    Effect.flatMap(() => Effect.sync(() => console.log('\n📡 Fetching Meetings...'))),
    Effect.flatMap(() => fetchAllMeetings()),
    Effect.tap((meetings) => Effect.sync(() => console.log(`🏛️  Found ${meetings.length} meetings\n`))),
    Effect.flatMap((meetings) =>
      Effect.all(
        meetings.map((m) => processMeeting(m, config, stats)),
        { concurrency: 5 },
      ),
    ),
    Effect.tap(() =>
      Effect.sync(() => {
        console.log('\n✅ Complete!');
        console.log(
          `\nPapers: ${stats.papers.processed} processed, ${stats.papers.skipped} skipped, ${stats.papers.errors} errors`,
        );
        console.log(
          `Meetings: ${stats.meetings.processed} processed, ${stats.meetings.skipped} skipped, ${stats.meetings.errors} errors`,
        );
      }),
    ),
  );
};
