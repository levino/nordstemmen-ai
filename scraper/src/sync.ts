/**
 * Pure helpers for incremental sync: which files belong to an entity, which of them
 * need (re-)downloading, and which local folder an OParl meeting lives in.
 */

export interface OParlFileRef {
  id?: string;
  accessUrl?: string;
  downloadUrl?: string;
  modified?: string;
}

export interface EntityWithFiles {
  id: string;
  modified?: string;
  mainFile?: unknown;
  invitation?: unknown;
  resultsProtocol?: unknown;
  verbatimProtocol?: unknown;
  auxiliaryFile?: readonly unknown[];
  agendaItem?: readonly unknown[];
}

const isFileRef = (value: unknown): value is OParlFileRef =>
  typeof value === 'object' &&
  value !== null &&
  Boolean((value as OParlFileRef).accessUrl || (value as OParlFileRef).downloadUrl);

const agendaItemFiles = (item: unknown): unknown[] =>
  typeof item === 'object' && item !== null && Array.isArray((item as { auxiliaryFile?: unknown }).auxiliaryFile)
    ? (item as { auxiliaryFile: unknown[] }).auxiliaryFile
    : [];

/** All downloadable files referenced by a paper or meeting (incl. agenda item attachments). */
export const collectFiles = (entity: EntityWithFiles): OParlFileRef[] =>
  [
    entity.mainFile,
    entity.invitation,
    entity.resultsProtocol,
    entity.verbatimProtocol,
    ...(entity.auxiliaryFile ?? []),
    ...(entity.agendaItem ?? []).flatMap(agendaItemFiles),
  ].filter(isFileRef);

export const extractFilename = (url: string): string => {
  const parts = url.split('/');
  const last = parts[parts.length - 1];
  return decodeURIComponent(last).replace(/[/\\:*?"<>|]/g, '_');
};

export const fileUrl = (file: OParlFileRef): string => (file.accessUrl || file.downloadUrl) as string;

/**
 * Files to download: missing locally, or changed upstream (`modified` differs from the
 * previously stored file object). Deduplicated by target filename.
 */
export const filesToDownload = (
  files: OParlFileRef[],
  stored: EntityWithFiles | undefined,
  existsLocally: (filename: string) => boolean,
): OParlFileRef[] => {
  const storedModified = new Map(
    (stored ? collectFiles(stored) : []).filter((f) => f.id).map((f) => [f.id as string, f.modified]),
  );
  const seen = new Set<string>();
  return files.filter((file) => {
    const filename = extractFilename(fileUrl(file));
    if (seen.has(filename)) return false;
    seen.add(filename);
    if (!existsLocally(filename)) return true;
    const previous = file.id ? storedModified.get(file.id) : undefined;
    return Boolean(previous && file.modified && previous !== file.modified);
  });
};

/** An entity is up to date if its `modified` timestamp is unchanged and no file needs downloading. */
export const isUpToDate = (entity: EntityWithFiles, stored: EntityWithFiles | undefined, pending: number): boolean =>
  Boolean(stored && entity.modified && stored.modified === entity.modified && pending === 0);

export interface MeetingFolderEntry {
  folder: string;
  id: string;
  fileCount: number;
}

/**
 * Map OParl meeting id → local folder. Meetings get renumbered or rescheduled upstream,
 * so the folder name is not stable; the id is. If several folders share an id, prefer the
 * one holding the most files, then the lexicographically last one.
 */
export const buildMeetingIndex = (entries: MeetingFolderEntry[]): Map<string, string> => {
  const best = new Map<string, MeetingFolderEntry>();
  for (const entry of entries) {
    const current = best.get(entry.id);
    if (
      !current ||
      entry.fileCount > current.fileCount ||
      (entry.fileCount === current.fileCount && entry.folder > current.folder)
    ) {
      best.set(entry.id, entry);
    }
  }
  return new Map([...best].map(([id, entry]) => [id, entry.folder]));
};
